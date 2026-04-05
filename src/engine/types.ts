/** In-game player slot 1 … playerCount (max 8). */
export type PlayerId = number

export const PLAYER_COUNT_MIN = 2
export const PLAYER_COUNT_MAX = 8

export interface HexCoord {
  q: number
  r: number
}

export interface HexTile {
  id: string
  coord: HexCoord
  neighbors: string[]
  owner: PlayerId
  dice: number
  center: { x: number; y: number }
}

export type Phase = 'PREGAME' | 'PLACEMENT' | 'BATTLE' | 'GAME_OVER'
export type BattleSubPhase = 'CHOOSING_ATTACK'

export interface BattleLogEntry {
  id: string
  attackerPlayer: PlayerId
  defenderPlayer: PlayerId
  attackerHexId: string
  defenderHexId: string
  attackerRoll: number
  defenderRoll: number
  attackerDiceBefore: number
  defenderDiceBefore: number
  winner: 'attacker' | 'defender'
}

export interface PlacementState {
  remainingByPlayer: Record<PlayerId, number>
  /** Snake: 1…N then N…1, five dice per step per player */
  order: PlayerId[]
  orderIndex: number
  /** Dice left to place this turn (one per click on any owned hex). */
  diceLeftThisTurn: number
}

export interface BattleUiState {
  subPhase: BattleSubPhase
  selection: {
    selectedAttackerHexId?: string
    selectedDefenderHexId?: string
  }
}

export interface GameState {
  /** Number of hexes on this map (30–100). */
  boardHexCount: number
  /** Active players in this session (2–8). */
  playerCount: number
  /**
   * If true, start in battle with dice pre-placed: each player gets 4× their starting hex count,
   * spread randomly across their tiles (still max 8 per hex). Skips placement phase.
   */
  skipPlacementStart: boolean
  rngState: number
  phase: Phase
  currentPlayer: PlayerId
  tiles: Record<string, HexTile>
  tileIds: string[]
  placement: PlacementState
  battle: BattleUiState
  players: {
    colors: Record<PlayerId, string>
    isBot: Record<PlayerId, boolean>
  }
  logs: BattleLogEntry[]
  winner?: PlayerId
  /** Last battle rolls for overlay (cleared on next action) */
  lastBattleOverlay?: {
    attackerRoll: number
    defenderRoll: number
    winner: 'attacker' | 'defender'
  }
  /** End-of-turn reinforcements being applied one die at a time */
  reinforcementAnimation?: {
    endingPlayer: PlayerId
    hexIds: string[]
    appliedCount: number
  }
  /** Latest reinforcement +1 for float animation (UI may clear after display) */
  reinforcementPop?: { hexId: string; seq: number }
  /**
   * Extra adjacency (wormholes): each pair is two distinct perimeter hexes linked for movement,
   * attacks, and largest-cluster scoring. Generated with the map.
   */
  tunnels: [string, string][]
}
