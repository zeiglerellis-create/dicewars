import type { BattleLogEntry } from '../engine/types'

export function formatBattleLogLine(e: BattleLogEntry): string {
  const who = e.winner === 'attacker' ? 'Attacker wins' : 'Defender wins'
  return `P${e.attackerPlayer} vs P${e.defenderPlayer}: ${e.attackerRoll}–${e.defenderRoll} — ${who}`
}
