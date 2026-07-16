/**
 * Live-AnkiConnect seeding proof for `seedAnkiPerfDeck` (issue #44, Slice 10,
 * closes deferred AC-17). Proves the batched addNotes/notesInfo/multi I/O
 * shell (unit-tested against a fake `anki` in setup-anki-perf.test.js,
 * T-44-124…131) actually persists correctly against a *real* AnkiConnect
 * instance at perf scale, including reset-then-seed idempotency.
 *
 * Unlike perf/e2e/browser-smoke.perf.js and perf/e2e/stress.perf.js, this
 * file launches NO Chromium and loads NO extension — it is pure `fetch`
 * against `http://127.0.0.1:8765`, run under the same `pnpm run perf:e2e`
 * command purely to reuse the Playwright test runner (`test`/`expect`,
 * `perf/playwright.perf.config.js`'s `testMatch: '**\/*.perf.js'`) as a
 * convenient assertion + reporting harness — not for any browser behavior.
 *
 * PREREQUISITES (different from every other perf/e2e/*.perf.js file):
 *   - Anki must be running with AnkiConnect on localhost:8765 (port
 *     OCCUPIED, same requirement as browser-smoke.perf.js / stress.perf.js).
 *   - NO pre-seeded deck is required — this file creates and populates the
 *     dedicated "AnkiKan-Perf" deck itself (via seedAnkiPerfDeck), distinct
 *     from the "AnkiKan-E2E" deck used by e2e/*.e2e.js and
 *     perf/e2e/browser-smoke.perf.js. Every query/mutation in this file is
 *     scoped to `deck:"AnkiKan-Perf"` — it never touches AnkiKan-E2E.
 *   - NOT build-gated — no `dist/` dependency, since no extension is loaded.
 *
 * Scale: SIZES.L (`computeDeckPlan(wideVocabulary(wideVocabSize(SIZES.L)))`
 * ≈ 2,310 notes: 2,100 matched + 210 duplicate-note re-entries), genuinely
 * multi-batch against the tuned defaults (batchSize=500, setBatchSize=200).
 * Full XL-scale seeding stays the documented manual
 * `node perf/setup-anki-perf.js` target (AC-15, not automated here).
 *
 * Run with:
 *   pnpm exec playwright test --config=perf/playwright.perf.config.js seed-anki-perf
 */

import { test, expect } from '@playwright/test';

import { computeDeckPlan, seedAnkiPerfDeck } from '../setup-anki-perf.js';
import { wideVocabulary, wideVocabSize } from '../fixtures/wide-vocab.js';
import { SIZES } from '../fixtures/generate.js';

const ANKI_URL = 'http://127.0.0.1:8765';
// Mirrors the DECK_NAME literal in perf/setup-anki-perf.js (not exported from
// there, so duplicated here — same "own fetch helper, no cross-directory
// import" convention already established by e2e/setup-anki-e2e.js and
// perf/e2e/browser-smoke.perf.js for their local AnkiConnect helpers).
const DECK_NAME = 'AnkiKan-Perf';

/** AnkiConnect fetch helper, mirrored (not imported) from e2e/setup-anki-e2e.js. */
async function anki(action, params = {}) {
  const res = await fetch(ANKI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`AnkiConnect error for ${action}: ${json.error}`);
  return json.result;
}

// Real, non-fabricated plan built from the actual exported planning
// functions — never hand-rolled plan objects. Built once at module scope
// (pure/no I/O) so both the beforeAll seed and every assertion below read
// from the exact same plan.
const plan = computeDeckPlan(wideVocabulary(wideVocabSize(SIZES.L)));

// ---------------------------------------------------------------------------
// Shared state, captured once by the expensive beforeAll seed.
// ---------------------------------------------------------------------------

/** @type {number} Wall-clock duration of the initial seedAnkiPerfDeck(plan) call, in ms. */
let seedDurationMs = NaN;

