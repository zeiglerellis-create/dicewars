/** In-game player slot 1 … playerCount (max 8). */
export type PlayerId = number

/** Disconnected landmasses on one map; linked by routes only when using multiple islands. */
export type IslandCount = 1 | 2 | 3

export const PLAYER_COUNT_MIN = 2
export const PLAYER_COUNT_MAX = 8

export interface HexCoord {
  q: number
  r: number
}

export interface HexTile {
  id: string
  coord: HexCoord
  /** Landmass index (0 … islandCount−1). */
  islandIndex: number
  neighbors: string[]
  owner: PlayerId
  dice: number
  center: { x: number; y: number }
}

export type Phase = 'PREGAME' | 'PLACEMENT' | 'BATTLE' | 'GAME_OVER'
export type BattleSubPhase = 'CHOOSING_ATTACK' | 'MANUAL_REINFORCE'

/** Batch size when placing manual reinforcements (risk-lite: +1/+5/+10/All; stalemate: +5/+10/All). */
export type ManualReinforceBatch = 1 | 5 | 10 | 'all'

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

/** Setup size: fixed counts or Full (viewport-based at generation time). */
export type BoardHexPreset = 20 | 40 | 60 | 'full'

export interface GameState {
  /** Number of land hexes on this map (matches preset or computed for Full). */
  boardHexCount: number
  /** Selected preset in setup; Full uses `pregameBoardCss` to pick hex count. */
  boardHexPreset: BoardHexPreset
  /** Board area in CSS pixels when preset is Full (for regeneration / resize). */
  pregameBoardCss: { width: number; height: number } | null
  /** Landmass count for this map (may be clamped down if hex count is too small). */
  islandCount: IslandCount
  /** Active players in this session (2–8). */
  playerCount: number
  /**
   * If true, start in battle with dice pre-placed: each player gets 4× their starting hex count,
   * spread randomly across their tiles (still max 8 per hex). Skips placement phase.
   */
  skipPlacementStart: boolean
  /**
   * When true (default), end-of-turn reinforcements become **manual** (pick hex + batch 5/10/all)
   * once **two players** remain and **average dice per hex ≥ 7**; hexes may exceed 8 in that phase.
   * Toggle in pre-game setup. Ignored when `riskLiteMode` is on (reinforce is always manual at turn start).
   */
  manualStalemateReinforce: boolean
  /**
   * Risk-lite: reinforcements at **start** of each turn (manual +1/+5/+10/All), not end.
   * After the first pool: ⌈owned hexes / 3⌉ dice per turn (see rules).
   */
  riskLiteMode: boolean
  /** Per player: whether their first start-of-turn reinforce pool (flat 5 dice) was already used. */
  riskLiteOpeningUsed: Partial<Record<PlayerId, boolean>>
  /**
   * Once manual stalemate reinforce has triggered, battle/placement caps use unlimited stacking
   * for the rest of the match (latched).
   */
  stalemateUnlimitedDice: boolean
  rngState: number
  phase: Phase
  currentPlayer: PlayerId
  tiles: Record<string, HexTile>
  tileIds: string[]
  placement: PlacementState
  battle: BattleUiState
  /** Active while human places manual reinforcements (risk-lite start or stalemate end). */
  manualReinforcement?: {
    endingPlayer: PlayerId
    remaining: number
    batchSize: ManualReinforceBatch
    /** `turn_start` = same player attacks after; `turn_end` = advance to next player after. */
    timing: 'turn_start' | 'turn_end'
  }
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
   * Extra adjacency between landmasses when islandCount > 1. Empty when a single island.
   * Drawn as coast ports + void curves. Generated with the map.
   */
  routes: [string, string][]
}
