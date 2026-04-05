import { describe, expect, it } from 'vitest'
import {
  beginPlacementFromPregame,
  buildPlacementOrder,
  clampDiceMax,
  createInitialGameState,
  endAttackPhase,
  flushReinforcementAnimation,
  MAX_DICE_PER_HEX,
  placementClick,
  SKIP_PLACEMENT_DICE_PER_TILE_MULT,
  tickReinforcementAnimation,
} from './rules'

describe('buildPlacementOrder', () => {
  it('snakes forward and back for N players', () => {
    expect(buildPlacementOrder(2)).toEqual([1, 2, 2, 1])
    expect(buildPlacementOrder(3)).toEqual([1, 2, 3, 3, 2, 1])
    expect(buildPlacementOrder(3).length).toBe(6)
  })
})

describe('skip placement start', () => {
  it('gives each player mult× their hex count in dice (1–8 per hex) and starts in battle', () => {
    const s = createInitialGameState(22, { playerCount: 3 })
    const pc = s.playerCount
    for (let p = 1; p <= pc; p++) {
      const mine = s.tileIds.filter((id) => s.tiles[id].owner === p)
      const sum = mine.reduce((acc, id) => acc + s.tiles[id].dice, 0)
      expect(sum).toBe(SKIP_PLACEMENT_DICE_PER_TILE_MULT * mine.length)
      for (const id of mine) {
        expect(s.tiles[id].dice).toBeGreaterThanOrEqual(1)
        expect(s.tiles[id].dice).toBeLessThanOrEqual(MAX_DICE_PER_HEX)
      }
    }
    expect(beginPlacementFromPregame(s)).toBeNull()
    expect(s.phase).toBe('BATTLE')
    expect(s.currentPlayer).toBe(1)
  })
})

describe('MAX_DICE_PER_HEX', () => {
  it('clampDiceMax never exceeds 8', () => {
    expect(clampDiceMax(7)).toBe(7)
    expect(clampDiceMax(8)).toBe(8)
    expect(clampDiceMax(9)).toBe(8)
    expect(clampDiceMax(100)).toBe(MAX_DICE_PER_HEX)
  })

  it('placement does not raise dice above 8', () => {
    const s = createInitialGameState(20, { skipPlacementStart: false })
    beginPlacementFromPregame(s)
    const p = s.currentPlayer
    const hex = s.tileIds.find((id) => s.tiles[id].owner === p)!
    s.tiles = { ...s.tiles, [hex]: { ...s.tiles[hex], dice: 8 } }
    expect(placementClick(s, hex)).toBeNull()
    expect(s.tiles[hex].dice).toBe(8)
  })
})

describe('placement one die per click', () => {
  it('adds one die per click and advances turn after five clicks', () => {
    const s = createInitialGameState(20, { skipPlacementStart: false })
    beginPlacementFromPregame(s)
    const p0 = s.currentPlayer
    const owned = s.tileIds.filter((id) => s.tiles[id].owner === p0)
    expect(owned.length).toBeGreaterThan(0)
    const h = owned[0]
    const d0 = s.tiles[h].dice
    for (let i = 0; i < 5; i++) {
      expect(s.placement.diceLeftThisTurn).toBe(5 - i)
      expect(placementClick(s, h)).toBeNull()
    }
    expect(s.tiles[h].dice).toBe(d0 + 5)
    expect(s.currentPlayer).not.toBe(p0)
    expect(s.placement.diceLeftThisTurn).toBe(5)
  })

  it('can spread five dice across different owned hexes', () => {
    const s = createInitialGameState(25, { skipPlacementStart: false })
    beginPlacementFromPregame(s)
    const p = s.currentPlayer
    const mine = s.tileIds.filter((id) => s.tiles[id].owner === p)
    expect(mine.length).toBeGreaterThanOrEqual(2)
    const a = mine[0]
    const b = mine[1]
    expect(placementClick(s, a)).toBeNull()
    expect(placementClick(s, b)).toBeNull()
    expect(placementClick(s, a)).toBeNull()
    expect(placementClick(s, b)).toBeNull()
    expect(placementClick(s, a)).toBeNull()
    expect(s.placement.diceLeftThisTurn).toBe(5)
    expect(s.tiles[a].dice).toBeGreaterThanOrEqual(3)
    expect(s.tiles[b].dice).toBeGreaterThanOrEqual(2)
    expect(s.currentPlayer).not.toBe(p)
  })
})

describe('reinforcement animation', () => {
  it('queues dice then tick applies one at a time', () => {
    const s = createInitialGameState(15, { skipPlacementStart: false })
    beginPlacementFromPregame(s)
    // Skip to battle — not worth full placement; set phase manually with tiles
    s.phase = 'BATTLE'
    s.currentPlayer = 1
    s.battle = { subPhase: 'CHOOSING_ATTACK', selection: {} }
    const owned = s.tileIds.filter((id) => s.tiles[id].owner === 1)
    const before = owned.map((id) => s.tiles[id].dice)
    endAttackPhase(s)
    expect(s.reinforcementAnimation).toBeDefined()
    const n = s.reinforcementAnimation!.hexIds.length
    expect(n).toBeGreaterThan(0)
    for (let i = 0; i < n; i++) {
      tickReinforcementAnimation(s)
    }
    expect(s.reinforcementAnimation).toBeUndefined()
    expect(s.currentPlayer).toBe(2)
    const after = owned.map((id) => s.tiles[id].dice)
    const gained = after.reduce((acc, v, i) => acc + (v - before[i]), 0)
    expect(gained).toBe(n)
  })

  it('flush completes animation in one go', () => {
    const s = createInitialGameState(15)
    s.phase = 'BATTLE'
    s.currentPlayer = 1
    s.battle = { subPhase: 'CHOOSING_ATTACK', selection: {} }
    endAttackPhase(s)
    if (!s.reinforcementAnimation) return
    flushReinforcementAnimation(s)
    expect(s.reinforcementAnimation).toBeUndefined()
  })

  it('skips reinforcement when every owned hex is already at max dice', () => {
    const s = createInitialGameState(20, { skipPlacementStart: false })
    beginPlacementFromPregame(s)
    s.phase = 'BATTLE'
    s.currentPlayer = 1
    s.battle = { subPhase: 'CHOOSING_ATTACK', selection: {} }
    for (const id of s.tileIds) {
      if (s.tiles[id].owner === 1) {
        s.tiles[id] = { ...s.tiles[id], dice: MAX_DICE_PER_HEX }
      }
    }
    endAttackPhase(s)
    expect(s.reinforcementAnimation).toBeUndefined()
    expect(s.currentPlayer).toBe(2)
  })
})
