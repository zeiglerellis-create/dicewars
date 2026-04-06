import { describe, expect, it } from 'vitest'
import { createRng } from './rng'
import {
  BOARD_HEX_MIN,
  generateBoard,
  validateAdjacencySymmetric,
  validateConnectivity,
  validateCount,
} from './boardGen'

describe('routes', () => {
  it('single-island: no routes; grid-only adjacency', () => {
    const rng = createRng(1202)
    const { tiles, tileIds, routes, islandCount } = generateBoard(rng, 40, { islandCount: 1 })
    expect(islandCount).toBe(1)
    expect(routes).toEqual([])
    expect(validateAdjacencySymmetric(tiles)).toBe(true)
    expect(validateConnectivity(tiles, tileIds, 40)).toBe(true)
    for (const id of tileIds) {
      expect(tiles[id].neighbors.length).toBeLessThanOrEqual(6)
    }
  })

  it('multi-island: each island has at least two route incidences', () => {
    const rng = createRng(3311)
    const { tiles, tileIds, routes, islandCount } = generateBoard(rng, 40, { islandCount: 2 })
    expect(islandCount).toBe(2)
    expect(routes.length).toBeGreaterThanOrEqual(2)
    expect(validateConnectivity(tiles, tileIds, 40)).toBe(true)
    const deg = [0, 0]
    for (const [a, b] of routes) {
      deg[tiles[a].islandIndex]++
      deg[tiles[b].islandIndex]++
    }
    expect(deg[0]).toBeGreaterThanOrEqual(2)
    expect(deg[1]).toBeGreaterThanOrEqual(2)
  })

  it('uses three landmasses when hex budget allows', () => {
    const rng = createRng(9001)
    const { islandCount } = generateBoard(rng, 40, { islandCount: 3 })
    expect(islandCount).toBe(3)
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
