/**
 * Effectively-unbounded, deterministic, prefix-consistent Japanese vocabulary
 * for the 'wide' fixture variant (issue #44).
 *
 * dense/sparse draw from a ~130-word hand-curated pool, so a page's distinct
 * lookup-word count plateaus regardless of size — an XL page ends up sending an
 * S-sized network payload to AnkiConnect. Rather than random sampling (birthday-
 * paradox collision risk) or a bounded pool with modulo-cycling (breaks
 * cross-size overlap), compounds here are the base-poolSize digit encoding of a
 * monotonically increasing index over a seeded-shuffled WIDE_KANJI_POOL.
 * WIDE_COMPOUND_LEN is fixed (not size-dependent), so wideVocabulary(N) is
 * always exactly [compound(0)...compound(N-1)] — prefix-consistency falls out
 * of the encoding for free, without any special-casing.
 */

import { mulberry32 } from '../lib/prng.js';
import { WIDE_KANJI_POOL } from './corpus.js';

export const WIDE_COMPOUND_LEN = 3;

const DEFAULT_SEED = 0x4b414e; // "KAN"

/** Deterministic Fisher-Yates shuffle, seeded so the same seed always yields the same pool order. */
function seededShuffle(arr, seed) {
  const rng = mulberry32(seed);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Base-`pool.length` digit encoding of `index`, zero-padded to WIDE_COMPOUND_LEN digits. */
function compoundForIndex(index, pool) {
  const base = pool.length;
  let n = index;
  const chars = [];
  for (let i = 0; i < WIDE_COMPOUND_LEN; i++) {
    chars.unshift(pool[n % base]);
    n = Math.floor(n / base);
  }
  return chars.join('');
}

/**
 * Returns `count` distinct, deterministic Han-only compounds for the given seed.
 * @param {number} count
 * @param {object} [opts]
 * @param {number} [opts.seed]
 * @returns {string[]}
 */
export function wideVocabulary(count, { seed = DEFAULT_SEED } = {}) {
  const bound = WIDE_KANJI_POOL.length ** WIDE_COMPOUND_LEN;
  if (count > bound) {
    throw new Error(`wideVocabulary: count ${count} exceeds addressable space ${bound} (WIDE_KANJI_POOL.length ** WIDE_COMPOUND_LEN)`);
  }
  const pool = seededShuffle(WIDE_KANJI_POOL, seed);
  const out = [];
  for (let i = 0; i < count; i++) out.push(compoundForIndex(i, pool));
  return out;
}

/**
 * Deliberately generous over-estimate of how many wide-vocab compounds a page
 * of `tokenCount` tokens will draw — used to size setup-anki-perf's deck so it's
 * a superset of any page's vocabulary, not an exact count.
 * @param {number} tokenCount
 * @returns {number}
 */
export function wideVocabSize(tokenCount) {
  return Math.max(8, Math.round(tokenCount * 0.35));
}

/**
 * Builds a stateful cursor that yields the next wide compound on each call,
 * starting from index 0. Used by generate.js so a page's wide vocabulary is
 * always a prefix of the full seed's vocabulary.
 * @param {number} seed
 * @returns {() => string}
 */
export function makeWideWordSource(seed) {
  const pool = seededShuffle(WIDE_KANJI_POOL, seed);
  let cursor = 0;
  return () => compoundForIndex(cursor++, pool);
}
