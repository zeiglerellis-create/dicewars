/** Mulberry32 — deterministic PRNG; mutates state in place. */
export interface Rng {
  state: number
}

export function createRng(seed: number): Rng {
  return { state: seed >>> 0 }
}

/** Next float in [0, 1) */
export function nextFloat(rng: Rng): number {
  let t = (rng.state += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function nextInt(rng: Rng, min: number, maxExclusive: number): number {
  return min + Math.floor(nextFloat(rng) * (maxExclusive - min))
}

export function rollD6(rng: Rng): number {
  return nextInt(rng, 1, 7)
}

export function shuffleInPlace<T>(rng: Rng, arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(rng, 0, i + 1)
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}
