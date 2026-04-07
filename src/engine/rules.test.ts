import { describe, expect, it } from 'vitest'
import { battleOutcome, stalemateManualReinforceTrigger } from './rules'
import type { GameState, PlayerId } from './types'

function minimalTiles(
  ownersAndDice: { owner: PlayerId; dice: number }[],
): { tiles: GameState['tiles']; tileIds: string[] } {
  const tiles: GameState['tiles'] = {}
  const tileIds: string[] = []
  ownersAndDice.forEach((o, i) => {
    const id = `h${i}`
    tileIds.push(id)
    tiles[id] = {
      id,
      coord: { q: i, r: 0 },
      islandIndex: 0,
      neighbors: [],
      owner: o.owner,
      dice: o.dice,
      center: { x: i, y: 0 },
    }
  })
  return { tiles, tileIds }
}

describe('battleOutcome', () => {
  it('on win: attacker becomes 1, defender dice = old attacker - 1', () => {
    const o = battleOutcome(5, 3, 30, 10)
    expect(o.attackerWins).toBe(true)
    expect(o.attackerDiceAfter).toBe(1)
    expect(o.defenderDiceAfter).toBe(4)
  })

  it('on loss: attacker becomes 1, defender unchanged', () => {
    const o = battleOutcome(4, 2, 5, 18)
    expect(o.attackerWins).toBe(false)
    expect(o.attackerDiceAfter).toBe(1)
    expect(o.defenderDiceAfter).toBe(2)
  })

  it('tie goes to defender', () => {
    const o = battleOutcome(3, 2, 12, 12)
    expect(o.attackerWins).toBe(false)
    expect(o.attackerDiceAfter).toBe(1)
    expect(o.defenderDiceAfter).toBe(2)
  })

  it('never produces attacker dice below 1', () => {
    for (let a = 2; a <= 8; a++) {
      for (let d = 1; d <= 8; d++) {
        const win = battleOutcome(a, d, 100, 0)
        const lose = battleOutcome(a, d, 0, 100)
        expect(win.attackerDiceAfter).toBeGreaterThanOrEqual(1)
        expect(lose.attackerDiceAfter).toBeGreaterThanOrEqual(1)
        expect(win.defenderDiceAfter).toBeGreaterThanOrEqual(1)
        expect(lose.defenderDiceAfter).toBeGreaterThanOrEqual(1)
      }
    }
  })
})

describe('stalemateManualReinforceTrigger', () => {
  it('is true with 2 players and average dice >= 7', () => {
    const { tiles, tileIds } = minimalTiles([
      { owner: 1, dice: 8 },
      { owner: 1, dice: 8 },
      { owner: 2, dice: 8 },
      { owner: 2, dice: 6 },
    ])
    const state = {
      tileIds,
      tiles,
    } as Pick<GameState, 'tileIds' | 'tiles'>
    expect(stalemateManualReinforceTrigger(state as GameState)).toBe(true)
  })

  it('is false with 3 players', () => {
    const { tiles, tileIds } = minimalTiles([
      { owner: 1, dice: 8 },
      { owner: 2, dice: 8 },
      { owner: 3, dice: 8 },
    ])
    const state = { tileIds, tiles } as Pick<GameState, 'tileIds' | 'tiles'>
    expect(stalemateManualReinforceTrigger(state as GameState)).toBe(false)
  })

  it('is false when average below 7', () => {
    const { tiles, tileIds } = minimalTiles([
      { owner: 1, dice: 6 },
      { owner: 1, dice: 6 },
      { owner: 2, dice: 6 },
      { owner: 2, dice: 6 },
    ])
    const state = { tileIds, tiles } as Pick<GameState, 'tileIds' | 'tiles'>
    expect(stalemateManualReinforceTrigger(state as GameState)).toBe(false)
  })
})