test.describe.serial('seedAnkiPerfDeck — live AnkiConnect proof at SIZES.L scale (issue #44 AC-10…14)', () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeAll(async () => {
    // A live seed of ~2,310 notes (batched, but still dozens of real network
    // round trips) is slow — give the hook itself the same generous budget
    // as the tests, regardless of Playwright's hook-vs-test timeout inheritance.
    test.setTimeout(300_000);

    const start = Date.now();
    await seedAnkiPerfDeck(plan);
    seedDurationMs = Date.now() - start;
  });

  test('T-44-132 findNotes(deck:"AnkiKan-Perf") returns exactly plan.length note ids after seeding (AC-10)', async () => {
    const noteIds = await anki('findNotes', { query: `deck:"${DECK_NAME}"` });
    expect(noteIds).toHaveLength(plan.length);
  });

  test('T-44-133 cardsInfo for a sample of targetType 0/1/2 plan entries matches the live card type/queue (AC-11)', async () => {
    // Sample indices 210/211/212 deliberately avoid the duplicate-note
    // region (computeDeckPlan's duplicate slice is matched.slice(0, 210),
    // i.e. only indices 0..209 have a non-unique expression) — plan[210],
    // plan[211], plan[212] each carry a distinct expression AND, since
    // toEntry assigns targetType/targetQueue as `i % 3`, cover all three
    // target types (0, 1, 2) in three consecutive picks.
    const sampleIndices = [210, 211, 212];
    const samples = sampleIndices.map((i) => plan[i]);
    expect(samples.map((s) => s.targetType).sort()).toEqual([0, 1, 2]);

    for (const { expression, targetType, targetQueue } of samples) {
      const cardIds = await anki('findCards', {
        query: `deck:"${DECK_NAME}" Expression:"${expression}"`,
      });
      // Each sampled expression is deliberately non-duplicated (see above),
      // so exactly one live card must back it.
      expect(cardIds).toHaveLength(1);

      const [info] = await anki('cardsInfo', { cards: cardIds });
      expect(info.type).toBe(targetType);
      expect(info.queue).toBe(targetQueue);
    }
  });

  test('T-44-134 a known duplicate expression resolves to 2 distinct live card ids (AC-12)', async () => {
    // computeDeckPlan appends a duplicate-note re-entry of matched.slice(0, 210)
    // after the matched entries, so plan[0]'s expression recurs later in the
    // plan (see setup-anki-perf.test.js's T-44-014/T-44-127 for the same
    // frozen shape) — find its second occurrence to identify the pair, rather
    // than hardcoding an index.
    const dupExpression = plan[0].expression;
    const occurrenceCount = plan.filter((p) => p.expression === dupExpression).length;
    expect(occurrenceCount).toBe(2);

    const cardIds = await anki('findCards', {
      query: `deck:"${DECK_NAME}" Expression:"${dupExpression}"`,
    });

    expect(cardIds).toHaveLength(2);
    expect(new Set(cardIds).size).toBe(2);
  });

  test('T-44-135 re-running seedAnkiPerfDeck(plan) a second time keeps the note count at exactly plan.length (AC-13, reset-then-seed idempotency)', async () => {
    await seedAnkiPerfDeck(plan);

    const noteIds = await anki('findNotes', { query: `deck:"${DECK_NAME}"` });
    expect(noteIds).toHaveLength(plan.length);
  });

  test('T-44-136 the initial live seed resolved with a finite, non-negative wall-clock duration within the configured timeout (AC-14, liveness proof)', async () => {
    // Not a numeric perf gate (per AC-14): this is a liveness proof that
    // batching actually lets a ~2,310-note seed resolve at all, rather than
    // timing out — the exact failure mode batching was introduced to fix.
    expect(Number.isFinite(seedDurationMs)).toBe(true);
    expect(seedDurationMs).toBeGreaterThan(0);
  });
});
