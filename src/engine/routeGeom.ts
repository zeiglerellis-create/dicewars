/** Route geometry: coast ports, inner anchors, straight chords for collision, void curves for drawing. */

import {
  AXIAL_DIRS,
  coordKey,
  hexCorners,
  hexEdgePortBoardOutside,
  pointInConvexPolygon,
} from './hex'
import type { HexTile } from './types'

export interface XY {
  x: number
  y: number
}

export interface RouteEndpoints {
  pa: XY
  pb: XY
  innerA: XY
  innerB: XY
}

/** Match GameCanvas hex inset (center → vertex). */
export const ROUTE_HEX_RIM = 0.98

/** Port sits this far past the coast edge midpoint into the void. */
export const ROUTE_PORT_OUTSET = 0.13

/** Point inside the tile toward the coast — stub line makes ownership obvious. */
export const ROUTE_INNER_ANCHOR_INSET = 0.52

function portPushedOutside(
  hx: number,
  hy: number,
  rimX: number,
  rimY: number,
  outset: number,
): XY {
  const vx = rimX - hx
  const vy = rimY - hy
  const len = Math.hypot(vx, vy) || 1
  return { x: rimX + (vx / len) * outset, y: rimY + (vy / len) * outset }
}

function occupiedCoordKeys(tileIds: string[], tiles: Record<string, HexTile>): Set<string> {
  const s = new Set<string>()
  for (const id of tileIds) {
    const t = tiles[id]
    if (t) s.add(coordKey(t.coord.q, t.coord.r))
  }
  return s
}

/**
 * Coast edge of `id` that best faces `towardX/towardY`, with port in the void and inner anchor on land.
 */
function coastPortAndInner(
  tiles: Record<string, HexTile>,
  occupied: Set<string>,
  id: string,
  towardX: number,
  towardY: number,
  hexR: number,
  portOutset: number,
  innerInset: number,
): { port: XY; inner: XY } | null {
  const t = tiles[id]
  if (!t) return null
  const cx = t.center.x
  const cy = t.center.y
  const twx = towardX - cx
  const twy = towardY - cy
  const twl = Math.hypot(twx, twy) || 1
  const tx = twx / twl
  const ty = twy / twl

  const corners = hexCorners(cx, cy, hexR)
  let bestScore = -2
  let bestMid = { x: cx, y: cy }
  let bestOut = { x: tx, y: ty }

  for (let i = 0; i < 6; i++) {
    const d = AXIAL_DIRS[i]!
    const nk = coordKey(t.coord.q + d.q, t.coord.r + d.r)
    if (occupied.has(nk)) continue

    const mx = (corners[i]!.x + corners[(i + 1) % 6]!.x) / 2
    const my = (corners[i]!.y + corners[(i + 1) % 6]!.y) / 2
    const ox = mx - cx
    const oy = my - cy
    const ol = Math.hypot(ox, oy) || 1
    const ux = ox / ol
    const uy = oy / ol
    const score = ux * tx + uy * ty
    if (score > bestScore) {
      bestScore = score
      bestMid = { x: mx, y: my }
      bestOut = { x: ux, y: uy }
    }
  }

  if (bestScore < -0.95) return null

  const port = {
    x: bestMid.x + bestOut.x * portOutset,
    y: bestMid.y + bestOut.y * portOutset,
  }
  const inner = {
    x: cx + bestOut.x * innerInset,
    y: cy + bestOut.y * innerInset,
  }
  return { port, inner }
}

function innerTowardPort(cx: number, cy: number, px: number, py: number, inset: number): XY {
  const vx = px - cx
  const vy = py - cy
  const len = Math.hypot(vx, vy) || 1
  return { x: cx + (vx / len) * inset, y: cy + (vy / len) * inset }
}

/** Fallback when no coast face found (should be rare). */
function routeEndpointsBoardCentroid(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  boardC: XY,
  hexR: number,
  portOutset: number,
  innerInset: number,
): RouteEndpoints {
  const ra = hexEdgePortBoardOutside(ax, ay, boardC.x, boardC.y, hexR)
  const rb = hexEdgePortBoardOutside(bx, by, boardC.x, boardC.y, hexR)
  const pa = portPushedOutside(ax, ay, ra.x, ra.y, portOutset)
  const pb = portPushedOutside(bx, by, rb.x, rb.y, portOutset)
  return {
    pa,
    pb,
    innerA: innerTowardPort(ax, ay, pa.x, pa.y, innerInset),
    innerB: innerTowardPort(bx, by, pb.x, pb.y, innerInset),
  }
}

/**
 * Route ends on **coast** (void-facing edges), biased toward the partner hex.
 * Inner anchors sit on the tile for a clear “this port belongs here” stub in the UI.
 * Straight chord `pa–pb` is used for intersection tests when placing routes.
 */
export function routeEdgePorts(
  tiles: Record<string, HexTile>,
  tileIds: string[],
  idA: string,
  idB: string,
  boardC: XY,
  hexR: number = ROUTE_HEX_RIM,
  portOutset: number = ROUTE_PORT_OUTSET,
  innerInset: number = ROUTE_INNER_ANCHOR_INSET,
): RouteEndpoints {
  const occ = occupiedCoordKeys(tileIds, tiles)
  const tA = tiles[idA]
  const tB = tiles[idB]
  if (!tA || !tB) {
    throw new Error('routeEdgePorts: unknown tile id')
  }

  const a = coastPortAndInner(tiles, occ, idA, tB.center.x, tB.center.y, hexR, portOutset, innerInset)
  const b = coastPortAndInner(tiles, occ, idB, tA.center.x, tA.center.y, hexR, portOutset, innerInset)

  if (!a || !b) {
    return routeEndpointsBoardCentroid(
      tA.center.x,
      tA.center.y,
      tB.center.x,
      tB.center.y,
      boardC,
      hexR,
      portOutset,
      innerInset,
    )
  }

  return { pa: a.port, pb: b.port, innerA: a.inner, innerB: b.inner }
}

