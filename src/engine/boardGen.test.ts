import { describe, expect, it } from 'vitest'
import { createRng } from './rng'
import {
  BOARD_HEX_MIN,
  TUNNEL_PAIR_COUNT,
  generateBoard,
  validateAdjacencySymmetric,
  validateConnectivity,
  validateCount,
} from './boardGen'

describe('tunnels', () => {
  it('adds up to four symmetric links between non-adjacent perimeter hexes', () => {
    const rng = createRng(1202)
    const { tiles, tileIds, tunnels } = generateBoard(rng, 40)
    expect(tunnels.length).toBeGreaterThan(0)
    expect(tunnels.length).toBeLessThanOrEqual(TUNNEL_PAIR_COUNT)
    expect(validateAdjacencySymmetric(tiles)).toBe(true)
    expect(validateConnectivity(tiles, tileIds, 40)).toBe(true)
    const seen = new Set<string>()
    for (const [a, b] of tunnels) {
      expect(a).not.toBe(b)
      expect(tileIds.includes(a)).toBe(true)
      expect(tileIds.includes(b)).toBe(true)
      expect(tiles[a].neighbors.includes(b)).toBe(true)
      expect(tiles[b].neighbors.includes(a)).toBe(true)
      expect(tiles[a].neighbors.length).toBeLessThanOrEqual(7)
      expect(tiles[b].neighbors.length).toBeLessThanOrEqual(7)
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })

  it('often reaches the tunnel budget on 40-hex boards', () => {
    let four = 0
    for (let s = 0; s < 32; s++) {
      const rng = createRng(8800 + s)
      if (generateBoard(rng, 40).tunnels.length === TUNNEL_PAIR_COUNT) four++
    }
    expect(four).toBeGreaterThanOrEqual(20)
  })
})

describe('boardGen', () => {
  it('creates exactly N tiles', () => {
    const rng = createRng(42)
    const { tiles, tileIds } = generateBoard(rng, BOARD_HEX_MIN)
    expect(tileIds.length).toBe(BOARD_HEX_MIN)
    expect(validateCount(tiles, BOARD_HEX_MIN)).toBe(true)
  })

  it('produces a connected board (BFS visits all)', () => {
    const rng = createRng(99)
    const { tiles, tileIds } = generateBoard(rng, 30)
    expect(validateConnectivity(tiles, tileIds, 30)).toBe(true)
  })

  it('has symmetric adjacency', () => {
    for (let seed = 0; seed < 8; seed++) {
      const rng = createRng(1000 + seed)
      const { tiles } = generateBoard(rng, 30)
      expect(validateAdjacencySymmetric(tiles)).toBe(true)
    }
  })

  it('supports larger boards', () => {
    const rng = createRng(7)
    const { tiles, tileIds } = generateBoard(rng, 55)
    expect(tileIds.length).toBe(55)
    expect(validateConnectivity(tiles, tileIds, 55)).toBe(true)
  })

  it('skews toward landscape bounds (width ≥ height in world space)', () => {
    function centerAspect(tiles: Record<string, { center: { x: number; y: number } }>, tileIds: string[]): number {
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const id of tileIds) {
        const { x, y } = tiles[id].center
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
      return (maxX - minX + 1e-9) / (maxY - minY + 1e-9)
    }

    const trials = 48
    let sum = 0
    let minAr = Infinity
    for (let i = 0; i < trials; i++) {
      const rng = createRng(12_000 + i)
      const { tiles, tileIds } = generateBoard(rng, 40, { growthBias: 'landscape' })
      const ar = centerAspect(tiles, tileIds)
      sum += ar
      minAr = Math.min(minAr, ar)
    }
    expect(minAr).toBeGreaterThanOrEqual(1)
    expect(sum / trials).toBeGreaterThan(1.06)
  })

  it('skews toward portrait bounds when growthBias is portrait', () => {
    function centerAspect(tiles: Record<string, { center: { x: number; y: number } }>, tileIds: string[]): number {
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const id of tileIds) {
        const { x, y } = tiles[id].center
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
      return (maxX - minX + 1e-9) / (maxY - minY + 1e-9)
    }

    const trials = 48
    let sum = 0
    let maxAr = 0
    for (let i = 0; i < trials; i++) {
      const rng = createRng(88_000 + i)
      const { tiles, tileIds } = generateBoard(rng, 40, { growthBias: 'portrait' })
      const ar = centerAspect(tiles, tileIds)
      sum += ar
      maxAr = Math.max(maxAr, ar)
    }
    expect(maxAr).toBeLessThanOrEqual(1.02)
    expect(sum / trials).toBeLessThan(0.94)
  })
})
