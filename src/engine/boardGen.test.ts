import { describe, expect, it } from 'vitest'
import { createRng } from './rng'
import {
  generateBoard,
  validateAdjacencySymmetric,
  validateConnectivity,
  validateCount,
  BOARD_HEX_MIN,
} from './boardGen'

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
      const { tiles, tileIds } = generateBoard(rng, 40)
      const ar = centerAspect(tiles, tileIds)
      sum += ar
      minAr = Math.min(minAr, ar)
    }
    expect(minAr).toBeGreaterThanOrEqual(1)
    expect(sum / trials).toBeGreaterThan(1.06)
  })
})
