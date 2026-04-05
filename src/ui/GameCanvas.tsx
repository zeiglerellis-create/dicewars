import { useCallback, useEffect, useRef, useState } from 'react'
import { hexCorners, pointInConvexPolygon } from '../engine/hex'
import type { GameState, PlayerId } from '../engine/types'

const WORLD_HEX_RADIUS = 1

/** Pointy-top hex: horizontal extent from center to flat edge = √3/2·R */
const HEX_EXTENT_X = WORLD_HEX_RADIUS * (Math.sqrt(3) / 2)
const HEX_EXTENT_Y = WORLD_HEX_RADIUS

export interface GameCanvasProps {
  game: GameState
  /** Triggers a short +1 float when each reinforcement die lands */
  reinforcementPop?: { hexId: string; seq: number }
  onHexClick: (hexId: string) => void
  hoveredHexId: string | null
  onHoverChange: (hexId: string | null) => void
}

function boundsOf(game: GameState): { minX: number; maxX: number; minY: number; maxY: number } {
  let minCx = Infinity
  let maxCx = -Infinity
  let minCy = Infinity
  let maxCy = -Infinity
  for (const id of game.tileIds) {
    const { x, y } = game.tiles[id].center
    minCx = Math.min(minCx, x)
    maxCx = Math.max(maxCx, x)
    minCy = Math.min(minCy, y)
    maxCy = Math.max(maxCy, y)
  }
  const margin = 0.12
  return {
    minX: minCx - HEX_EXTENT_X - margin,
    maxX: maxCx + HEX_EXTENT_X + margin,
    minY: minCy - HEX_EXTENT_Y - margin,
    maxY: maxCy + HEX_EXTENT_Y + margin,
  }
}

function pickHex(game: GameState, wx: number, wy: number): string | null {
  let best: string | null = null
  for (const id of game.tileIds) {
    const c = game.tiles[id].center
    const corners = hexCorners(c.x, c.y, WORLD_HEX_RADIUS * 0.98)
    if (pointInConvexPolygon(wx, wy, corners)) best = id
  }
  return best
}

/** Light swatches (yellow, pale gray in default palette) need dark dice numerals. */
function diceLabelColor(owner: PlayerId): string {
  return owner === 4 || owner === 8 ? '#14161c' : '#f8fafc'
}

/** Distinct tunnel pairs: stroke + badge fill (labels 1…n). */
const TUNNEL_STYLES = [
  { stroke: '#fbbf24', badge: '#fbbf24', glow: 'rgba(251, 191, 36, 0.5)' },
  { stroke: '#a78bfa', badge: '#a78bfa', glow: 'rgba(167, 139, 250, 0.5)' },
  { stroke: '#34d399', badge: '#34d399', glow: 'rgba(52, 211, 153, 0.5)' },
  { stroke: '#f472b6', badge: '#f472b6', glow: 'rgba(244, 114, 182, 0.5)' },
  { stroke: '#38bdf8', badge: '#38bdf8', glow: 'rgba(56, 189, 248, 0.5)' },
  { stroke: '#fb923c', badge: '#fb923c', glow: 'rgba(251, 146, 60, 0.5)' },
] as const

function boardCentroid(game: GameState): { x: number; y: number } {
  let x = 0
  let y = 0
  for (const id of game.tileIds) {
    x += game.tiles[id].center.x
    y += game.tiles[id].center.y
  }
  const n = game.tileIds.length || 1
  return { x: x / n, y: y / n }
}

function maxHexDistanceFrom(game: GameState, cx: number, cy: number): number {
  let m = 0
  for (const id of game.tileIds) {
    const p = game.tiles[id].center
    m = Math.max(m, Math.hypot(p.x - cx, p.y - cy))
  }
  return m || 1
}

/** Unit vector from centroid toward P (or fallback). */
function outwardUnit(P: { x: number; y: number }, C: { x: number; y: number }): { x: number; y: number } {
  const vx = P.x - C.x
  const vy = P.y - C.y
  const len = Math.hypot(vx, vy) || 1
  return { x: vx / len, y: vy / len }
}

/**
 * Path: rim of hex A → arc outside the island → rim of hex B. Drawn in world space.
 */
