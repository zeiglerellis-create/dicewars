import { axialDistance, axialNeighbors, axialToPixel, coordKey } from './hex'
import {
  PLAYER_COUNT_MAX,
  PLAYER_COUNT_MIN,
  type BoardHexPreset,
  type HexCoord,
  type HexTile,
  type IslandCount,
  type PlayerId,
} from './types'
import type { Rng } from './rng'
import { nextFloat, nextInt, shuffleInPlace } from './rng'
import { boardCentroidFromCenters, routeEdgePorts, routeSegmentHitsAny, type XY } from './routeGeom'

/** Bias growth steps toward wider (landscape) or taller (portrait) pixel bounds. */
const GROWTH_BIAS_EXP = 2.4

/** Landscape: prefer width ≥ height in pixel space. */
const MIN_BOARD_PIXEL_ASPECT = 1
/** Portrait (narrow viewports): prefer height ≥ width; allow slight tolerance. */
const MAX_BOARD_PIXEL_ASPECT_PORTRAIT = 1.02

const ASPECT_RELAX_LAST_ATTEMPTS = 28

export type BoardGrowthBias = 'landscape' | 'portrait'

/** Used when generating boards so mobile portrait gets taller blobs that fill vertical space. */
export function defaultBoardGrowthBias(): BoardGrowthBias {
  if (typeof globalThis !== 'undefined' && typeof globalThis.matchMedia === 'function') {
    try {
      if (globalThis.matchMedia('(max-width: 720px)').matches) return 'portrait'
    } catch {
      /* ignore */
    }
  }
  return 'landscape'
}

export const BOARD_HEX_MIN = 20
/** Large “Full” maps can exceed old 100 cap. */
export const BOARD_HEX_MAX = 220

/** Minimum hex width/height on screen (CSS px) for Full preset — touch-friendly. */
export const FULL_BOARD_MIN_HEX_CSS_PX = 30

/** Quick size buttons on the setup panel (clamped to min/max). */
export const BOARD_HEX_PRESETS = [20, 40, 60, 'full'] as const satisfies readonly BoardHexPreset[]

export function clampBoardHexCount(n: number): number {
  return Math.min(BOARD_HEX_MAX, Math.max(BOARD_HEX_MIN, Math.floor(Number(n))))
}

/**
 * Rough hex count so the fitted board keeps hexes large enough to tap, using the same
 * world scale as GameCanvas (R=1, pad ≈18 CSS px). Portrait bias uses taller blobs.
 */
export function estimateLandHexCountForViewport(
  cssWidth: number,
  cssHeight: number,
  growthBias: BoardGrowthBias = defaultBoardGrowthBias(),
): number {
  const w = Math.max(120, cssWidth)
  const h = Math.max(120, cssHeight)
  const g = globalThis as unknown as Window
  const dpr =
    typeof globalThis !== 'undefined' && typeof g.devicePixelRatio === 'number'
      ? Math.min(2, g.devicePixelRatio || 1)
      : 1
  const padCss = 18
  const innerW = Math.max(1, w * dpr - 2 * padCss * dpr)
  const innerH = Math.max(1, h * dpr - 2 * padCss * dpr)
  /** Need scale * sqrt(3) >= FULL_BOARD_MIN_HEX_CSS_PX * dpr (flat width of pointy hex R=1). */
  const minScale = (FULL_BOARD_MIN_HEX_CSS_PX * dpr) / Math.sqrt(3)
  const Kx = growthBias === 'portrait' ? 2.55 : 3.15
  const Ky = growthBias === 'portrait' ? 3.25 : 2.35
  const bound = (minScale / 0.98) * 1.02
  const sqrtN = Math.min(innerW / Kx, innerH / Ky) / bound
  let n = Math.floor(sqrtN * sqrtN)
  n = clampBoardHexCount(n)
  return n
}

function isConnectedHexCoordMap(coordMap: Map<string, HexCoord>): boolean {
  if (coordMap.size <= 1) return true
  const start = [...coordMap.keys()][0]!
  const seen = new Set<string>([start])
  const stack = [start]
  while (stack.length) {
    const k = stack.pop()!
    const c = coordMap.get(k)!
    for (const n of axialNeighbors(c)) {
      const nk = coordKey(n.q, n.r)
      if (!coordMap.has(nk) || seen.has(nk)) continue
      seen.add(nk)
      stack.push(nk)
    }
  }
  return seen.size === coordMap.size
}

