import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fastForwardBotsToHumanTurn,
  runBotBattleAttack,
  runBotEndAttackAndReinforce,
  runBotPlacement,
} from './engine/bots'
import type { BoardHexPreset, ManualReinforceBatch } from './engine/types'
import {
  battleAttack,
  battleSelectAttacker,
  beginPlacementFromPregame,
  createInitialGameState,
  endAttackPhase,
  manualReinforcementPlaceDice,
  placementClick,
  randomizeBoardPregame,
  setBoardHexPresetPregame,
  setIslandCountPregame,
  setManualReinforcementBatchSize,
  setManualStalemateReinforcePregame,
  setPlayerCountPregame,
  tickReinforcementAnimation,
} from './engine/rules'
import { BoardChrome, BoardStatusStrip } from './ui/BoardChrome'
import { GameCanvas } from './ui/GameCanvas'
import { HUD } from './ui/HUD'
import './App.css'

/** Pause between bot placement clicks (readable, still snappy). */
const BOT_PLACEMENT_DELAY_MS = 520
/** Pause between bot battle steps (one attack or end-turn). */
const BOT_BATTLE_STEP_DELAY_MS = 480
/** Pause between each end-of-turn reinforcement +1 (human and AI). */
const REINFORCEMENT_TICK_MS = 95

