/** Straight route segments between hex edge ports (world space, pointy-top hexes). */

import { hexEdgePortBoardOutside } from './hex'

export interface XY {
  x: number
  y: number
}

/** Match GameCanvas hex inset (center → vertex). */
export const ROUTE_HEX_RIM = 0.98

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

/** Both ports sit on the **outer** board perimeter (away from `boardC`). */
export function routeEdgePorts(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  boardC: XY,
  hexR: number = ROUTE_HEX_RIM,
): { pa: XY; pb: XY } {
  return {
    pa: hexEdgePortBoardOutside(ax, ay, boardC.x, boardC.y, hexR),
    pb: hexEdgePortBoardOutside(bx, by, boardC.x, boardC.y, hexR),
  }
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

/** Proper crossing only — shared endpoints (same port) do not count. */
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