/** halfW / halfH for landscape (wide board); portrait inverts. */
const RECT_LANDSCAPE_HALF_RATIO = 1.72

function halfExtendsForRectInPixelSpace(
  scale: number,
  bias: BoardGrowthBias,
): { halfW: number; halfH: number } {
  if (bias === 'landscape') {
    return { halfW: scale, halfH: scale / RECT_LANDSCAPE_HALF_RATIO }
  }
  return { halfW: scale / RECT_LANDSCAPE_HALF_RATIO, halfH: scale }
}

/** All hex centers whose pixel coords lie in an axis-aligned rectangle (uses R=1 layout). */
function hexesInAxisAlignedPixelBox(halfW: number, halfH: number): Map<string, HexCoord> {
  const m = new Map<string, HexCoord>()
  const span = Math.min(
    220,
    Math.ceil(Math.max(halfW, halfH) * 2) + 12,
  )
  for (let q = -span; q <= span; q++) {
    for (let r = -span; r <= span; r++) {
      const p = axialToPixel({ q, r }, 1)
      if (Math.abs(p.x) <= halfW + 1e-10 && Math.abs(p.y) <= halfH + 1e-10) {
        m.set(coordKey(q, r), { q, r })
      }
    }
  }
  return m
}

function largestConnectedSubmap(coordMap: Map<string, HexCoord>): Map<string, HexCoord> {
  const visited = new Set<string>()
  let bestKeys: string[] = []
  for (const k of coordMap.keys()) {
    if (visited.has(k)) continue
    const comp: string[] = []
    const stack = [k]
    while (stack.length) {
      const cur = stack.pop()!
      if (visited.has(cur)) continue
      visited.add(cur)
      comp.push(cur)
      const c = coordMap.get(cur)!
      for (const n of axialNeighbors(c)) {
        const nk = coordKey(n.q, n.r)
        if (coordMap.has(nk) && !visited.has(nk)) stack.push(nk)
      }
    }
    if (comp.length > bestKeys.length) bestKeys = comp
  }
  const out = new Map<string, HexCoord>()
  for (const k of bestKeys) out.set(k, coordMap.get(k)!)
  return out
}

function trimHexCountPreservingConnectivity(
  rng: Rng,
  coordMap: Map<string, HexCoord>,
  target: number,
): Map<string, HexCoord> | null {
  if (coordMap.size < target) return null
  if (coordMap.size === target) return coordMap
  const m = new Map(coordMap)
  let guard = 0
  const maxG = (coordMap.size - target) * 40 + 200
  while (m.size > target && guard < maxG) {
    guard++
    const removable = [...m.keys()].filter((k) => {
      const next = new Map(m)
      next.delete(k)
      return isConnectedHexCoordMap(next)
    })
    if (removable.length === 0) return null
    const scored = removable.map((k) => {
      const c = m.get(k)!
      const p = axialToPixel(c, 1)
      return { k, score: p.x * p.x + p.y * p.y + nextFloat(rng) * 1e-6 }
    })
    scored.sort((a, b) => b.score - a.score)
    m.delete(scored[0]!.k)
  }
  return m.size === target ? m : null
}

/**
 * Axis-aligned rectangle in pixel/world space (after centering, fills the viewport silhouette).
 * Not an organic blob — interior is solid; “Full” uses this instead of growBlobCoords.
 */
function growRectangularHexCoords(
  rng: Rng,
  target: number,
  bias: BoardGrowthBias,
): Map<string, HexCoord> | null {
  let lo = 1.2
  let hi = 95
  let best: Map<string, HexCoord> | null = null
  for (let it = 0; it < 56; it++) {
    const s = (lo + hi) / 2
    const { halfW, halfH } = halfExtendsForRectInPixelSpace(s, bias)
    let m = hexesInAxisAlignedPixelBox(halfW, halfH)
    if (!isConnectedHexCoordMap(m)) {
      m = largestConnectedSubmap(m)
    }
    if (m.size >= target) {
      best = m
      hi = s
    } else {
      lo = s
    }
  }
  if (!best || best.size < target) return null
  let out = best
  if (out.size > target) {
    const trimmed = trimHexCountPreservingConnectivity(rng, out, target)
    if (!trimmed) return null
    out = trimmed
  }
  return out.size === target ? out : null
}