function quadPoint(p0: XY, p1: XY, p2: XY, t: number): XY {
  const u = 1 - t
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  }
}

function pointInAnyLandHex(
  px: number,
  py: number,
  tiles: Record<string, HexTile>,
  tileIds: string[],
  exclude: Set<string>,
  hexHitR: number,
): boolean {
  for (const id of tileIds) {
    if (exclude.has(id)) continue
    const t = tiles[id]
    if (pointInConvexPolygon(px, py, hexCorners(t.center.x, t.center.y, hexHitR))) return true
  }
  return false
}

/**
 * Polyline along a quadratic curve from `pa` to `pb` that stays out of land hexes (except endpoints’ tiles).
 * Bulge increases until samples clear hex interiors or a cap is hit; falls back to a straight segment.
 */
export function routeVoidCurvePoints(
  tiles: Record<string, HexTile>,
  tileIds: string[],
  pa: XY,
  pb: XY,
  boardC: XY,
  routeHexA: string,
  routeHexB: string,
  samples = 44,
): XY[] {
  const ex = new Set([routeHexA, routeHexB])
  const midx = (pa.x + pb.x) / 2
  const midy = (pa.y + pb.y) / 2
  const abx = pb.x - pa.x
  const aby = pb.y - pa.y
  const chord = Math.hypot(abx, aby) || 1
  let nx = -aby / chord
  let ny = abx / chord
  const vx = midx - boardC.x
  const vy = midy - boardC.y
  if (nx * vx + ny * vy < 0) {
    nx = -nx
    ny = -ny
  }
  let bulge = Math.max(0.28, chord * 0.26)
  const hexHitR = ROUTE_HEX_RIM * 0.96

  for (let attempt = 0; attempt < 14; attempt++) {
    const cp = { x: midx + nx * bulge, y: midy + ny * bulge }
    const pts: XY[] = []
    for (let i = 0; i <= samples; i++) {
      pts.push(quadPoint(pa, cp, pb, i / samples))
    }
    let bad = false
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i]!
      if (pointInAnyLandHex(p.x, p.y, tiles, tileIds, ex, hexHitR)) {
        bad = true
        break
      }
    }
    if (!bad) return pts
    bulge *= 1.26
    if (attempt % 4 === 3) {
      nx = -nx
      ny = -ny
    }
  }

  return [pa, pb]
}

export function boardCentroidFromCenters(centers: XY[]): XY {
  let x = 0
  let y = 0
  for (const p of centers) {
    x += p.x
    y += p.y
  }
  const n = centers.length || 1
  return { x: x / n, y: y / n }
}

export function maxRadiusFrom(C: XY, centers: XY[]): number {
  let m = 0
  for (const p of centers) {
    m = Math.max(m, Math.hypot(p.x - C.x, p.y - C.y))
  }
  return m || 1
}

function cross(a: XY, b: XY, c: XY): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function onSeg(a: XY, b: XY, p: XY, eps: number): boolean {
  return (
    p.x >= Math.min(a.x, b.x) - eps &&
    p.x <= Math.max(a.x, b.x) + eps &&
    p.y >= Math.min(a.y, b.y) - eps &&
    p.y <= Math.max(a.y, b.y) + eps &&
    Math.abs(cross(a, b, p)) <= eps * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
  )
}

export function segmentsIntersect(a: XY, b: XY, c: XY, d: XY, eps = 1e-9): boolean {
  const o1 = cross(a, b, c)
  const o2 = cross(a, b, d)
  const o3 = cross(c, d, a)
  const o4 = cross(c, d, b)

  if ((o1 > eps && o2 > eps) || (o1 < -eps && o2 < -eps)) return false
  if ((o3 > eps && o4 > eps) || (o3 < -eps && o4 < -eps)) return false

  if (Math.abs(o1) <= eps && onSeg(a, b, c, 1e-6)) return true
  if (Math.abs(o2) <= eps && onSeg(a, b, d, 1e-6)) return true
  if (Math.abs(o3) <= eps && onSeg(c, d, a, 1e-6)) return true
  if (Math.abs(o4) <= eps && onSeg(c, d, b, 1e-6)) return true

  return true
}

function nearlySame(p: XY, q: XY, eps = 0.05): boolean {
  return Math.hypot(p.x - q.x, p.y - q.y) < eps
}

export function routeSegmentsCross(a: XY, b: XY, c: XY, d: XY): boolean {
  if (nearlySame(a, c) || nearlySame(a, d) || nearlySame(b, c) || nearlySame(b, d)) return false
  return segmentsIntersect(a, b, c, d)
}

export function routeSegmentHitsAny(pa: XY, pb: XY, existing: [XY, XY][]): boolean {
  for (const [c, d] of existing) {
    if (routeSegmentsCross(pa, pb, c, d)) return true
  }
  return false
}
