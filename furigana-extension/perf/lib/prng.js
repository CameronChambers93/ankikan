/**
 * Deterministic PRNG helpers so every perf fixture is byte-for-byte reproducible
 * across runs and machines. A fixed seed is the only thing standing between a
 * meaningful baseline diff and noise, so nothing here may touch Math.random.
 */

/**
 * mulberry32 — a tiny, fast, well-distributed 32-bit PRNG.
 * @param {number} seed - Any integer; coerced to uint32.
 * @returns {() => number} A function yielding floats in [0, 1).
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Picks one element of `arr` using the supplied RNG.
 * @template T
 * @param {() => number} rng
 * @param {T[]} arr
 * @returns {T}
 */
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Returns true with probability `p`.
 * @param {() => number} rng
 * @param {number} p - 0..1
 */
export function chance(rng, p) {
  return rng() < p;
}
