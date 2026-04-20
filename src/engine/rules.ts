import {
  assignRandomOwners,
  clampBoardHexCount,
  clampIslandCount,
  defaultBoardGrowthBias,
  DEFAULT_ISLAND_COUNT,
  estimateLandHexCountForViewport,
  generateBoard,
} from './boardGen'
import { createRng, nextInt, rollD6, type Rng } from './rng'
import { largestConnectedComponentSize } from './scoring'
import type {
  BattleLogEntry,
  BoardHexPreset,
  GameState,
  HexTile,
  ManualReinforceBatch,
  PlayerId,
} from './types'
import { PLAYER_COUNT_MAX, PLAYER_COUNT_MIN } from './types'

function cloneTiles(tiles: Record<string, HexTile>): Record<string, HexTile> {
  const out: Record<string, HexTile> = {}
  for (const id of Object.keys(tiles)) {
    const t = tiles[id]
    out[id] = {
      ...t,
      coord: { ...t.coord },
      center: { ...t.center },
      neighbors: [...t.neighbors],
    }
  }
  return out
}

/** Dice added in one placement click during phase 1. */
export const PLACEMENT_DICE_PER_TURN = 5

/** No hex may hold more than this many dice (until stalemate unlimited mode). */
export const MAX_DICE_PER_HEX = 8

/** Average dice per occupied hex at or above this triggers manual stalemate reinforce (with 2 players left). */
export const STALEMATE_AVG_DICE_THRESHOLD = 7

export function clampDiceMax(d: number): number {
  return Math.min(MAX_DICE_PER_HEX, d)
}

/** After stalemate manual mode triggers, dice are not capped at 8. */
export function maxDicePerHexForState(state: GameState): number {
  return state.stalemateUnlimitedDice ? 1_000_000 : MAX_DICE_PER_HEX
}

export function clampDiceForState(state: GameState, d: number): number {
  const m = maxDicePerHexForState(state)
  return Math.min(m, Math.max(1, d))
}

export function activePlayerCount(state: GameState): number {
  const s = new Set<PlayerId>()
  for (const id of state.tileIds) s.add(state.tiles[id].owner)
  return s.size
}

export function averageDicePerOccupiedHex(state: GameState): number {
  if (state.tileIds.length === 0) return 0
  let sum = 0
  for (const id of state.tileIds) sum += state.tiles[id].dice
  return sum / state.tileIds.length
}

/** Two players left and board is “full” enough for manual stalemate reinforce. */
export function stalemateManualReinforceTrigger(state: GameState): boolean {
  return (
    activePlayerCount(state) === 2 && averageDicePerOccupiedHex(state) >= STALEMATE_AVG_DICE_THRESHOLD
  )
}

const DEFAULT_PALETTE = [
  '#e53935',
  '#42a5f5',
  '#66bb6a',
  '#ffca28',
  '#ab47bc',
  '#26c6da',
  '#ff7043',
  '#eceff1',
]

export function clampPlayerCount(n: number): number {
  return Math.min(PLAYER_COUNT_MAX, Math.max(PLAYER_COUNT_MIN, Math.floor(Number(n))))
}

export function buildDefaultPlayers(playerCount: number): {
  colors: Record<PlayerId, string>
  isBot: Record<PlayerId, boolean>
} {
  const n = clampPlayerCount(playerCount)
  const colors: Record<PlayerId, string> = {}
  const isBot: Record<PlayerId, boolean> = {}
  for (let i = 1; i <= n; i++) {
    colors[i] = DEFAULT_PALETTE[i - 1] ?? '#94a3b8'
    isBot[i] = i !== 1
  }
  return { colors, isBot }
}

function buildPlacementRemaining(playerCount: number): Record<PlayerId, number> {
  const n = clampPlayerCount(playerCount)
  const o: Record<PlayerId, number> = {}
  for (let i = 1; i <= n; i++) o[i] = 10
  return o
}

export function buildPlacementOrder(playerCount: number): PlayerId[] {
  const n = clampPlayerCount(playerCount)
  const forward = Array.from({ length: n }, (_, i) => (i + 1) as PlayerId)
  return [...forward, ...forward.slice().reverse()]
}