/** Remove hexes (lake voids) while keeping one connected landmass. */
function carveInteriorLakes(
  rng: Rng,
  coordMap: Map<string, HexCoord>,
  removeCount: number,
): Map<string, HexCoord> | null {
  if (removeCount <= 0) return coordMap
  const m = new Map(coordMap)
  let removed = 0
  let guard = 0
  const maxGuard = removeCount * 120 + 400
  while (removed < removeCount && guard < maxGuard) {
    guard++
    const candidates = [...m.keys()].filter((k) => {
      const next = new Map(m)
      next.delete(k)
      return isConnectedHexCoordMap(next)
    })
    if (candidates.length === 0) return null
    const interior = candidates.filter((k) => {
      const c = m.get(k)!
      return axialNeighbors(c).every((n) => m.has(coordKey(n.q, n.r)))
    })
    const pool = interior.length > 0 ? interior : candidates
    const pick = pool[nextInt(rng, 0, pool.length)]!
    m.delete(pick)
    removed++
  }
  return removed === removeCount ? m : null
}

/** Each landmass needs at least this many hexes when using multiple islands. */
export const MIN_HEXES_PER_ISLAND = 6

export const DEFAULT_ISLAND_COUNT: IslandCount = 2

export function clampIslandCount(n: number): IslandCount {
  const x = Math.floor(Number(n))
  if (Number.isNaN(x) || x <= 1) return 1
  if (x >= 3) return 3
  return x as IslandCount
}

function effectiveIslandCount(requested: IslandCount, totalHexes: number): IslandCount {
  const maxK = Math.min(3, Math.max(1, Math.floor(totalHexes / MIN_HEXES_PER_ISLAND))) as IslandCount
  return (requested <= maxK ? requested : maxK) as IslandCount
}

function splitIslandSizes(total: number, k: number): number[] | null {
  if (total < k * MIN_HEXES_PER_ISLAND) return null
  const sizes = Array.from({ length: k }, (_, i) => Math.floor(total / k) + (i < total % k ? 1 : 0))
  while (true) {
    const low = sizes.findIndex((s) => s < MIN_HEXES_PER_ISLAND)
    if (low < 0) break
    const hi = sizes.indexOf(Math.max(...sizes))
    if (hi < 0 || sizes[hi]! <= MIN_HEXES_PER_ISLAND) return null
    sizes[hi]!--
    sizes[low]!++
  }
  return sizes
}

function translateCoordMap(m: Map<string, HexCoord>, dq: number, dr: number): Map<string, HexCoord> {
  const out = new Map<string, HexCoord>()
  for (const c of m.values()) {
    const nc = { q: c.q + dq, r: c.r + dr }
    out.set(coordKey(nc.q, nc.r), nc)
  }
  return out
}

function minAxialSeparation(merged: Map<string, HexCoord>, add: Map<string, HexCoord>): number {
  let m = Infinity
  for (const ca of merged.values()) {
    for (const cb of add.values()) {
      m = Math.min(m, axialDistance(ca, cb))
    }
  }
  return m
}

function mergeIslandLayouts(
  rng: Rng,
  blobs: Map<string, HexCoord>[],
): { merged: Map<string, HexCoord>; islandOfKey: Map<string, number> } | null {
  if (blobs.length === 0) return null
  const merged = new Map<string, HexCoord>(blobs[0]!)
  const islandOfKey = new Map<string, number>()
  for (const k of merged.keys()) islandOfKey.set(k, 0)

  for (let bi = 1; bi < blobs.length; bi++) {
    const raw = blobs[bi]!
    let placed = false
    for (let att = 0; att < 200; att++) {
      let maxQ = -Infinity
      let minQi = Infinity
      for (const c of merged.values()) {
        maxQ = Math.max(maxQ, c.q)
      }
      for (const c of raw.values()) {
        minQi = Math.min(minQi, c.q)
      }
      /** Pack tight: smallest gap is axial distance 2 (no shared edges); minAxialSeparation enforces it. */
      const dq = maxQ - minQi + nextInt(rng, 0, 2) + Math.floor(att / 45)
      const dr = nextInt(rng, -4, 5) + (att % 9) - 4
      const shifted = translateCoordMap(raw, dq, dr)
      let clash = false
      for (const k of shifted.keys()) {
        if (merged.has(k)) {
          clash = true
          break
        }
      }
      if (clash) continue
      if (minAxialSeparation(merged, shifted) < 2) continue
      for (const [k, c] of shifted) {
        merged.set(k, c)
        islandOfKey.set(k, bi)
      }
      placed = true
      break
    }
    if (!placed) return null
  }
  return { merged, islandOfKey }
}

