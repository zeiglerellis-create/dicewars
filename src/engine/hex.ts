import type { HexCoord } from './types'

/** Axial directions for pointy-top hexes (q,r). */
export const AXIAL_DIRS: HexCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

export function coordKey(q: number, r: number): string {
  return `${q},${r}`
}

export function parseKey(key: string): HexCoord {
  const [q, r] = key.split(',').map(Number)
  return { q, r }
}

export function addAxial(a: HexCoord, b: HexCoord): HexCoord {
  return { q: a.q + b.q, r: a.r + b.r }
}

export function axialNeighbors(coord: HexCoord): HexCoord[] {
  return AXIAL_DIRS.map((d) => addAxial(coord, d))
}

/** Hex grid steps between centers (axial / cube distance). */
export function axialDistance(a: HexCoord, b: HexCoord): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2
}

/** Pointy-top axial → pixel (center). `size` = distance center → vertex. */
export function axialToPixel(coord: HexCoord, size: number): { x: number; y: number } {
  const x = size * Math.sqrt(3) * (coord.q + coord.r / 2)
  const y = size * (3 / 2) * coord.r
  return { x, y }
}

/** Corners for pointy-top hex, first vertex at top (-90°). */
export function hexCorners(
  cx: number,
  cy: number,
  size: number,
): { x: number; y: number }[] {
  const corners: { x: number; y: number }[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (-Math.PI / 2 + (i * Math.PI) / 3)
    corners.push({
      x: cx + size * Math.cos(angle),
      y: cy + size * Math.sin(angle),
    })
  }
  return corners
}

/**
 * Where a ray from hex center in direction (ux, uy) exits the pointy-top hex boundary.
 * `size` = center → vertex (same as hexCorners).
 */
export function hexEdgePortAlong(
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  size: number,
): { x: number; y: number } {
  const len = Math.hypot(ux, uy) || 1
  const vx = ux / len
  const vy = uy / len
  const corners = hexCorners(cx, cy, size)
  let bestT = Infinity
  let best = { x: cx + vx * size * 0.92, y: cy + vy * size * 0.92 }
  for (let i = 0; i < 6; i++) {
    const p1 = corners[i]!
    const p2 = corners[(i + 1) % 6]!
    const hit = raySegmentHit(cx, cy, vx, vy, p1.x, p1.y, p2.x, p2.y)
    if (hit !== null && hit.t > 1e-7 && hit.t < bestT) {
      bestT = hit.t
      best = { x: cx + vx * hit.t, y: cy + vy * hit.t }
    }
  }
  return best
}

/**
 * Port on the hex edge facing **away from the board centroid** (outer perimeter of the map).
 */
export function hexEdgePortBoardOutside(
  hx: number,
  hy: number,
  boardCx: number,
  boardCy: number,
  size: number,
): { x: number; y: number } {
  let dx = hx - boardCx
  let dy = hy - boardCy
  const dlen = Math.hypot(dx, dy)
  if (dlen < 1e-8) {
    dx = 1
    dy = 0
  }
  return hexEdgePortAlong(hx, hy, dx, dy, size)
}

/** Point where a ray from hex center toward (tx, ty) exits the pointy-top hex boundary. */
export function hexEdgePortToward(
  cx: number,
  cy: number,
  tx: number,
  ty: number,
  size: number,
): { x: number; y: number } {
  return hexEdgePortAlong(cx, cy, tx - cx, ty - cy, size)
}

/** Ray origin + unit direction vs segment; returns distance t along ray to hit, or null. */
function raySegmentHit(
  ox: number,
  oy: number,
  ux: number,
  uy: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { t: number } | null {
  const sx = x2 - x1
  const sy = y2 - y1
  const det = ux * sy - uy * sx
  if (Math.abs(det) < 1e-14) return null
  const qx = x1 - ox
  const qy = y1 - oy
  const t = (qx * sy - qy * sx) / det
  const s = (qx * uy - qy * ux) / det
  if (t <= 1e-7) return null
  if (s < -1e-7 || s > 1 + 1e-7) return null
  return { t }
}

export function pointInConvexPolygon(
  px: number,
  py: number,
  corners: { x: number; y: number }[],
): boolean {
  let inside = false
  const n = corners.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = corners[i].x
    const yi = corners[i].y
    const xj = corners[j].x
    const yj = corners[j].y
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi
    if (intersect) inside = !inside
  }
  return inside
}
