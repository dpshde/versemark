/**
 * Frozen daily PRNG: xmur3 → mulberry32
 * Seed string: "versemark#" + N
 * (ADR: seed-daily-puzzle-from-date-hash)
 */

/** xmur3 hash → 32-bit seed state factory (public domain). */
export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** mulberry32 PRNG from a 32-bit seed (public domain). */
export function mulberry32(a: number): () => number {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded RNG for puzzle N. */
export function rngForPuzzle(n: number): () => number {
  const seedFn = xmur3(`versemark#${n}`);
  return mulberry32(seedFn());
}