function boundaryHexIds(tiles: Record<string, HexTile>, tileIds: string[]): string[] {
  return tileIds.filter((id) => tiles[id].neighbors.length < 6)
}

function validateIslandConnected(
  tiles: Record<string, HexTile>,
  tileIds: string[],
  islandIdx: number,
  gridAdj: Record<string, string[]>,
): boolean {
  const ids = tileIds.filter((id) => tiles[id].islandIndex === islandIdx)
  if (ids.length === 0) return true
  const start = ids[0]!
  const seen = new Set<string>()
  const stack = [start]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const n of gridAdj[id]!) {
      if (tiles[n].islandIndex === islandIdx) stack.push(n)
    }
  }
  return seen.size === ids.length
}

function tryAddRoute(
  tiles: Record<string, HexTile>,
  tileIds: string[],
  a: string,
  b: string,
  used: Set<string>,
  segments: [XY, XY][],
  pairs: [string, string][],
  boardC: XY,
): boolean {
  if (used.has(a) || used.has(b)) return false
  const ia = tiles[a].islandIndex
  const ib = tiles[b].islandIndex
  if (ia === ib) return false
  const { pa, pb } = routeEdgePorts(tiles, tileIds, a, b, boardC)
  if (routeSegmentHitsAny(pa, pb, segments)) return false
  tiles[a] = { ...tiles[a], neighbors: [...tiles[a].neighbors, b] }
  tiles[b] = { ...tiles[b], neighbors: [...tiles[b].neighbors, a] }
  segments.push([pa, pb])
  used.add(a)
  used.add(b)
  pairs.push([a, b])
  return true
}

function routeIncidenceByIsland(
  tiles: Record<string, HexTile>,
  pairs: [string, string][],
  k: number,
): number[] {
  const deg = Array(k).fill(0)
  for (const [a, b] of pairs) {
    deg[tiles[a].islandIndex]++
    deg[tiles[b].islandIndex]++
  }
  return deg
}

function placeRoutesMultiIsland(
  rng: Rng,
  tiles: Record<string, HexTile>,
  tileIds: string[],
  gridAdj: Record<string, string[]>,
  k: number,
): [string, string][] {
  const boundary = boundaryHexIds(tiles, tileIds)
  const cross: [string, string][] = []
  for (let i = 0; i < boundary.length; i++) {
    for (let j = i + 1; j < boundary.length; j++) {
      const a = boundary[i]!
      const b = boundary[j]!
      if (tiles[a].islandIndex === tiles[b].islandIndex) continue
      if (gridAdj[a].includes(b)) continue
      cross.push([a, b])
    }
  }
  if (cross.length === 0) return []
  shuffleInPlace(rng, cross)

  const boardC = boardCentroidFromCenters(tileIds.map((id) => tiles[id].center))

  const parent = Array.from({ length: k }, (_, i) => i)
  function find(i: number): number {
    return parent[i] === i ? i : (parent[i] = find(parent[i]!))
  }

  const segments: [XY, XY][] = []
  const used = new Set<string>()
  const pairs: [string, string][] = []

  for (const [a, b] of cross) {
    const ia = tiles[a].islandIndex
    const ib = tiles[b].islandIndex
    const ru = find(ia)
    const rv = find(ib)
    if (ru === rv) continue
    if (!tryAddRoute(tiles, tileIds, a, b, used, segments, pairs, boardC)) continue
    parent[ru] = rv
  }

  const r0 = find(0)
  for (let i = 1; i < k; i++) {
    if (find(i) !== r0) return []
  }

  const crossPool = [...cross]
  let deg = routeIncidenceByIsland(tiles, pairs, k)
  for (let guard = 0; guard < 100 && deg.some((d) => d < 2); guard++) {
    const low = deg.findIndex((d) => d < 2)
    if (low < 0) break
    shuffleInPlace(rng, crossPool)
    let added = false
    for (const [a, b] of crossPool) {
      const ia = tiles[a].islandIndex
      const ib = tiles[b].islandIndex
      if (ia === ib) continue
      if (ia !== low && ib !== low) continue
      if (used.has(a) || used.has(b)) continue
      if (tryAddRoute(tiles, tileIds, a, b, used, segments, pairs, boardC)) {
        deg = routeIncidenceByIsland(tiles, pairs, k)
        added = true
        break
      }
    }
    if (!added) break
  }

  if (deg.some((d) => d < 2)) return []

  return pairs
}

