import { describe, expect, it } from 'vitest'
import type { HexTile, PlayerId } from './types'
import { countTilesOwnedBy, largestConnectedComponentSize, playerTerritoryStats } from './scoring'

function makeTile(
  id: string,
  neighbors: string[],
  owner: PlayerId,
  dice = 1,
): HexTile {
  return {
    id,
    coord: { q: 0, r: 0 },
    islandIndex: 0,
    neighbors,
    owner,
    dice,
    center: { x: 0, y: 0 },
  }
}

describe('countTilesOwnedBy', () => {
  it('counts tiles for a player', () => {
    const tiles: Record<string, HexTile> = {
      h1: makeTile('h1', [], 1),
      h2: makeTile('h2', [], 1),
      h3: makeTile('h3', [], 2),
    }
    const tileIds = ['h1', 'h2', 'h3']
    expect(countTilesOwnedBy(1, tiles, tileIds)).toBe(2)
    expect(countTilesOwnedBy(2, tiles, tileIds)).toBe(1)
  })
})

describe('playerTerritoryStats', () => {
  it('combines owned count, total dice, and largest component', () => {
    const tiles: Record<string, HexTile> = {
      a: makeTile('a', ['b'], 1, 2),
      b: makeTile('b', ['a'], 1, 3),
      c: makeTile('c', [], 1, 4),
    }
    const tileIds = ['a', 'b', 'c']
    expect(playerTerritoryStats(1, tiles, tileIds)).toEqual({
      owned: 3,
      totalDice: 9,
      largestTouchingGroup: 2,
    })
  })
})

describe('largestConnectedComponentSize', () => {
  it('returns max component size on a known small graph', () => {
    /** 1 — 2 — 3 and 4 (isolated), all player 1 */
    const tiles: Record<string, HexTile> = {
      h1: makeTile('h1', ['h2'], 1),
      h2: makeTile('h2', ['h1', 'h3'], 1),
      h3: makeTile('h3', ['h2'], 1),
      h4: makeTile('h4', [], 1),
    }
    const tileIds = ['h1', 'h2', 'h3', 'h4']
    expect(largestConnectedComponentSize(1, tiles, tileIds)).toBe(3)
    expect(largestConnectedComponentSize(2, tiles, tileIds)).toBe(0)
  })

  it('counts two blobs and takes the larger', () => {
    const tiles: Record<string, HexTile> = {
      a: makeTile('a', ['b'], 1),
      b: makeTile('b', ['a'], 1),
      c: makeTile('c', ['d', 'e'], 1),
      d: makeTile('d', ['c'], 1),
      e: makeTile('e', ['c'], 1),
    }
    const tileIds = ['a', 'b', 'c', 'd', 'e']
    expect(largestConnectedComponentSize(1, tiles, tileIds)).toBe(3)
  })
})