function attachRng(state: GameState): Rng {
  return { state: state.rngState }
}

function syncRng(state: GameState, rng: Rng): void {
  state.rngState = rng.state
}

function randomSeed32(): number {
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0
}

/** Total dice per player in skip-placement mode = this × (their starting hex count). */
export const SKIP_PLACEMENT_DICE_PER_TILE_MULT = 4

/**
 * Skip-placement: each player gets (mult × their tile count) dice, min 1 per owned hex,
 * extras placed randomly up to MAX_DICE_PER_HEX. Otherwise every hex gets 1.
 */
function applySkipPlacementRandomDice(
  tiles: Record<string, HexTile>,
  tileIds: string[],
  playerCount: number,
  rng: Rng,
): void {
  const pc = clampPlayerCount(playerCount)
  for (let p = 1; p <= pc; p++) {
    const hexes = tileIds.filter((id) => tiles[id].owner === p)
    const n = hexes.length
    if (n === 0) continue

    for (const hid of hexes) {
      tiles[hid] = { ...tiles[hid], dice: 1 }
    }

    let remaining = SKIP_PLACEMENT_DICE_PER_TILE_MULT * n - n
    while (remaining > 0) {
      const hid = hexes[nextInt(rng, 0, hexes.length)]!
      if (tiles[hid].dice < MAX_DICE_PER_HEX) {
        tiles[hid] = { ...tiles[hid], dice: tiles[hid].dice + 1 }
        remaining--
      }
    }
  }
}

function syncPregameTileDice(state: GameState, rng: Rng): void {
  state.tiles = cloneTiles(state.tiles)
  if (state.skipPlacementStart) {
    applySkipPlacementRandomDice(state.tiles, state.tileIds, state.playerCount, rng)
  } else {
    for (const id of state.tileIds) {
      state.tiles[id] = { ...state.tiles[id], dice: 1 }
    }
  }
  syncRng(state, rng)
}

export interface CreateGameOptions {
  playerCount?: number
  /** @default true (battle start). Pass `false` only for tests of the placement phase. */
  skipPlacementStart?: boolean
  /** @default 2. Clamped to 1–3; may be reduced at generation time if hex count is too small. */
  islandCount?: number
  /** @default true. Manual end-of-turn placement when 2 players and avg dice/hex ≥ 7. */
  manualStalemateReinforce?: boolean
  /** Risk-lite: start-of-turn manual reinforce (5 dice first pool per player, then largest group size). */
  riskLiteMode?: boolean
  /** Defaults from first numeric arg when omitted. */
  boardHexPreset?: BoardHexPreset
  /** Measured board area (CSS px) when preset is Full. */
  pregameBoardCss?: { width: number; height: number } | null
}

/** Extra dice in the first start-of-turn manual pool for each player (plus largest contiguous group). */
export const RISK_LITE_OPENING_BONUS = 5

function defaultPregameBoardCss(): { width: number; height: number } {
  if (typeof globalThis !== 'undefined' && 'innerWidth' in globalThis) {
    const w = globalThis as unknown as Window
    return {
      width: Math.max(120, w.innerWidth),
      height: Math.max(160, Math.floor(w.innerHeight * 0.52)),
    }
  }
  return { width: 800, height: 560 }
}

