import {
  BOARD_HEX_PRESETS,
  type BoardHexPreset,
} from '../engine/boardGen'
import {
  PLAYER_COUNT_MAX,
  PLAYER_COUNT_MIN,
  type GameState,
  type IslandCount,
  type ManualReinforceBatch,
} from '../engine/types'

export interface BoardChromeProps {
  game: GameState
  onRandomizeBoard: () => void
  onStartGame: () => void
  onSetPlayerCount: (n: number) => void
  onSetBoardHexPreset: (n: BoardHexPreset) => void
  onSetIslandCount: (n: number) => void
  onSetManualStalemateReinforce: (enabled: boolean) => void
}

export interface BoardStatusStripProps {
  game: GameState
  onEndTurn: () => void
  onSkipAiTurns: () => void
  onSetReinforcementBatchSize: (batch: ManualReinforceBatch) => void
}

function reinforcementPrompt(game: GameState): { title: string; detail: string } | null {
  const anim = game.reinforcementAnimation
  if (!anim) return null
  const total = anim.hexIds.length
  return {
    title: 'Reinforcing',
    detail: `End-of-turn dice — +1 only on hexes below max (${anim.appliedCount}/${total}); none if every tile is full.`,
  }
}

function manualReinforcePrompt(game: GameState): { title: string; detail: string } | null {
  if (game.phase !== 'BATTLE' || game.battle.subPhase !== 'MANUAL_REINFORCE') return null
  const mr = game.manualReinforcement
  if (!mr) return null
  const b = mr.batchSize === 'all' ? 'All' : String(mr.batchSize)
  return {
    title: `Place reinforcements · ${mr.remaining} left`,
    detail: `Batch size: ${b} per tap on your hexes (5, 10, or all remaining). Stacks may exceed 8.`,
  }
}

function placementPrompt(game: GameState): { title: string; detail: string } | null {
  if (game.phase !== 'PLACEMENT') return null
  const p = game.currentPlayer
  const left = game.placement.remainingByPlayer[p]
  const leftThisTurn = game.placement.diceLeftThisTurn
  if (game.players.isBot[p]) {
    return {
      title: 'AI is placing dice…',
      detail: 'Watch the board or tap the skip (fast-forward) icon by the directions.',
    }
  }
  return {
    title: `Place 1 die · ${leftThisTurn} left this turn`,
    detail: `Spread across your hexes or stack on one — each tap adds +1 on any tile you own. ${left} dice left in your pool for this phase.`,
  }
}

function battlePrompt(game: GameState): { title: string; detail: string } | null {
  if (game.phase !== 'BATTLE') return null
  const p = game.currentPlayer
  if (game.players.isBot[p]) {
    return {
      title: 'AI is taking its battle turn…',
      detail: 'Tap the skip (fast-forward) icon by the directions, or wait for the AI.',
    }
  }
  const sel = game.battle.selection.selectedAttackerHexId
  return {
    title: sel ? 'Choose an adjacent enemy hex to attack' : 'Choose one of your hexes to attack from',
    detail:
      'Need at least 2 dice on the attacker. Routes count as adjacency. When finished, tap the end-turn (arrow) icon.',
  }
}

const SIZE_LABELS: Record<BoardHexPreset, string> = {
  20: 'Small',
  40: 'Medium',
  60: 'Large',
}

const ISLAND_PRESETS: IslandCount[] = [1, 2, 3]

function IconEndTurn() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12h11" />
      <path d="M13 7l6 5-6 5" />
    </svg>
  )
}

function IconSkipAi() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M5 6v12l9-6-9-6zm9 0v12l8-6-8-6z" />
    </svg>
  )
}

