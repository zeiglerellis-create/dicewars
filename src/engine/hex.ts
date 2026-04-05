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