export function createInitialGameState(boardHexCount = 40, opts?: CreateGameOptions): GameState {
  const playerCount = clampPlayerCount(opts?.playerCount ?? 4)
  const skipPlacementStart = opts?.skipPlacementStart ?? true
  const manualStalemateReinforce = opts?.manualStalemateReinforce ?? true
  const riskLiteMode = opts?.riskLiteMode ?? false
  const islandRequest =
    opts?.islandCount !== undefined ? clampIslandCount(opts.islandCount) : DEFAULT_ISLAND_COUNT

  const preset: BoardHexPreset =
    opts?.boardHexPreset ??
    (boardHexCount === 20 || boardHexCount === 40 || boardHexCount === 60
      ? (boardHexCount as BoardHexPreset)
      : 40)

  let pregameBoardCss: { width: number; height: number } | null =
    opts?.pregameBoardCss !== undefined ? opts.pregameBoardCss : null

  let n: number
  if (preset === 'full') {
    if (!pregameBoardCss) pregameBoardCss = defaultPregameBoardCss()
    n = clampBoardHexCount(
      estimateLandHexCountForViewport(
        pregameBoardCss.width,
        pregameBoardCss.height,
        defaultBoardGrowthBias(),
      ),
    )
  } else {
    n = clampBoardHexCount(boardHexCount)
    pregameBoardCss = null
  }

  const rng = createRng(randomSeed32())
  const board = generateBoard(rng, n, {
    growthBias: defaultBoardGrowthBias(),
    islandCount: islandRequest,
    ...(preset === 'full' ? { layout: 'rect' as const } : {}),
  })
  assignRandomOwners(rng, board.tiles, board.tileIds, playerCount)

  if (skipPlacementStart) {
    applySkipPlacementRandomDice(board.tiles, board.tileIds, playerCount, rng)
  } else {
    for (const id of board.tileIds) {
      board.tiles[id] = { ...board.tiles[id], dice: 1 }
    }
  }

  const order = buildPlacementOrder(playerCount)
  const players = buildDefaultPlayers(playerCount)

  return {
    boardHexCount: n,
    boardHexPreset: preset,
    pregameBoardCss,
    islandCount: board.islandCount,
    playerCount,
    skipPlacementStart,
    manualStalemateReinforce,
    riskLiteMode,
    riskLiteOpeningUsed: {},
    stalemateUnlimitedDice: false,
    rngState: rng.state,
    phase: 'PREGAME',
    currentPlayer: 1,
    tiles: board.tiles,
    tileIds: board.tileIds,
    routes: board.routes,
    placement: {
      remainingByPlayer: buildPlacementRemaining(playerCount),
      order,
      orderIndex: 0,
      diceLeftThisTurn: PLACEMENT_DICE_PER_TURN,
    },
    battle: {
      subPhase: 'CHOOSING_ATTACK',
      selection: {},
    },
    players,
    logs: [],
  }
}

function resolveHexCountForRegeneration(state: GameState): number {
  if (state.boardHexPreset === 'full' && state.pregameBoardCss) {
    return clampBoardHexCount(
      estimateLandHexCountForViewport(
        state.pregameBoardCss.width,
        state.pregameBoardCss.height,
        defaultBoardGrowthBias(),
      ),
    )
  }
  return clampBoardHexCount(state.boardHexCount)
}

function regenerateBoardAtCurrentSize(state: GameState): string | null {
  if (state.phase === 'PREGAME') {
    state.stalemateUnlimitedDice = false
    state.manualReinforcement = undefined
  }
  const n = resolveHexCountForRegeneration(state)
  state.boardHexCount = n
  const rng = createRng(randomSeed32())
  const board = generateBoard(rng, n, {
    growthBias: defaultBoardGrowthBias(),
    islandCount: state.islandCount,
    ...(state.boardHexPreset === 'full' ? { layout: 'rect' as const } : {}),
  })
  assignRandomOwners(rng, board.tiles, board.tileIds, state.playerCount)
  state.tiles = board.tiles
  state.tileIds = board.tileIds
  state.routes = board.routes
  state.islandCount = board.islandCount
  state.logs = []
  state.lastBattleOverlay = undefined
  state.reinforcementAnimation = undefined
  state.reinforcementPop = undefined
  if (state.phase === 'PREGAME') {
    syncPregameTileDice(state, rng)
  } else {
    state.rngState = rng.state
  }
  return null
}

/** New random map at current hex count + fresh owner shuffle (pre-game only). */
export function randomizeBoardPregame(state: GameState): string | null {
  if (state.phase !== 'PREGAME') return 'Setup is already over'
  return regenerateBoardAtCurrentSize(state)
}