/** Fixed-height strip below the board: directions + turn icon actions. */
export function BoardStatusStrip({
  game,
  onEndTurn,
  onSkipAiTurns,
  onSetReinforcementBatchSize,
}: BoardStatusStripProps) {
  const p = game.currentPlayer
  const manualReinforce = game.phase === 'BATTLE' && game.battle.subPhase === 'MANUAL_REINFORCE'
  const canEndTurn =
    game.phase === 'BATTLE' &&
    game.battle.subPhase === 'CHOOSING_ATTACK' &&
    !game.players.isBot[p] &&
    !game.reinforcementAnimation

  const showSkipAi =
    (game.phase === 'PLACEMENT' || game.phase === 'BATTLE') &&
    game.players.isBot[p] &&
    !game.reinforcementAnimation &&
    !manualReinforce

  const pregame = game.phase === 'PREGAME'

  const prompt = pregame
    ? {
        title: `Ready · ${game.playerCount} players`,
        detail:
          'Starts in battle: 4× dice per tile you own, placed randomly (max 8 per hex). Optional manual stalemate reinforce when 2 players remain and the board averages ≥7 dice per hex. One island: no routes. Two or three islands: colored routes link landmasses in the void (each has ≥2). ↻ new map; Start when ready.',
      }
    : manualReinforcePrompt(game) ??
      reinforcementPrompt(game) ??
      placementPrompt(game) ??
      battlePrompt(game)

  const mr = game.manualReinforcement
  const showBatch =
    manualReinforce && mr && !game.players.isBot[p]

  const showPromptActions = !pregame && (showSkipAi || canEndTurn || showBatch)

  if (!prompt) return null

  return (
    <div className="dw-status-strip">
      <div className={'dw-board-prompt-bar' + (showPromptActions ? ' dw-board-prompt-bar--with-actions' : '')}>
        <div className="dw-board-prompt-text" aria-live="polite">
          <p className="dw-board-prompt-title">{prompt.title}</p>
          <p className="dw-board-prompt-detail">{prompt.detail}</p>
        </div>
        {showPromptActions && (
          <div className="dw-board-prompt-actions" role="toolbar" aria-label="Turn actions">
            {showBatch && mr && (
              <div className="dw-reinforce-batch" role="group" aria-label="Dice per tap">
                {([5, 10, 'all'] as const).map((key) => {
                  const active =
                    key === 'all' ? mr.batchSize === 'all' : mr.batchSize === key
                  const label = key === 'all' ? 'All' : `+${key}`
                  return (
                    <button
                      key={String(key)}
                      type="button"
                      className={
                        'dw-reinforce-batch-btn' + (active ? ' dw-reinforce-batch-btn--active' : '')
                      }
                      onClick={() => onSetReinforcementBatchSize(key)}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            )}
            {showSkipAi && (
              <button
                type="button"
                className="dw-board-icon-btn dw-board-icon-btn--secondary"
                onClick={onSkipAiTurns}
                title="Skip AI — jump to your turn"
                aria-label="Skip AI — jump to your turn"
              >
                <IconSkipAi />
              </button>
            )}
            {canEndTurn && (
              <button
                type="button"
                className="dw-board-icon-btn dw-board-icon-btn--primary"
                onClick={onEndTurn}
                title="End turn"
                aria-label="End turn"
              >
                <IconEndTurn />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function BoardChrome({
  game,
  onRandomizeBoard,
  onStartGame,
  onSetPlayerCount,
  onSetBoardHexPreset,
  onSetIslandCount,
  onSetManualStalemateReinforce,
}: BoardChromeProps) {
  const pregame = game.phase === 'PREGAME'

  return (
    <>
      {pregame && (
        <div className="dw-board-float dw-board-float--setup">
          <div className="dw-setup-panel">
            <div className="dw-setup-field">
              <span className="dw-setup-field-label" id="dw-setup-players-label">
                Players
              </span>
              <select
                className="dw-setup-select"
                value={game.playerCount}
                onChange={(e) => onSetPlayerCount(Number(e.target.value))}
                aria-labelledby="dw-setup-players-label"
              >
                {Array.from(
                  { length: PLAYER_COUNT_MAX - PLAYER_COUNT_MIN + 1 },
                  (_, i) => PLAYER_COUNT_MIN + i,
                ).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            <div className="dw-setup-field">
              <span className="dw-setup-field-label" id="dw-setup-islands-label">
                Islands
              </span>
              <div className="dw-setup-size-btns" role="group" aria-labelledby="dw-setup-islands-label">
                {ISLAND_PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={
                      'dw-setup-size-btn' + (game.islandCount === n ? ' dw-setup-size-btn--active' : '')
                    }
                    onClick={() => onSetIslandCount(n)}
                  >
                    <span className="dw-setup-size-name">{n === 1 ? 'One' : n === 2 ? 'Two' : 'Three'}</span>
                    <span className="dw-setup-size-num">{n}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="dw-setup-field dw-setup-field--checkbox">
              <label className="dw-setup-checkbox-label">
                <input
                  type="checkbox"
                  checked={game.manualStalemateReinforce}
                  onChange={(e) => onSetManualStalemateReinforce(e.target.checked)}
                />
                <span>
                  Manual stalemate reinforce
                  <span className="dw-setup-checkbox-hint">
                    2 players left, avg ≥7 dice/hex — place 5 / 10 / all per tap; stacks can exceed 8.
                  </span>
                </span>
              </label>
            </div>

            <div className="dw-setup-field">
              <span className="dw-setup-field-label" id="dw-setup-board-label">
                Hexes
              </span>
              <div className="dw-setup-size-btns" role="group" aria-labelledby="dw-setup-board-label">
                {BOARD_HEX_PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={
                      'dw-setup-size-btn' + (game.boardHexCount === n ? ' dw-setup-size-btn--active' : '')
                    }
                    onClick={() => onSetBoardHexPreset(n)}
                  >
                    <span className="dw-setup-size-name">{SIZE_LABELS[n]}</span>
                    <span className="dw-setup-size-num">{n}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="dw-setup-actions">
              <button
                type="button"
                className="dw-float-refresh"
                onClick={onRandomizeBoard}
                aria-label="New random map"
                title="New random map"
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  aria-hidden
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                  <path d="M16 21h5v-5" />
                </svg>
              </button>
              <button type="button" className="btn btn-board primary" onClick={onStartGame}>
                Start game
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  )
}
