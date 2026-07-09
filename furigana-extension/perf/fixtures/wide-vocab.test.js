/**
 * Unit tests for wideVocabulary() and friends (perf/fixtures/wide-vocab.js),
 * issue #44 AC 1-4.
 *
 * dense/sparse fixtures draw from a ~130-word pool, so scanPage's post-dedup
 * network payload doesn't scale with page size — the exact symptom this issue
 * closes. wideVocabulary exists to give fixtures an effectively unbounded,
 * deterministic, prefix-consistent Japanese vocabulary so that regression is
 * actually exercisable. These tests lock determinism, uniqueness, the
 * prefix-consistency property the whole encoding design depends on, and the
 * failure path when the requested count exceeds what the pool can encode.
 */
import { describe, it, expect } from 'vitest';
import { wideVocabulary, WIDE_COMPOUND_LEN } from './wide-vocab.js';
import { WIDE_KANJI_POOL } from './corpus.js';

const SEED = 0x4b414e;

describe('wideVocabulary', () => {
  it('T-44-001 identical seed and count produce byte-identical output on repeat calls', () => {
    // Baseline diffing across CI runs requires the exact same bytes every time;
    // any nondeterminism here would poison every downstream fixture.
    const a = wideVocabulary(200, { seed: SEED });
    const b = wideVocabulary(200, { seed: SEED });
    expect(b).toEqual(a);
  });

  it('T-44-002 5000 requested compounds are all distinct', () => {
    // The whole point of wideVocabulary over the existing hand-curated pools is
    // an effectively unbounded set of *distinct* lookup words at page scale.
    const vocab = wideVocabulary(5000);
    expect(vocab.length).toBe(5000);
    expect(new Set(vocab).size).toBe(5000);
  });

  it('T-44-003 a smaller vocab is a strict ordered prefix of a larger vocab for the same seed', () => {
    // Prefix-consistency is what lets a wide S page's vocabulary be guaranteed a
    // subset of an XL page's (and of setup-anki-perf's deck vocabulary) without
    // any special-casing — it falls out of the monotonically-increasing index
    // encoding, not random sampling.
    const small = wideVocabulary(50, { seed: SEED });
    const large = wideVocabulary(5000, { seed: SEED });
    expect(small).toEqual(large.slice(0, 50));
  });

  it('T-44-004 requesting more compounds than the pool can encode throws', () => {
    // WIDE_COMPOUND_LEN is fixed (not size-dependent), so the addressable space
    // is exactly WIDE_KANJI_POOL.length ** WIDE_COMPOUND_LEN; exceeding it must
    // fail loudly rather than silently produce duplicate or malformed compounds.
    const bound = WIDE_KANJI_POOL.length ** WIDE_COMPOUND_LEN;
    expect(() => wideVocabulary(bound + 1)).toThrow();
  });
});