/** Set hex count (fixed presets) and regenerate map (pre-game only). */
export function setBoardHexCountPregame(state: GameState, rawCount: number): string | null {
  if (state.phase !== 'PREGAME') return 'Change size only during setup'
  const n = clampBoardHexCount(rawCount)
  state.boardHexCount = n
  if (n === 20 || n === 40 || n === 60) {
    state.boardHexPreset = n
  } else {
    state.boardHexPreset = 40
  }
  state.pregameBoardCss = null
  return regenerateBoardAtCurrentSize(state)
}

/** Set board size preset including Full (pass measured CSS rect for Full). */
export function setBoardHexPresetPregame(
  state: GameState,
  preset: BoardHexPreset,
  boardCss?: { width: number; height: number } | null,
): string | null {
  if (state.phase !== 'PREGAME') return 'Change size only during setup'
  state.boardHexPreset = preset
  if (preset === 'full') {
    if (boardCss) {
      state.pregameBoardCss = {
        width: Math.max(120, boardCss.width),
        height: Math.max(120, boardCss.height),
      }
    } else if (!state.pregameBoardCss) {
      state.pregameBoardCss = defaultPregameBoardCss()
    }
    state.boardHexCount = clampBoardHexCount(
      estimateLandHexCountForViewport(
        state.pregameBoardCss!.width,
        state.pregameBoardCss!.height,
        defaultBoardGrowthBias(),
      ),
    )
  } else {
    state.pregameBoardCss = null
    state.boardHexCount = clampBoardHexCount(preset)
  }
  return regenerateBoardAtCurrentSize(state)
}

/** Set landmass count (1–3) and regenerate map (pre-game only). */
export function setIslandCountPregame(state: GameState, raw: number): string | null {
  if (state.phase !== 'PREGAME') return 'Change islands only during setup'
  state.islandCount = clampIslandCount(raw)
  return regenerateBoardAtCurrentSize(state)
}

/** Same map; reshuffle who owns which tiles (pre-game only). */
export function shuffleOwnersPregame(state: GameState): string | null {
  if (state.phase !== 'PREGAME') return 'Setup is already over'
  const rng = attachRng(state)
  state.tiles = cloneTiles(state.tiles)
  assignRandomOwners(rng, state.tiles, state.tileIds, state.playerCount)
  syncPregameTileDice(state, rng)
  return null
}

export function setPlayerCountPregame(state: GameState, raw: number): string | null {
  if (state.phase !== 'PREGAME') return 'Change player count only during setup'
  state.playerCount = clampPlayerCount(raw)
  state.players = buildDefaultPlayers(state.playerCount)
  const rng = attachRng(state)
  state.tiles = cloneTiles(state.tiles)
  assignRandomOwners(rng, state.tiles, state.tileIds, state.playerCount)
  syncPregameTileDice(state, rng)
  return null
}

/** Lock current map and owners; begin placement or battle. */
export function beginPlacementFromPregame(state: GameState): string | null {
  if (state.phase !== 'PREGAME') return 'Not in setup'
  state.stalemateUnlimitedDice = false
  state.manualReinforcement = undefined
  state.riskLiteOpeningUsed = {}
  state.battle = {
    subPhase: 'CHOOSING_ATTACK',
    selection: {},
  }
  state.logs = []
  state.lastBattleOverlay = undefined
  state.reinforcementAnimation = undefined
  state.reinforcementPop = undefined

  if (state.skipPlacementStart) {
    state.phase = 'BATTLE'
    state.currentPlayer = 1
    if (state.riskLiteMode) {
      offerRiskLiteStartReinforce(state, 0)
    }
    return null
  }

  const order = buildPlacementOrder(state.playerCount)
  state.phase = 'PLACEMENT'
  state.placement = {
    remainingByPlayer: buildPlacementRemaining(state.playerCount),
    order,
    orderIndex: 0,
    diceLeftThisTurn: PLACEMENT_DICE_PER_TURN,
  }
  state.currentPlayer = order[0]
  state.tiles = cloneTiles(state.tiles)
  for (const id of state.tileIds) {
    state.tiles[id] = { ...state.tiles[id], dice: 1 }
  }
  return null
}

function nextPlayer(state: GameState, p: PlayerId): PlayerId {
  const n = state.playerCount
  return p >= n ? 1 : p + 1
}