function traceOutsideTunnelPath(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  C: { x: number; y: number },
  boardR: number,
): void {
  const nA = outwardUnit({ x: ax, y: ay }, C)
  const nB = outwardUnit({ x: bx, y: by }, C)
  /** Past hex edge, into “outside” band */
  const rim = 0.52
  const push = Math.max(0.95, boardR * 0.28)
  const ax0 = ax + nA.x * rim
  const ay0 = ay + nA.y * rim
  const bx0 = bx + nB.x * rim
  const by0 = by + nB.y * rim
  const outA = { x: ax + nA.x * push, y: ay + nA.y * push }
  const outB = { x: bx + nB.x * push, y: by + nB.y * push }

  const mid = { x: (outA.x + outB.x) / 2, y: (outA.y + outB.y) / 2 }
  let ux = mid.x - C.x
  let uy = mid.y - C.y
  let ulen = Math.hypot(ux, uy)
  if (ulen < 0.12) {
    const abx = bx - ax
    const aby = by - ay
    ux = -aby
    uy = abx
    ulen = Math.hypot(ux, uy) || 1
  }
  ux /= ulen
  uy /= ulen
  const chord = Math.hypot(outB.x - outA.x, outB.y - outA.y)
  const bulge = 0.5 * chord + boardR * 0.22 + 0.35
  const cx = mid.x + ux * bulge
  const cy = mid.y + uy * bulge

  ctx.beginPath()
  ctx.moveTo(ax0, ay0)
  ctx.lineTo(outA.x, outA.y)
  ctx.quadraticCurveTo(cx, cy, outB.x, outB.y)
  ctx.lineTo(bx0, by0)
}

function drawTunnelEndpointBadge(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  label: string,
  style: (typeof TUNNEL_STYLES)[number],
): void {
  const r = 0.17
  ctx.beginPath()
  ctx.arc(px, py, r, 0, Math.PI * 2)
  ctx.fillStyle = style.badge
  ctx.fill()
  ctx.strokeStyle = 'rgba(15, 17, 23, 0.92)'
  ctx.lineWidth = 0.055
  ctx.stroke()
  ctx.font = 'bold 0.19px system-ui,sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 0.038
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.strokeText(label, px, py)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(label, px, py)
}