export default function App() {
  const [game, setGame] = useState(() => createInitialGameState(40))
  const [error, setError] = useState<string | null>(null)
  const boardWrapRef = useRef<HTMLDivElement>(null)

  const onHexClick = useCallback((hexId: string) => {
    setError(null)
    setGame((prev) => {
      if (prev.phase === 'PREGAME' || prev.phase === 'GAME_OVER') return prev
      if (prev.reinforcementAnimation) return prev
      if (prev.players.isBot[prev.currentPlayer]) {
        return prev
      }
      const s = structuredClone(prev)
      let err: string | null = null
      if (s.phase === 'PLACEMENT') {
        err = placementClick(s, hexId)
      } else if (s.phase === 'BATTLE' && s.battle.subPhase === 'MANUAL_REINFORCE') {
        err = manualReinforcementPlaceDice(s, hexId)
      } else if (s.phase === 'BATTLE' && s.battle.subPhase === 'CHOOSING_ATTACK') {
        const t = s.tiles[hexId]
        if (!t) return prev
        if (t.owner === s.currentPlayer) {
          battleSelectAttacker(s, hexId)
        } else if (s.battle.selection.selectedAttackerHexId) {
          err = battleAttack(s, hexId)
        }
      }
      if (err) queueMicrotask(() => setError(err))
      return s
    })
  }, [])

  const onEndTurn = useCallback(() => {
    setError(null)
    setGame((prev) => {
      const s = structuredClone(prev)
      endAttackPhase(s)
      return s
    })
  }, [])

  const onNewGameConfirmed = useCallback(() => {
    setGame((prev) =>
      createInitialGameState(prev.boardHexPreset === 'full' ? 40 : prev.boardHexCount, {
        playerCount: prev.playerCount,
        islandCount: prev.islandCount,
        manualStalemateReinforce: prev.manualStalemateReinforce,
        boardHexPreset: prev.boardHexPreset,
        pregameBoardCss: prev.pregameBoardCss,
      }),
    )
    setError(null)
  }, [])

  const onSetIslandCount = useCallback((n: number) => {
    setError(null)
    setGame((prev) => {
      const s = structuredClone(prev)
      const err = setIslandCountPregame(s, n)
      if (err) queueMicrotask(() => setError(err))
      return s
    })
  }, [])

  const onSetPlayerCount = useCallback((n: number) => {
    setError(null)
    setGame((prev) => {
      const s = structuredClone(prev)
      const err = setPlayerCountPregame(s, n)
      if (err) queueMicrotask(() => setError(err))
      return s
    })
  }, [])

  const measureBoardAreaCss = useCallback((): { width: number; height: number } => {
    const el = boardWrapRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      return { width: Math.max(120, r.width), height: Math.max(120, r.height) }
    }
    return {
      width: typeof window !== 'undefined' ? Math.max(120, window.innerWidth) : 800,
      height:
        typeof window !== 'undefined'
          ? Math.max(160, Math.floor(window.innerHeight * 0.52))
          : 560,
    }
  }, [])

  const onSetBoardHexPreset = useCallback(
    (preset: BoardHexPreset) => {
      setError(null)
      setGame((prev) => {
        const s = structuredClone(prev)
        const css = preset === 'full' ? measureBoardAreaCss() : null
        const err = setBoardHexPresetPregame(s, preset, css)
        if (err) queueMicrotask(() => setError(err))
        return s
      })
    },
    [measureBoardAreaCss],
  )

  const onSetManualStalemateReinforce = useCallback((enabled: boolean) => {
    setError(null)
    setGame((prev) => {
      const s = structuredClone(prev)
      const err = setManualStalemateReinforcePregame(s, enabled)
      if (err) queueMicrotask(() => setError(err))
      return s
    })
  }, [])

  const onSetReinforcementBatchSize = useCallback((batch: ManualReinforceBatch) => {
      setError(null)
      setGame((prev) => {
        const s = structuredClone(prev)
        const err = setManualReinforcementBatchSize(s, batch)
        if (err) queueMicrotask(() => setError(err))
        return s
      })
    }, [])

  const onRandomizeBoard = useCallback(() => {
    setError(null)
    setGame((prev) => {
      const s = structuredClone(prev)
      const err = randomizeBoardPregame(s)
      if (err) queueMicrotask(() => setError(err))
      return s
    })
  }, [])

  const onStartGame = useCallback(() => {
    setError(null)
    setGame((prev) => {
      const s = structuredClone(prev)
      const err = beginPlacementFromPregame(s)
      if (err) queueMicrotask(() => setError(err))
      return s
    })
  }, [])

  const onSkipAiTurns = useCallback(() => {
    setError(null)
    setGame((prev) => {
      if (prev.phase !== 'PLACEMENT' && prev.phase !== 'BATTLE') return prev
      if (!prev.players.isBot[prev.currentPlayer]) return prev
      const s = structuredClone(prev)
      fastForwardBotsToHumanTurn(s)
      return s
    })
  }, [])

  useEffect(() => {
    if (game.phase !== 'PLACEMENT') return
    if (!game.players.isBot[game.currentPlayer]) return
    const t = window.setTimeout(() => {
      setGame((prev) => {
        if (prev.phase !== 'PLACEMENT' || !prev.players.isBot[prev.currentPlayer]) return prev
        const s = structuredClone(prev)
        runBotPlacement(s)
        return s
      })
    }, BOT_PLACEMENT_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [game.phase, game.currentPlayer, game.placement.orderIndex, game.players])

  const reinforcementAnimKey = game.reinforcementAnimation
    ? `${game.reinforcementAnimation.endingPlayer}-${game.reinforcementAnimation.hexIds.join(',')}`
    : null

  useEffect(() => {
    if (!reinforcementAnimKey) return
    const id = window.setInterval(() => {
      setGame((prev) => {
        if (!prev.reinforcementAnimation) return prev
        const s = structuredClone(prev)
        tickReinforcementAnimation(s)
        return s
      })
    }, REINFORCEMENT_TICK_MS)
    return () => window.clearInterval(id)
  }, [reinforcementAnimKey])

  useEffect(() => {
    if (game.phase !== 'BATTLE') return
    if (game.reinforcementAnimation) return
    if (!game.players.isBot[game.currentPlayer]) return
    const t = window.setTimeout(() => {
      setGame((prev) => {
        if (prev.reinforcementAnimation) return prev
        if (prev.phase !== 'BATTLE' || !prev.players.isBot[prev.currentPlayer]) return prev
        const s = structuredClone(prev)
        if (s.battle.subPhase !== 'CHOOSING_ATTACK') return prev
        if (!runBotBattleAttack(s)) {
          runBotEndAttackAndReinforce(s)
        }
        return s
      })
    }, BOT_BATTLE_STEP_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [
    game.phase,
    game.currentPlayer,
    game.battle.subPhase,
    game.logs.length,
    game.tileIds,
    game.players,
    game.reinforcementAnimation,
  ])

  const [hoveredHexId, setHoveredHexId] = useState<string | null>(null)

  const playAgain = useCallback(() => {
    setGame((prev) =>
      createInitialGameState(prev.boardHexPreset === 'full' ? 40 : prev.boardHexCount, {
        playerCount: prev.playerCount,
        islandCount: prev.islandCount,
        manualStalemateReinforce: prev.manualStalemateReinforce,
        boardHexPreset: prev.boardHexPreset,
        pregameBoardCss: prev.pregameBoardCss,
      }),
    )
    setError(null)
  }, [])

  useEffect(() => {
    if (game.phase !== 'PREGAME' || game.boardHexPreset !== 'full') return
    let t: ReturnType<typeof setTimeout>
    const onResize = () => {
      window.clearTimeout(t)
      t = window.setTimeout(() => {
        setGame((prev) => {
          if (prev.phase !== 'PREGAME' || prev.boardHexPreset !== 'full') return prev
          const s = structuredClone(prev)
          const err = setBoardHexPresetPregame(s, 'full', measureBoardAreaCss())
          if (err) queueMicrotask(() => setError(err))
          return s
        })
      }, 380)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.clearTimeout(t)
    }
  }, [game.phase, game.boardHexPreset, measureBoardAreaCss])

  return (
    <div className="dice-wars-app">
      <HUD game={game} onNewGameConfirmed={onNewGameConfirmed} errorMessage={error} />

      <div className="dw-board-stack">
        <div className="dw-board-wrap" ref={boardWrapRef}>
          <GameCanvas
            game={game}
            reinforcementPop={game.reinforcementPop}
            onHexClick={onHexClick}
            hoveredHexId={hoveredHexId}
            onHoverChange={setHoveredHexId}
          />
          <BoardChrome
            game={game}
            onRandomizeBoard={onRandomizeBoard}
            onStartGame={onStartGame}
            onSetPlayerCount={onSetPlayerCount}
            onSetBoardHexPreset={onSetBoardHexPreset}
            onSetIslandCount={onSetIslandCount}
            onSetManualStalemateReinforce={onSetManualStalemateReinforce}
          />
        </div>
        <BoardStatusStrip
          game={game}
          onEndTurn={onEndTurn}
          onSkipAiTurns={onSkipAiTurns}
          onSetReinforcementBatchSize={onSetReinforcementBatchSize}
        />
      </div>

      {game.phase === 'GAME_OVER' && game.winner !== undefined && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="win-title">
          <div className="modal">
            <h2 id="win-title">Player {game.winner} wins!</h2>
            <p style={{ color: game.players.colors[game.winner] }}>
              All {game.tileIds.length} hexes are theirs.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn primary" onClick={playAgain}>
                Play again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
