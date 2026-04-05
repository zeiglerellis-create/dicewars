import { useEffect, useId, useState, type CSSProperties } from 'react'
import { type GameState, type PlayerId } from '../engine/types'
import { playerTerritoryStats } from '../engine/scoring'

export interface HUDProps {
  game: GameState
  /** Called when the user confirms starting a new game. */
  onNewGameConfirmed: () => void
  errorMessage: string | null
}

export function HUD({ game, onNewGameConfirmed, errorMessage }: HUDProps) {
  const [newGameOpen, setNewGameOpen] = useState(false)
  const newGameTitleId = useId()

  useEffect(() => {
    if (!newGameOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNewGameOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [newGameOpen])

  const showCurrentPlayerOutline =
    game.phase !== 'PREGAME' && game.phase !== 'GAME_OVER'

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
          <button
            type="button"
            className="btn btn-sm toolbar-new-game"
            onClick={() => setNewGameOpen(true)}
          >
            New game
          </button>
        </div>
      </div>

      {errorMessage && <p className="toolbar-error">{errorMessage}</p>}

      <div className="toolbar-player-strip-wrap">
        <div className="player-strip" role="list" aria-label="Players and territory">
          {playerRows.map(({ id, owned, totalDice, largestTouchingGroup }) => {
            const isActive = showCurrentPlayerOutline && id === game.currentPlayer
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
                aria-current={isActive ? 'true' : undefined}
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
                  </div>
                </header>
                <div
                  className="player-card__compact-metrics"
                  title="Linked cluster (reinforcement size), tiles owned, total dice"
                  aria-label={`Player ${id}: ${largestTouchingGroup} linked, ${owned} tiles, ${totalDice} dice`}
                >
                  <div className="player-card__compact-metric">
                    <span className="player-card__compact-val">{largestTouchingGroup}</span>
                    <span className="player-card__compact-lbl">Linked</span>
                  </div>
                  <div className="player-card__compact-metric">
                    <span className="player-card__compact-val">{owned}</span>
                    <span className="player-card__compact-lbl">tiles</span>
                  </div>
                  <div className="player-card__compact-metric">
                    <span className="player-card__compact-val">{totalDice}</span>
                    <span className="player-card__compact-lbl">dice</span>
                  </div>
                </div>
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

      {newGameOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setNewGameOpen(false)}
        >
          <div
            className="modal modal--compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby={newGameTitleId}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id={newGameTitleId}>Start a new game?</h2>
            <p>
              Your current match will be abandoned and replaced with a fresh board using the same player count and board
              size.
            </p>
            <div className="modal-actions modal-actions--row">
              <button type="button" className="btn" onClick={() => setNewGameOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  onNewGameConfirmed()
                  setNewGameOpen(false)
                }}
              >
                New game
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