export function setManualStalemateReinforcePregame(state: GameState, enabled: boolean): string | null {
  if (state.phase !== 'PREGAME') return 'Change this option only during setup'
  state.manualStalemateReinforce = enabled
  return null
}

export function setRiskLiteModePregame(state: GameState, enabled: boolean): string | null {
  if (state.phase !== 'PREGAME') return 'Change this option only during setup'
  state.riskLiteMode = enabled
  if (enabled) state.manualStalemateReinforce = false
  return null
}

function applyRandomReinforcementUncapped(state: GameState, player: PlayerId, count: number): void {
  const owned = state.tileIds.filter((id) => state.tiles[id].owner === player)
  if (owned.length === 0 || count <= 0) return
  const rng = attachRng(state)
  state.tiles = cloneTiles(state.tiles)
  for (let i = 0; i < count; i++) {
    const hid = owned[nextInt(rng, 0, owned.length)]!
    const t = state.tiles[hid]!
    state.tiles[hid] = { ...t, dice: t.dice + 1 }
  }
  syncRng(state, rng)
}

function finishManualReinforcementTurn(state: GameState, endingPlayer: PlayerId): void {
  const prev = state.manualReinforcement
  const timing = prev?.timing ?? 'turn_end'
  state.manualReinforcement = undefined
  state.battle.subPhase = 'CHOOSING_ATTACK'
  state.battle.selection = {}
  if (timing === 'turn_start') {
    applyWinIfAny(state)
    return
  }
  state.currentPlayer = nextPlayer(state, endingPlayer)
  applyWinIfAny(state)
}

/** Human: place batch (5/10/all) of remaining end-of-turn dice on an owned hex. */
export function manualReinforcementPlaceDice(state: GameState, hexId: string): string | null {
  if (state.phase !== 'BATTLE' || state.battle.subPhase !== 'MANUAL_REINFORCE') return 'Not placing reinforcements'
  const mr = state.manualReinforcement
  if (!mr) return 'No manual reinforcement state'
  const p = mr.endingPlayer
  if (state.players.isBot[p]) return 'AI handles its own reinforcements'
  const t = state.tiles[hexId]
  if (!t || t.owner !== p) return 'Pick one of your hexes'
  if (mr.remaining <= 0) return 'Nothing left to place'

  let chunk = mr.batchSize === 'all' ? mr.remaining : mr.batchSize
  chunk = Math.min(chunk, mr.remaining)

  state.tiles = cloneTiles(state.tiles)
  const nt = state.tiles[hexId]!
  state.tiles[hexId] = { ...nt, dice: nt.dice + chunk }
  const nextRem = mr.remaining - chunk
  state.manualReinforcement = { ...mr, remaining: nextRem }
  reinforcementPopSeq += 1
  state.reinforcementPop = { hexId, seq: reinforcementPopSeq }

  if (nextRem <= 0) {
    finishManualReinforcementTurn(state, p)
  }
  return null
}

export function setManualReinforcementBatchSize(
  state: GameState,
  batch: ManualReinforceBatch,
): string | null {
  if (state.phase !== 'BATTLE' || state.battle.subPhase !== 'MANUAL_REINFORCE') return 'Not in manual reinforce'
  const mr = state.manualReinforcement
  if (!mr) return 'No manual reinforcement state'
  if (batch === 1 && mr.timing === 'turn_end') {
    return 'Use +5, +10, or All for end-of-turn reinforcements'
  }
  state.manualReinforcement = { ...mr, batchSize: batch }
  return null
}

export function checkWinner(state: GameState): PlayerId | undefined {
  const owners = new Set<PlayerId>()
  for (const id of state.tileIds) owners.add(state.tiles[id].owner)
  if (owners.size === 1) return [...owners][0]
  return undefined
}

function transitionGameOver(state: GameState, winner: PlayerId): void {
  state.phase = 'GAME_OVER'
  state.winner = winner
}

/** After any state change that could end the game */
export function applyWinIfAny(state: GameState): void {
  const w = checkWinner(state)
  if (w !== undefined) transitionGameOver(state, w)
}