function maxDegreeOneTiles(size: number): number {
  return Math.min(25, Math.max(4, Math.floor(size * 0.12)))
}

export function validateCount(tiles: Record<string, HexTile>, size: number): boolean {
  return Object.keys(tiles).length === size
}

export function validateConnectivity(
  tiles: Record<string, HexTile>,
  tileIds: string[],
  size: number,
): boolean {
  if (tileIds.length !== size) return false
  const visited = new Set<string>()
  const queue = [tileIds[0]]
  while (queue.length) {
    const id = queue.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    const t = tiles[id]
    if (!t) return false
    for (const n of t.neighbors) queue.push(n)
  }
  return visited.size === size
}

export function validateAdjacencySymmetric(tiles: Record<string, HexTile>): boolean {
  for (const id of Object.keys(tiles)) {
    const t = tiles[id]
    for (const n of t.neighbors) {
      const nb = tiles[n]
      if (!nb || !nb.neighbors.includes(id)) return false
    }
  }
  return true
}

function countDegreeOne(tiles: Record<string, HexTile>): number {
  let c = 0
  for (const id of Object.keys(tiles)) {
    if (tiles[id].neighbors.length === 1) c++
  }
  return c
}

function pixelBoundsOfCoordSet(set: Map<string, HexCoord>): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const c of set.values()) {
    const p = axialToPixel(c, 1)
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, maxX, minY, maxY }
}

function pixelAspectRatioFromBounds(minX: number, maxX: number, minY: number, maxY: number): number {
  const w = maxX - minX + 1e-9
  const h = maxY - minY + 1e-9
  return w / h
}

function pickAspectBiasedNeighbor(
  rng: Rng,
  set: Map<string, HexCoord>,
  candidates: HexCoord[],
  bias: BoardGrowthBias,
): HexCoord {
  if (candidates.length === 1) return candidates[0]!
  const { minX, maxX, minY, maxY } = pixelBoundsOfCoordSet(set)
  const weights = candidates.map((n) => {
    const p = axialToPixel(n, 1)
    const ar = pixelAspectRatioFromBounds(
      Math.min(minX, p.x),
      Math.max(maxX, p.x),
      Math.min(minY, p.y),
      Math.max(maxY, p.y),
    )
    if (bias === 'landscape') {
      return Math.pow(ar, GROWTH_BIAS_EXP)
    }
    const tall = ar > 1e-9 ? 1 / ar : 1e9
    return Math.pow(tall, GROWTH_BIAS_EXP)
  })
  let total = 0
  for (const w of weights) total += w
  let r = nextFloat(rng) * total
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i]!
    if (r <= 0) return candidates[i]!
  }
  return candidates[candidates.length - 1]!
}

