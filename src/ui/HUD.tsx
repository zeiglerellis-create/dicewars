import { useEffect, useId, useState, type CSSProperties } from 'react'
import { type GameState, type PlayerId } from '../engine/types'
import { playerTerritoryStats } from '../engine/scoring'

export interface HUDProps {
  game: GameState
  onSkipAiTurns: () => void
  /** Called only after the two-step confirmation completes. */
  onNewGameConfirmed: () => void
  errorMessage: string | null
}

export function HUD({ game, onSkipAiTurns, onNewGameConfirmed, errorMessage }: HUDProps) {
  const [newGameStep, setNewGameStep] = useState<0 | 1 | 2>(0)
  const newGameTitleId = useId()

  useEffect(() => {
    if (newGameStep === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNewGameStep(0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newGameStep])

  const p = game.currentPlayer
  const color = game.players.colors[p]

  const phaseLabel =
    game.phase === 'PREGAME'
      ? 'Setup'
      : game.phase === 'PLACEMENT'
        ? 'Placement'
        : game.phase === 'BATTLE'
          ? 'Battle'
          : 'Over'

  const botsTurn =
    (game.phase === 'PLACEMENT' || game.phase === 'BATTLE') && game.players.isBot[game.currentPlayer]

  const showTurnInToolbar = game.phase !== 'PREGAME' && game.phase !== 'GAME_OVER'

  const playerRowsAll = Array.from({ length: game.playerCount }, (_, i) => {
    const id = (i + 1) as PlayerId
    return { id, ...playerTerritoryStats(id, game.tiles, game.tileIds) }
  })
  const playerRows = playerRowsAll.filter((r) => r.owned > 0)
  const maxCluster = Math.max(1, ...playerRows.map((r) => r.largestTouchingGroup), 0)
  const topCluster =
    playerRows.length > 0 ? Math.max(...playerRows.map((r) => r.largestTouchingGroup)) : 0

  return (
    <header className="game-toolbar">
      <div className="toolbar-top-cluster">
        <div className="toolbar-row toolbar-title">
          <h1 className="toolbar-brand">Dice Wars</h1>
          <span className="toolbar-phase">{phaseLabel}</span>
          {showTurnInToolbar && (
            <span
              className={
                'toolbar-player toolbar-turn' +
                (game.players.isBot[p] ? ' toolbar-turn--ai' : ' toolbar-turn--you')
              }
              style={{ color }}
            >
              <span className="toolbar-turn-dot" aria-hidden />
              <span className="toolbar-turn-label">Turn</span>
              <span className="toolbar-turn-who">
                P{p}
                {game.players.isBot[p] ? ' · AI' : ' · you'}
              </span>
            </span>
          )}
          {botsTurn && (
            <button
              type="button"
              className="btn btn-sm skip-ai-inline"
              onClick={onSkipAiTurns}
              title="Finish AI moves and return to your turn"
            >
              Skip AI
            </button>
          )}
          <span className="toolbar-meta">
            {game.playerCount}p · {game.boardHexCount} hex
          </span>
          <button
            type="button"
            className="btn btn-sm toolbar-new-game"
            onClick={() => setNewGameStep(1)}
          >
            New game
          </button>
        </div>
      </div>

      {errorMessage && <p className="toolbar-error">{errorMessage}</p>}

      <div className="toolbar-player-strip-wrap">
        <div className="player-strip" role="list" aria-label="Players and territory">
          {playerRows.map(({ id, owned, totalDice, largestTouchingGroup }) => {
            const isActive = showTurnInToolbar && id === game.currentPlayer
            const rowColor = game.players.colors[id]
            const clusterPct = Math.round((100 * largestTouchingGroup) / maxCluster)
            const tiesForTopCluster =
              topCluster > 0 &&
              largestTouchingGroup === topCluster &&
              playerRows.filter((r) => r.largestTouchingGroup === topCluster).length > 1
            return (
              <article
                key={id}
                role="listitem"
                className={
                  'player-card' +
                  (isActive ? ' player-card--active' : '') +
                  (topCluster > 0 && largestTouchingGroup === topCluster ? ' player-card--cluster-top' : '')
                }
                style={{ '--player-accent': rowColor } as CSSProperties}
              >
                <div className="player-card__glow" aria-hidden />
                <header className="player-card__head">
                  <span className="player-card__swatch" style={{ background: rowColor }} aria-hidden />
                  <div className="player-card__id">
                    <span className="player-card__pn">P{id}</span>
                    <span className="player-card__role">{game.players.isBot[id] ? 'AI' : 'You'}</span>
                  </div>
                  <div className="player-card__head-right">
                    {topCluster > 0 && largestTouchingGroup === topCluster && (
                      <span
                        className="player-card__crown"
                        title={tiesForTopCluster ? 'Tied for biggest cluster' : 'Biggest cluster on the board'}
                        aria-label={tiesForTopCluster ? 'Tied for biggest cluster' : 'Biggest cluster on the board'}
                      >
                        ◆
                      </span>
                    )}
                    {isActive && <span className="player-card__turn">Turn</span>}
                  </div>
                </header>
                <div className="player-card__cluster">
                  <div className="player-card__cluster-head">
                    <span className="player-card__cluster-num">{largestTouchingGroup}</span>
                    <span className="player-card__cluster-unit">linked</span>
                  </div>
                  <p className="player-card__cluster-hint">Largest connected group</p>
                  <div
                    className="player-card__bar"
                    role="img"
                    aria-label={`Cluster strength ${clusterPct} percent of current leader`}
                  >
                    <div
                      className="player-card__bar-fill"
                      style={{ width: `${clusterPct}%` }}
                    />
                  </div>
                </div>
                <footer className="player-card__foot">
                  <div className="player-card__foot-stat">
                    <span className="player-card__tiles-val">{owned}</span>
                    <span className="player-card__tiles-lbl">tiles</span>
                  </div>
                  <div className="player-card__foot-stat">
                    <span className="player-card__tiles-val">{totalDice}</span>
                    <span className="player-card__tiles-lbl">dice</span>
                  </div>
                </footer>
              </article>
            )
          })}
        </div>
      </div>

      {newGameStep > 0 && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setNewGameStep(0)}
        >
          <div
            className="modal modal--compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby={newGameTitleId}
            onClick={(e) => e.stopPropagation()}
          >
            {newGameStep === 1 && (
              <>
                <h2 id={newGameTitleId}>Start a new game?</h2>
                <p>Your current match will be abandoned. This is the first of two confirmations.</p>
                <div className="modal-actions modal-actions--row">
                  <button type="button" className="btn" onClick={() => setNewGameStep(0)}>
                    Cancel
                  </button>
                  <button type="button" className="btn primary" onClick={() => setNewGameStep(2)}>
                    Continue
                  </button>
                </div>
              </>
            )}
            {newGameStep === 2 && (
              <>
                <h2 id={newGameTitleId}>Confirm new game</h2>
                <p>
                  <strong>Last step:</strong> discard this game and generate a fresh board with the same player count,
                  board size, and skip-placement setting?
                </p>
                <div className="modal-actions modal-actions--row">
                  <button type="button" className="btn" onClick={() => setNewGameStep(0)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => {
                      onNewGameConfirmed()
                      setNewGameStep(0)
                    }}
                  >
                    Yes — new game
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