/** +1 die per click; place all `diceLeftThisTurn` (5) on any owned hexes before the turn passes. */
export function placementClick(state: GameState, hexId: string): string | null {
  if (state.phase !== 'PLACEMENT') return 'Not placement phase'
  const t = state.tiles[hexId]
  if (!t) return 'Invalid hex'
  if (t.owner !== state.currentPlayer) return 'Not your territory — pick any hex you own'
  const left = state.placement.remainingByPlayer[state.currentPlayer]
  if (left <= 0) return 'No dice left'
  if (state.placement.diceLeftThisTurn <= 0) return 'No dice left to place this turn'

  const rng = attachRng(state)
  state.tiles = cloneTiles(state.tiles)
  state.tiles[hexId] = {
    ...state.tiles[hexId],
    dice: clampDiceMax(state.tiles[hexId].dice + 1),
  }
  state.placement.remainingByPlayer[state.currentPlayer] = left - 1
  state.placement.diceLeftThisTurn -= 1
  syncRng(state, rng)

  if (state.placement.diceLeftThisTurn === 0) {
    state.placement.orderIndex += 1
    if (state.placement.orderIndex >= state.placement.order.length) {
      state.phase = 'BATTLE'
      state.currentPlayer = 1
      state.battle = {
        subPhase: 'CHOOSING_ATTACK',
        selection: {},
      }
      state.placement.diceLeftThisTurn = PLACEMENT_DICE_PER_TURN
      if (state.riskLiteMode) {
        offerRiskLiteStartReinforce(state, 0)
      }
    } else {
      state.currentPlayer = state.placement.order[state.placement.orderIndex]
      state.placement.diceLeftThisTurn = PLACEMENT_DICE_PER_TURN
    }
  }

  applyWinIfAny(state)
  return null
}

function sumRollDice(rng: Rng, count: number): number {
  let s = 0
  for (let i = 0; i < count; i++) s += rollD6(rng)
  return s
}

/** Pure battle math (ties → defender). */
export function battleOutcome(
  attackerDiceBefore: number,
  defenderDiceBefore: number,
  attackerRoll: number,
  defenderRoll: number,
): {
  attackerWins: boolean
  attackerDiceAfter: number
  defenderDiceAfter: number
} {
  const attackerWins = attackerRoll > defenderRoll
  if (attackerWins) {
    return {
      attackerWins: true,
      attackerDiceAfter: 1,
      defenderDiceAfter: attackerDiceBefore - 1,
    }
  }
  return {
    attackerWins: false,
    attackerDiceAfter: 1,
    defenderDiceAfter: defenderDiceBefore,
  }
}

export function battleSelectAttacker(state: GameState, hexId: string): string | null {
  if (state.phase !== 'BATTLE' || state.battle.subPhase !== 'CHOOSING_ATTACK') {
    return 'Invalid phase'
  }
  const t = state.tiles[hexId]
  if (!t || t.owner !== state.currentPlayer) return 'Pick your hex'
  state.battle.selection.selectedAttackerHexId = hexId
  state.battle.selection.selectedDefenderHexId = undefined
  return null
}

