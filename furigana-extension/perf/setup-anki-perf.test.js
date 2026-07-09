/**
 * Unit tests for computeDeckPlan() (perf/setup-anki-perf.js), issue #44 AC 12-16.
 *
 * computeDeckPlan is the pure planning half of the Anki-perf-deck seeder: given
 * a vocabulary list it decides which words become notes (an order-preserving
 * prefix, not a random sample, so the overlap set is exact and assertable), how
 * many are deliberately left unmatched (so anki-unknown stays exercisable
 * against a wide page seeded from this same deck), and how many are duplicated
 * (so anki-duplicate stays exercisable too). Live AnkiConnect I/O
 * (seedAnkiPerfDeck) is deferred to a later slice — this file asserts none of
 * that, only the deterministic planning logic.
 */
import { describe, it, expect } from 'vitest';
import { computeDeckPlan } from './setup-anki-perf.js';
import { KANJI_NOUNS, KANJI_SINGLE, VERBS, ADJECTIVES } from './fixtures/corpus.js';

// Real Japanese vocabulary drawn from the existing fixture pools, not opaque
// placeholder strings — 50+15+20+18 = 103 distinct words, sliced to exactly 100.
const VOCAB_100 = [...KANJI_NOUNS, ...KANJI_SINGLE, ...VERBS, ...ADJECTIVES].slice(0, 100);

describe('computeDeckPlan — overlap sizing', () => {
  it('T-44-012 default overlapRatio=0.6 over a 100-word vocab matches exactly 60 distinct vocab-prefix expressions', () => {
    const plan = computeDeckPlan(VOCAB_100);
    const distinctExpressions = new Set(plan.map((p) => p.expression));

    expect(distinctExpressions.size).toBe(60);
    const matchedPrefix = new Set(VOCAB_100.slice(0, 60));
    for (const expr of distinctExpressions) {
      expect(matchedPrefix.has(expr)).toBe(true);
    }
  });

  it('T-44-013 overlapRatio < 1 deliberately leaves some vocab words unmatched', () => {
    // Some vocab words must NOT appear in the deck, or anki-unknown status
    // could never be exercised against a wide page seeded from this deck.
    const plan = computeDeckPlan(VOCAB_100, { overlapRatio: 0.6 });
    const matchedCount = new Set(plan.map((p) => p.expression)).size;

    expect(matchedCount).toBeLessThan(VOCAB_100.length);
  });
});

describe('computeDeckPlan — duplicate notes', () => {
  it('T-44-014 default duplicateRatio=0.1 over 60 matched words appends exactly 6 duplicate-note entries', () => {
    const plan = computeDeckPlan(VOCAB_100);
    const distinctExpressionCount = new Set(plan.map((p) => p.expression)).size;

    expect(plan.length - distinctExpressionCount).toBe(6);
  });
});

describe('computeDeckPlan — determinism', () => {
  it('T-44-015 identical vocab and opts produce deep-equal plans across repeat calls', () => {
    // No Math.random/Date.now allowed — repeat calls must be exactly reproducible.
    const first = computeDeckPlan(VOCAB_100, { overlapRatio: 0.6, duplicateRatio: 0.1 });
    const second = computeDeckPlan(VOCAB_100, { overlapRatio: 0.6, duplicateRatio: 0.1 });

    expect(second).toEqual(first);
  });
});

describe('computeDeckPlan — invalid overlapRatio', () => {
  it('T-44-016 overlapRatio of 0 or greater than 1 throws', () => {
    expect(() => computeDeckPlan(VOCAB_100, { overlapRatio: 0 })).toThrow();
    expect(() => computeDeckPlan(VOCAB_100, { overlapRatio: 1.5 })).toThrow();
  });
});