function growBlobCoords(rng: Rng, size: number, bias: BoardGrowthBias): Map<string, HexCoord> {
  const set = new Map<string, HexCoord>()
  set.set(coordKey(0, 0), { q: 0, r: 0 })

  while (set.size < size) {
    const frontier: string[] = []
    for (const [k, c] of set) {
      const hasOutside = axialNeighbors(c).some((n) => !set.has(coordKey(n.q, n.r)))
      if (hasOutside) frontier.push(k)
    }
    if (frontier.length === 0) break

    const scored = frontier.map((k) => {
      const c = set.get(k)!
      const deg = axialNeighbors(c).filter((n) => set.has(coordKey(n.q, n.r))).length
      return { k, deg, w: nextFloat(rng) * (0.35 + deg * 0.65) }
    })
    scored.sort((a, b) => a.w - b.w)
    const pickIdx = Math.min(scored.length - 1, Math.floor(nextFloat(rng) * Math.min(4, scored.length)))
    const pickKey = scored[pickIdx].k
    const c = set.get(pickKey)!

    const candidates = axialNeighbors(c).filter((n) => !set.has(coordKey(n.q, n.r)))
    if (candidates.length === 0) continue
    const chosen = pickAspectBiasedNeighbor(rng, set, candidates, bias)
    set.set(coordKey(chosen.q, chosen.r), chosen)
  }

  return set
}

function buildNeighbors(coordMap: Map<string, HexCoord>): Map<string, string[]> {
  const adj = new Map<string, string[]>()
  for (const [k, c] of coordMap) {
    const ns: string[] = []
    for (const n of axialNeighbors(c)) {
      const nk = coordKey(n.q, n.r)
      if (coordMap.has(nk)) ns.push(nk)
    }
    adj.set(k, ns)
  }
  return adj
}