export function battleAttack(state: GameState, defenderHexId: string): string | null {
  if (state.phase !== 'BATTLE' || state.battle.subPhase !== 'CHOOSING_ATTACK') return 'Invalid phase'
  const atkId = state.battle.selection.selectedAttackerHexId
  if (!atkId) return 'Select attacker first'
  const attacker = state.tiles[atkId]
  const defender = state.tiles[defenderHexId]
  if (!attacker || !defender) return 'Invalid hex'
  if (attacker.owner !== state.currentPlayer) return 'Bad attacker'
  if (defender.owner === state.currentPlayer) return 'Cannot attack own hex'
  if (!attacker.neighbors.includes(defenderHexId)) return 'Not adjacent'
  if (attacker.dice < 2) return 'Need at least 2 dice to attack'

  const rng = attachRng(state)
  const attackerDiceBefore = attacker.dice
  const defenderDiceBefore = defender.dice
  const attackerRoll = sumRollDice(rng, attackerDiceBefore)
  const defenderRoll = sumRollDice(rng, defenderDiceBefore)
  syncRng(state, rng)

  const out = battleOutcome(attackerDiceBefore, defenderDiceBefore, attackerRoll, defenderRoll)
  state.tiles = cloneTiles(state.tiles)
  const a = state.tiles[atkId]
  const d = state.tiles[defenderHexId]

  const entry: BattleLogEntry = {
    id: `log-${state.logs.length}-${state.rngState}`,
    attackerPlayer: a.owner,
    defenderPlayer: d.owner,
    attackerHexId: atkId,
    defenderHexId,
    attackerRoll,
    defenderRoll,
    attackerDiceBefore,
    defenderDiceBefore,
    winner: out.attackerWins ? 'attacker' : 'defender',
  }
  state.logs = [...state.logs, entry].slice(-50)

  state.lastBattleOverlay = {
    attackerRoll,
    defenderRoll,
    winner: out.attackerWins ? 'attacker' : 'defender',
  }

  if (out.attackerWins) {
    state.tiles[atkId] = { ...a, dice: clampDiceForState(state, out.attackerDiceAfter) }
    state.tiles[defenderHexId] = {
      ...d,
      owner: a.owner,
      dice: clampDiceForState(state, out.defenderDiceAfter),
    }
  } else {
    state.tiles[atkId] = { ...a, dice: clampDiceForState(state, out.attackerDiceAfter) }
  }

  state.battle.selection.selectedAttackerHexId = undefined
  state.battle.selection.selectedDefenderHexId = undefined

  applyWinIfAny(state)
  return null
}

export function battleCancelSelection(state: GameState): void {
  state.battle.selection.selectedAttackerHexId = undefined
  state.battle.selection.selectedDefenderHexId = undefined
}

/**
 * Risk-lite: offer manual dice at the **start** of the current player's turn (after they become current).
 * First pool per player: exactly RISK_LITE_OPENING_BONUS dice; later turns: largest contiguous group size.
 */
export function offerRiskLiteStartReinforce(state: GameState, depth = 0): void {
  if (!state.riskLiteMode || state.phase !== 'BATTLE') return
  if (depth > state.playerCount + 4) return

  const p = state.currentPlayer
  const owned = state.tileIds.filter((id) => state.tiles[id].owner === p)
  if (owned.length === 0) {
    state.currentPlayer = nextPlayer(state, p)
    applyWinIfAny(state)
    if (state.phase !== 'BATTLE') return
    offerRiskLiteStartReinforce(state, depth + 1)
    return
  }

  const useOpening = !state.riskLiteOpeningUsed[p]
  if (useOpening) {
    state.riskLiteOpeningUsed[p] = true
  }
  const remaining = useOpening
    ? RISK_LITE_OPENING_BONUS
    : largestConnectedComponentSize(p, state.tiles, state.tileIds)

  if (remaining <= 0) {
    state.battle.subPhase = 'CHOOSING_ATTACK'
    state.battle.selection = {}
    applyWinIfAny(state)
    return
  }

  state.stalemateUnlimitedDice = true
  if (state.players.isBot[p]) {
    applyRandomReinforcementUncapped(state, p, remaining)
    state.battle.subPhase = 'CHOOSING_ATTACK'
    state.battle.selection = {}
    applyWinIfAny(state)
    return
  }

  state.battle.subPhase = 'MANUAL_REINFORCE'
  state.manualReinforcement = {
    endingPlayer: p,
    remaining,
    batchSize: 1,
    timing: 'turn_start',
  }
  state.battle.selection = {}
}

