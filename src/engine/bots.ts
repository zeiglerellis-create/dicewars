import { rollD6, type Rng } from './rng'
import {
  countEnemyNeighbors,
  enemyNeighborDiceTotal,
  largestComponentIfOwner,
  largestConnectedComponentSize,
} from './scoring'
import type { GameState, PlayerId } from './types'
import {
  battleAttack,
  battleSelectAttacker,
  endAttackPhase,
  flushReinforcementAnimation,
  MAX_DICE_PER_HEX,
  placementClick,
} from './rules'

function placementHexScore(state: GameState, hexId: string, player: PlayerId): number {
  const t = state.tiles[hexId]
  if (!t || t.owner !== player) return -Infinity
  const enemies = countEnemyNeighbors(t, state.tiles)
  const pressure = enemyNeighborDiceTotal(t, state.tiles)
  let score = 0
  if (enemies >= 1) score += 3
  if (enemies >= 2) score += 2
  score += pressure / 10
  if (t.dice <= 2) score += 1
  return score
}

export function botChoosePlacementHex(state: GameState, player: PlayerId): string | null {
  const mine = state.tileIds.filter((id) => state.tiles[id].owner === player)
  const pool = mine.filter((id) => state.tiles[id].dice < MAX_DICE_PER_HEX)
  const candidates = pool.length > 0 ? pool : mine
  if (candidates.length === 0) return null

  let best: string | null = null
  let bestScore = -Infinity
  for (const id of candidates) {
    const s = placementHexScore(state, id, player)
    if (s > bestScore) {
      bestScore = s
      best = id
    }
  }
  return best
}

export function runBotPlacement(state: GameState): void {
  if (state.phase !== 'PLACEMENT') return
  for (let i = 0; i < 5 && state.phase === 'PLACEMENT'; i++) {
    const p = state.currentPlayer
    if (!state.players.isBot[p]) break
    const hex = botChoosePlacementHex(state, p)
    if (!hex) break
    placementClick(state, hex)
  }
}

function mcWinProbability(rng: Rng, attackerDice: number, defenderDice: number, trials: number): number {
  let wins = 0
  for (let t = 0; t < trials; t++) {
    let ar = 0
    let dr = 0
    for (let i = 0; i < attackerDice; i++) ar += rollD6(rng)
    for (let i = 0; i < defenderDice; i++) dr += rollD6(rng)
    if (ar > dr) wins++
  }
  return wins / trials
}

interface AttackCand {
  attackerId: string
  defenderId: string
  winProb: number
  componentScore: number
}

export function enumerateAttacks(state: GameState, player: PlayerId): AttackCand[] {
  const rng: Rng = { state: state.rngState }
  const out: AttackCand[] = []
  const beforeSize = largestConnectedComponentSize(player, state.tiles, state.tileIds)

  for (const id of state.tileIds) {
    const a = state.tiles[id]
    if (a.owner !== player || a.dice < 2) continue
    for (const nid of a.neighbors) {
      const d = state.tiles[nid]
      if (!d || d.owner === player) continue
      const winProb = mcWinProbability(rng, a.dice, d.dice, 200)
      const afterSize = largestComponentIfOwner(state.tiles, state.tileIds, nid, player)
      const componentScore = afterSize - beforeSize
      out.push({ attackerId: id, defenderId: nid, winProb, componentScore })
    }
  }

  state.rngState = rng.state
  return out
}

export function botPickBestAttack(state: GameState): AttackCand | null {
  const p = state.currentPlayer
  const cands = enumerateAttacks(state, p).filter((c) => c.winProb >= 0.55)
  if (cands.length === 0) return null
  cands.sort((a, b) => {
    if (b.winProb !== a.winProb) return b.winProb - a.winProb
    return b.componentScore - a.componentScore
  })
  return cands[0]
}

export function runBotBattleAttack(state: GameState): boolean {
  const p = state.currentPlayer
  if (!state.players.isBot[p] || state.phase !== 'BATTLE' || state.battle.subPhase !== 'CHOOSING_ATTACK') {
    return false
  }
  const best = botPickBestAttack(state)
  if (!best) return false
  battleSelectAttacker(state, best.attackerId)
  battleAttack(state, best.defenderId)
  return true
}

export function runBotEndAttackAndReinforce(state: GameState): void {
  const p = state.currentPlayer
  if (!state.players.isBot[p] || state.phase !== 'BATTLE') return
  if (state.battle.subPhase === 'CHOOSING_ATTACK') {
    endAttackPhase(state)
  }
}

/**
 * Instantly resolves bot placement and battle steps until the current player is human
 * or the game ends. Used by “Skip AI” so delays can be bypassed.
 */
export function fastForwardBotsToHumanTurn(state: GameState): void {
  let guard = 0
  while (guard++ < 600) {
    if (state.phase === 'GAME_OVER') return
    const p = state.currentPlayer
    if (!state.players.isBot[p]) return

    if (state.phase === 'PLACEMENT') {
      runBotPlacement(state)
      continue
    }

    if (state.phase === 'BATTLE') {
      if (state.battle.subPhase !== 'CHOOSING_ATTACK') return
      if (runBotBattleAttack(state)) continue
      runBotEndAttackAndReinforce(state)
      flushReinforcementAnimation(state)
      continue
    }

    return
  }
}
