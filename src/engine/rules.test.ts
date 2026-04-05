import { describe, expect, it } from 'vitest'
import { battleOutcome } from './rules'

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