export function endAttackPhase(state: GameState): string | null {
  if (state.phase !== 'BATTLE' || state.battle.subPhase !== 'CHOOSING_ATTACK') return 'Cannot end turn now'
  if (state.reinforcementAnimation) return 'Reinforcement in progress'
  const p = state.currentPlayer
  state.battle.selection.selectedAttackerHexId = undefined
  state.battle.selection.selectedDefenderHexId = undefined
  state.lastBattleOverlay = undefined

  if (state.riskLiteMode) {
    state.currentPlayer = nextPlayer(state, p)
    applyWinIfAny(state)
    if (state.phase !== 'BATTLE') return null
    offerRiskLiteStartReinforce(state, 0)
    return null
  }

  const n = largestConnectedComponentSize(p, state.tiles, state.tileIds)
  const owned = state.tileIds.filter((id) => state.tiles[id].owner === p)

  if (owned.length === 0 || n <= 0) {
    state.currentPlayer = nextPlayer(state, p)
    state.battle.subPhase = 'CHOOSING_ATTACK'
    state.battle.selection = {}
    applyWinIfAny(state)
    return null
  }

  const useManualStalemate =
    !state.riskLiteMode &&
    state.manualStalemateReinforce &&
    stalemateManualReinforceTrigger(state) &&
    n > 0

  if (useManualStalemate) {
    state.stalemateUnlimitedDice = true
    if (!state.players.isBot[p]) {
      state.battle.subPhase = 'MANUAL_REINFORCE'
      state.manualReinforcement = {
        endingPlayer: p,
        remaining: n,
        batchSize: 5,
        timing: 'turn_end',
      }
      return null
    }
    applyRandomReinforcementUncapped(state, p, n)
    state.currentPlayer = nextPlayer(state, p)
    state.battle.subPhase = 'CHOOSING_ATTACK'
    state.battle.selection = {}
    applyWinIfAny(state)
    return null
  }

  const hexIds: string[] = []
  const rng = attachRng(state)
  const diceSim: Record<string, number> = {}
  for (const id of owned) {
    diceSim[id] = state.tiles[id].dice
  }
  for (let i = 0; i < n; i++) {
    const eligible = owned.filter((id) => diceSim[id] < MAX_DICE_PER_HEX)
    if (eligible.length === 0) break
    const hid = eligible[nextInt(rng, 0, eligible.length)]!
    hexIds.push(hid)
    diceSim[hid] = diceSim[hid] + 1
  }
  syncRng(state, rng)

  if (hexIds.length === 0) {
    state.currentPlayer = nextPlayer(state, p)
    state.battle.subPhase = 'CHOOSING_ATTACK'
    state.battle.selection = {}
    applyWinIfAny(state)
    return null
  }

  state.reinforcementAnimation = {
    endingPlayer: p,
    hexIds,
    appliedCount: 0,
  }
  return null
}

let reinforcementPopSeq = 0

/** Apply the next +1 reinforcement die; advances turn when the queue is empty. */
export function tickReinforcementAnimation(state: GameState): void {
  const anim = state.reinforcementAnimation
  if (!anim) return
  const hid = anim.hexIds[anim.appliedCount]
  state.tiles = cloneTiles(state.tiles)
  const d = state.tiles[hid].dice
  const cap = maxDicePerHexForState(state)
  const nextDice = d < cap ? d + 1 : d
  state.tiles[hid] = {
    ...state.tiles[hid],
    dice: nextDice,
  }
  anim.appliedCount += 1
  reinforcementPopSeq += 1
  state.reinforcementPop = { hexId: hid, seq: reinforcementPopSeq }

  if (anim.appliedCount >= anim.hexIds.length) {
    state.reinforcementAnimation = undefined
    state.currentPlayer = nextPlayer(state, anim.endingPlayer)
    state.battle.subPhase = 'CHOOSING_ATTACK'
    state.battle.selection = {}
    applyWinIfAny(state)
  }
}

/** Skip staggered reinforcement (e.g. Skip AI). */
export function flushReinforcementAnimation(state: GameState): void {
  while (state.reinforcementAnimation) {
    tickReinforcementAnimation(state)
  }
}

export function resetGame(state: GameState): void {
  const next = createInitialGameState(state.boardHexPreset === 'full' ? 40 : state.boardHexCount, {
    playerCount: state.playerCount,
    islandCount: state.islandCount,
    manualStalemateReinforce: state.manualStalemateReinforce,
    riskLiteMode: state.riskLiteMode,
    boardHexPreset: state.boardHexPreset,
    pregameBoardCss: state.pregameBoardCss,
  })
  Object.assign(state, next)
}
