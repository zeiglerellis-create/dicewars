import type { HexTile, PlayerId } from './types'

export function countTilesOwnedBy(
  player: PlayerId,
  tiles: Record<string, HexTile>,
  tileIds: string[],
): number {
  let n = 0
  for (const id of tileIds) {
    if (tiles[id].owner === player) n++
  }
  return n
}

export function totalDiceForPlayer(
  player: PlayerId,
  tiles: Record<string, HexTile>,
  tileIds: string[],
): number {
  let s = 0
  for (const id of tileIds) {
    const t = tiles[id]
    if (t.owner === player) s += t.dice
  }
  return s
}

/** Owned hex count, dice sum, and size of the largest contiguous group (edge-adjacent same owner). */
export function playerTerritoryStats(
  player: PlayerId,
  tiles: Record<string, HexTile>,
  tileIds: string[],
): { owned: number; totalDice: number; largestTouchingGroup: number } {
  return {
    owned: countTilesOwnedBy(player, tiles, tileIds),
    totalDice: totalDiceForPlayer(player, tiles, tileIds),
    largestTouchingGroup: largestConnectedComponentSize(player, tiles, tileIds),
  }
}

export function largestConnectedComponentSize(
  player: PlayerId,
  tiles: Record<string, HexTile>,
  tileIds: string[],
): number {
  let best = 0
  const visited = new Set<string>()
  for (const id of tileIds) {
    const t = tiles[id]
    if (t.owner !== player || visited.has(id)) continue
    let size = 0
    const q = [id]
    visited.add(id)
    while (q.length) {
      const cur = q.shift()!
      size++
      for (const n of tiles[cur].neighbors) {
        const nt = tiles[n]
        if (nt && nt.owner === player && !visited.has(n)) {
          visited.add(n)
          q.push(n)
        }
      }
    }
    best = Math.max(best, size)
  }
  return best
}

/** Hypothetical largest component if `hexId` were owned by `asPlayer` with same adjacency. */
export function largestComponentIfOwner(
  tiles: Record<string, HexTile>,
  tileIds: string[],
  hexId: string,
  asPlayer: PlayerId,
): number {
  const owners = new Map<string, PlayerId>()
  for (const id of tileIds) {
    owners.set(id, id === hexId ? asPlayer : tiles[id].owner)
  }
  let best = 0
  const visited = new Set<string>()
  for (const id of tileIds) {
    const o = owners.get(id)!
    if (o !== asPlayer || visited.has(id)) continue
    let size = 0
    const q = [id]
    visited.add(id)
    while (q.length) {
      const cur = q.shift()!
      size++
      for (const n of tiles[cur].neighbors) {
        const no = owners.get(n)
        if (no === asPlayer && !visited.has(n)) {
          visited.add(n)
          q.push(n)
        }
      }
    }
    best = Math.max(best, size)
  }
  return best
}

export function enemyNeighborDiceTotal(tile: HexTile, tiles: Record<string, HexTile>): number {
  let sum = 0
  for (const n of tile.neighbors) {
    const nb = tiles[n]
    if (nb && nb.owner !== tile.owner) sum += nb.dice
  }
  return sum
}

export function countEnemyNeighbors(tile: HexTile, tiles: Record<string, HexTile>): number {
  let c = 0
  for (const n of tile.neighbors) {
    const nb = tiles[n]
    if (nb && nb.owner !== tile.owner) c++
  }
  return c
}