function layoutCenters(
  coordMap: Map<string, HexCoord>,
  baseSize: number,
): { centers: Map<string, { x: number; y: number }>; radius: number } {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  const raw = new Map<string, { x: number; y: number }>()
  for (const [k, c] of coordMap) {
    const p = axialToPixel(c, baseSize)
    raw.set(k, p)
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const centers = new Map<string, { x: number; y: number }>()
  for (const [k, p] of raw) {
    centers.set(k, { x: p.x - cx, y: p.y - cy })
  }
  const radius = baseSize
  return { centers, radius }
}

export interface GeneratedBoard {
  tiles: Record<string, HexTile>
  tileIds: string[]
  hexRadius: number
  routes: [string, string][]
  islandCount: IslandCount
}

/** `rect` = axis-aligned block of hexes (Full preset); `organic` = grown blob. */
export type BoardLayoutMode = 'organic' | 'rect'

export interface GenerateBoardOptions {
  growthBias?: BoardGrowthBias
  islandCount?: IslandCount
  /** When false, skip interior lake carving (single-island only). @default true */
  lakes?: boolean
  /** `rect` fills a rectangular silhouette in world space (single-island only). @default organic */
  layout?: BoardLayoutMode
}

const LAKE_MIN_TARGET = 36
const LAKE_FR = 0.07
const LAKE_MIN_REM = 3
const LAKE_MAX_REM = 24

export function generateBoard(rng: Rng, size: number, opts?: GenerateBoardOptions): GeneratedBoard {
  const growthBias = opts?.growthBias ?? 'landscape'
  const requestedIslands =
    opts?.islandCount !== undefined ? clampIslandCount(opts.islandCount) : DEFAULT_ISLAND_COUNT
  const target = clampBoardHexCount(size)
  const kEff = effectiveIslandCount(requestedIslands, target)
  const maxNeighbor1 = maxDegreeOneTiles(target)
  const maxAttempts = target > 90 ? 260 : target > 60 ? 200 : 120
  let attempt = 0
  const baseRngState = rng.state

  outer: while (attempt < maxAttempts) {
    rng.state = (baseRngState + attempt * 0x9e3779b9) >>> 0

    let coordMap: Map<string, HexCoord>
    let islandOfKey: Map<string, number>

    const useRectLayout = opts?.layout === 'rect' && kEff === 1

    if (kEff === 1 && useRectLayout) {
      const rectMap = growRectangularHexCoords(rng, target, growthBias)
      if (!rectMap || rectMap.size !== target) {
        attempt++
        continue
      }
      coordMap = rectMap
      islandOfKey = new Map()
      for (const k of coordMap.keys()) islandOfKey.set(k, 0)
    } else if (kEff === 1) {
      let growTarget = target
      let lakeRemove = 0
      const useLakes = (opts?.lakes !== false) && target >= LAKE_MIN_TARGET
      if (useLakes) {
        lakeRemove = Math.min(LAKE_MAX_REM, Math.max(LAKE_MIN_REM, Math.floor(target * LAKE_FR)))
        growTarget = target + lakeRemove
      }
      coordMap = growBlobCoords(rng, growTarget, growthBias)
      if (coordMap.size !== growTarget) {
        attempt++
        continue
      }
      if (useLakes && lakeRemove > 0) {
        const carved = carveInteriorLakes(rng, coordMap, lakeRemove)
        if (!carved || carved.size !== target) {
          attempt++
          continue
        }
        coordMap = carved
      }
      islandOfKey = new Map()
      for (const k of coordMap.keys()) islandOfKey.set(k, 0)
    } else {
      const sizes = splitIslandSizes(target, kEff)
      if (!sizes) {
        attempt++
        continue
      }
      const blobs = sizes.map((sz) => growBlobCoords(rng, sz, growthBias))
      if (blobs.some((b, i) => b.size !== sizes[i]!)) {
        attempt++
        continue
      }
      const layout = mergeIslandLayouts(rng, blobs)
      if (!layout) {
        attempt++
        continue
      }
      coordMap = layout.merged
      islandOfKey = layout.islandOfKey
    }

    const adjKeys = buildNeighbors(coordMap)
    const baseSize = 1
    const { centers, radius } = layoutCenters(coordMap, baseSize)

    const tiles: Record<string, HexTile> = {}
    const tileIds: string[] = []
    for (const [key, c] of coordMap) {
      const id = `h-${key}`
      tileIds.push(id)
      const nIds = (adjKeys.get(key) ?? []).map((nk) => `h-${nk}`)
      const center = centers.get(key)!
      tiles[id] = {
        id,
        coord: c,
        islandIndex: islandOfKey.get(key)!,
        neighbors: nIds,
        owner: 1,
        dice: 1,
        center: { x: center.x, y: center.y },
      }
    }

    const gridAdj: Record<string, string[]> = {}
    for (const id of tileIds) {
      gridAdj[id] = [...tiles[id].neighbors]
    }

    if (kEff === 1) {
      if (!validateConnectivity(tiles, tileIds, target)) {
        attempt++
        continue
      }
    } else {
      for (let ii = 0; ii < kEff; ii++) {
        if (!validateIslandConnected(tiles, tileIds, ii, gridAdj)) {
          attempt++
          continue outer
        }
      }
    }

    if (countDegreeOne(tiles) > maxNeighbor1) {
      attempt++
      continue
    }

    if (!useRectLayout) {
      const b = pixelBoundsOfCoordSet(coordMap)
      const aspect = pixelAspectRatioFromBounds(b.minX, b.maxX, b.minY, b.maxY)
      const relaxAspect = attempt >= maxAttempts - ASPECT_RELAX_LAST_ATTEMPTS
      if (!relaxAspect) {
        if (growthBias === 'landscape' && aspect < MIN_BOARD_PIXEL_ASPECT) {
          attempt++
          continue
        }
        if (growthBias === 'portrait' && aspect > MAX_BOARD_PIXEL_ASPECT_PORTRAIT) {
          attempt++
          continue
        }
      }
    }

    const routes = kEff === 1 ? [] : placeRoutesMultiIsland(rng, tiles, tileIds, gridAdj, kEff)

    if (!validateAdjacencySymmetric(tiles)) {
      attempt++
      continue
    }
    if (!validateConnectivity(tiles, tileIds, target)) {
      attempt++
      continue
    }

    return { tiles, tileIds, hexRadius: radius, routes, islandCount: kEff }
  }

  throw new Error(`Failed to generate valid ${target}-hex board`)
}

function clampPlayerCountBoard(n: number): number {
  return Math.min(PLAYER_COUNT_MAX, Math.max(PLAYER_COUNT_MIN, Math.floor(Number(n))))
}

export function assignRandomOwners(
  rng: Rng,
  tiles: Record<string, HexTile>,
  tileIds: string[],
  playerCount: number,
): void {
  const pc = clampPlayerCountBoard(playerCount)
  const ids = [...tileIds]
  shuffleInPlace(rng, ids)
  ids.forEach((id, i) => {
    tiles[id].owner = ((i % pc) + 1) as PlayerId
  })
}

export type { BoardHexPreset } from './types'
