import { axialNeighbors, axialToPixel, coordKey } from './hex'
import { PLAYER_COUNT_MAX, PLAYER_COUNT_MIN, type HexCoord, type HexTile, type PlayerId } from './types'
import type { Rng } from './rng'
import { nextFloat, shuffleInPlace } from './rng'

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
export const BOARD_HEX_MAX = 100

/** Quick size buttons on the setup panel (clamped to min/max). */
export const BOARD_HEX_PRESETS = [20, 40, 60] as const
export type BoardHexPreset = (typeof BOARD_HEX_PRESETS)[number]

export function clampBoardHexCount(n: number): number {
  return Math.min(BOARD_HEX_MAX, Math.max(BOARD_HEX_MIN, Math.floor(Number(n))))
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
}

export interface GenerateBoardOptions {
  growthBias?: BoardGrowthBias
}

export function generateBoard(rng: Rng, size: number, opts?: GenerateBoardOptions): GeneratedBoard {
  const growthBias = opts?.growthBias ?? 'landscape'
  const target = clampBoardHexCount(size)
  const maxNeighbor1 = maxDegreeOneTiles(target)
  const maxAttempts = target > 60 ? 150 : 90
  let attempt = 0
  const baseRngState = rng.state

  while (attempt < maxAttempts) {
    rng.state = (baseRngState + attempt * 0x9e3779b9) >>> 0
    const coordMap = growBlobCoords(rng, target, growthBias)
    if (coordMap.size !== target) {
      attempt++
      continue
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
        neighbors: nIds,
        owner: 1,
        dice: 1,
        center: { x: center.x, y: center.y },
      }
    }

    if (!validateConnectivity(tiles, tileIds, target)) {
      attempt++
      continue
    }

    if (countDegreeOne(tiles) > maxNeighbor1) {
      attempt++
      continue
    }

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

    return { tiles, tileIds, hexRadius: radius }
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