export function GameCanvas({
  game,
  reinforcementPop,
  onHexClick,
  hoveredHexId,
  onHoverChange,
}: GameCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef(game)
  gameRef.current = game

  const [transform, setTransform] = useState({ scale: 1, ox: 0, oy: 0 })
  const [popFrame, setPopFrame] = useState(0)
  const plusOneAnimRef = useRef<{ hexId: string; start: number } | null>(null)

  /** Only changes when hex layout or tunnels change — avoids resetting canvas size every game tick. */
  const boardTopologyKey = `${game.boardHexCount}|${game.tileIds.join(',')}|${game.tunnels.map(([a, b]) => `${a}~${b}`).join('|')}`

  useEffect(() => {
    if (!reinforcementPop) return
    plusOneAnimRef.current = {
      hexId: reinforcementPop.hexId,
      start: performance.now(),
    }
    let raf: number
    const loop = () => {
      setPopFrame((f) => f + 1)
      const a = plusOneAnimRef.current
      if (!a) return
      if (performance.now() - a.start >= 400) {
        plusOneAnimRef.current = null
        setPopFrame((f) => f + 1)
        return
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when a new +1 tick fires (seq).
  }, [reinforcementPop?.seq, reinforcementPop?.hexId])

  const resize = useCallback(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const rect = canvas.getBoundingClientRect()
    const cssW = Math.max(1, rect.width)
    const cssH = Math.max(1, rect.height)
    const nextW = Math.floor(cssW * dpr)
    const nextH = Math.floor(cssH * dpr)
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW
      canvas.height = nextH
    }

    const b = boundsOf(gameRef.current)
    const bw = b.maxX - b.minX
    const bh = b.maxY - b.minY
    const pad = 18 * dpr
    const fitScale =
      Math.min((canvas.width - 2 * pad) / bw, (canvas.height - 2 * pad) / bh) * 0.98
    const geomCX = (b.minX + b.maxX) / 2
    const geomCY = (b.minY + b.maxY) / 2

    const ox = canvas.width / 2 - fitScale * geomCX
    const oy = canvas.height / 2 - fitScale * geomCY

    setTransform((prev) => {
      if (
        Math.abs(prev.scale - fitScale) < 1e-5 &&
        Math.abs(prev.ox - ox) < 0.5 &&
        Math.abs(prev.oy - oy) < 0.5
      ) {
        return prev
      }
      return { scale: fitScale, ox, oy }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boardTopologyKey gates callback when map changes; bounds read from gameRef
  }, [boardTopologyKey])

  useEffect(() => {
    resize()
    window.addEventListener('resize', resize)
    const canvas = ref.current
    const ro = new ResizeObserver(() => resize())
    if (canvas) ro.observe(canvas)
    return () => {
      window.removeEventListener('resize', resize)
      ro.disconnect()
    }
  }, [resize])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { scale, ox, oy } = transform
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#0f1117'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.setTransform(scale, 0, 0, scale, ox, oy)

    const sel = game.battle.selection
    const p = game.currentPlayer
    const humanPlacing = game.phase === 'PLACEMENT' && !game.players.isBot[p]

    for (const id of game.tileIds) {
      const t = game.tiles[id]
      const { x, y } = t.center
      const corners = hexCorners(x, y, WORLD_HEX_RADIUS)
      const isHover = id === hoveredHexId
      const isSel = id === sel.selectedAttackerHexId || id === sel.selectedDefenderHexId
      const isYourPlacementHex = humanPlacing && t.owner === p

      ctx.beginPath()
      ctx.moveTo(corners[0].x, corners[0].y)
      for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y)
      ctx.closePath()
      ctx.fillStyle = game.players.colors[t.owner]
      ctx.globalAlpha = isHover ? 0.95 : 0.88
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.strokeStyle = isSel ? '#e2e8f0' : 'rgba(0,0,0,0.5)'
      ctx.lineWidth = isSel ? 0.1 : 0.055
      ctx.stroke()

      if (isYourPlacementHex) {
        ctx.beginPath()
        ctx.moveTo(corners[0].x, corners[0].y)
        for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y)
        ctx.closePath()
        ctx.strokeStyle = isHover ? '#f8fafc' : 'rgba(226, 232, 240, 0.5)'
        ctx.lineWidth = isHover ? 0.1 : 0.075
        ctx.stroke()
      }

      ctx.fillStyle = diceLabelColor(t.owner)
      ctx.font = 'bold 0.55px system-ui,sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(t.dice), x, y)
    }

    const tun = game.tunnels
    if (tun.length > 0) {
      const C = boardCentroid(game)
      const boardR = maxHexDistanceFrom(game, C.x, C.y)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.setLineDash([])

      tun.forEach(([ia, ib], idx) => {
        const ta = game.tiles[ia]
        const tb = game.tiles[ib]
        if (!ta || !tb) return
        const st = TUNNEL_STYLES[idx % TUNNEL_STYLES.length]
        const nA = outwardUnit(ta.center, C)
        const nB = outwardUnit(tb.center, C)
        const ax = ta.center.x
        const ay = ta.center.y
        const bx = tb.center.x
        const by = tb.center.y

        traceOutsideTunnelPath(ctx, ax, ay, bx, by, C, boardR)
        ctx.strokeStyle = 'rgba(15, 17, 23, 0.85)'
        ctx.lineWidth = 0.22
        ctx.stroke()
        traceOutsideTunnelPath(ctx, ax, ay, bx, by, C, boardR)
        ctx.strokeStyle = st.stroke
        ctx.lineWidth = 0.13
        ctx.stroke()

        const label = String(idx + 1)
        const badgeDist = 0.4
        drawTunnelEndpointBadge(ctx, ax + nA.x * badgeDist, ay + nA.y * badgeDist, label, st)
        drawTunnelEndpointBadge(ctx, bx + nB.x * badgeDist, by + nB.y * badgeDist, label, st)
      })
    }

    const pop = plusOneAnimRef.current
    if (pop) {
      const tile = game.tiles[pop.hexId]
      if (tile) {
        const elapsed = performance.now() - pop.start
        const t = Math.min(1, elapsed / 380)
        const lift = 0.1 + 0.38 * (1 - (1 - t) * (1 - t))
        const alpha = Math.max(0, 1 - t * t * t)
        const { x, y } = tile.center
        ctx.font = 'bold 0.48px system-ui,sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.lineWidth = 0.04
        ctx.strokeStyle = `rgba(15,17,23,${alpha * 0.85})`
        ctx.fillStyle = `rgba(248,250,252,${alpha})`
        const py = y - lift
        ctx.strokeText('+1', x, py)
        ctx.fillText('+1', x, py)
      }
    }
  }, [game, hoveredHexId, transform, popFrame])

  const toWorld = useCallback(
    (clientX: number, clientY: number): { wx: number; wy: number } | null => {
      const canvas = ref.current
      if (!canvas) return null
      const r = canvas.getBoundingClientRect()
      const px = ((clientX - r.left) / r.width) * canvas.width
      const py = ((clientY - r.top) / r.height) * canvas.height
      const wx = (px - transform.ox) / transform.scale
      const wy = (py - transform.oy) / transform.scale
      return { wx, wy }
    },
    [transform],
  )

  const onMove = (e: React.MouseEvent) => {
    const w = toWorld(e.clientX, e.clientY)
    if (!w) return
    const id = pickHex(game, w.wx, w.wy)
    onHoverChange(id)
  }

  const onLeave = () => {
    onHoverChange(null)
  }

  const onClick = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const w = toWorld(e.clientX, e.clientY)
    if (!w) return
    const id = pickHex(game, w.wx, w.wy)
    if (id) onHexClick(id)
  }

  const selectablePlacement = (id: string): boolean => {
    if (game.phase !== 'PLACEMENT') return false
    return game.tiles[id].owner === game.currentPlayer
  }

  const cursor =
    game.phase === 'PLACEMENT' && hoveredHexId && selectablePlacement(hoveredHexId)
      ? 'pointer'
      : game.phase === 'BATTLE' && hoveredHexId
        ? 'pointer'
        : 'default'

  return (
    <canvas
      ref={ref}
      className="game-canvas"
      style={{ width: '100%', height: '100%', cursor, display: 'block', touchAction: 'manipulation' }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onClick={onClick}
      role="img"
      aria-label="Dice Wars board"
    />
  )
}
