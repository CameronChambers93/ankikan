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
import { computeDeckPlan, seedAnkiPerfDeck } from './setup-anki-perf.js';
import { KANJI_NOUNS, KANJI_SINGLE, VERBS, ADJECTIVES } from './fixtures/corpus.js';
import { wideVocabulary } from './fixtures/wide-vocab.js';

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

// ---------------------------------------------------------------------------
// seedAnkiPerfDeck — batched AnkiConnect I/O (issue #44 Slice 10)
//
// seedAnkiPerfDeck used to be a per-note loop (3 sequential AnkiConnect round
// trips per note: addNotes, findCards, setSpecificValueOfCard), which does not
// scale to XL-page-sized decks. This slice rewrites it into a batched shell:
// chunked addNotes, chunked notesInfo (to resolve cardIds without a findCards-
// by-expression query, which would collide on duplicate expressions), and
// chunked multi (to set type/queue). All AnkiConnect I/O goes through the
// injected `anki(action, params)` helper, so these tests never touch the
// network — they exercise the real seedAnkiPerfDeck against a small in-memory
// fake that stands in for AnkiConnect.
// ---------------------------------------------------------------------------

/**
 * Builds a plan of exactly `size` distinct entries via the real, frozen
 * computeDeckPlan (overlapRatio=1 matches the whole vocab, duplicateRatio=0
 * adds no duplicates), so the batching tests get an exact, real-vocab-backed
 * plan length without hand-fabricating plan objects.
 * @param {number} size
 */
function buildFlatPlan(size) {
  const vocab = wideVocabulary(size);
  return computeDeckPlan(vocab, { overlapRatio: 1, duplicateRatio: 0 });
}

/**
 * A small in-memory fake for the injected `anki(action, params)` helper.
 * Records every call (in order) and returns plausible AnkiConnect-shaped
 * results: addNotes mints fresh incrementing noteIds (or `null` at
 * `failNoteAtIndex`, the global 0-based note index across all addNotes
 * calls, to exercise the failure path); notesInfo mints a fresh incrementing
 * cardId per requested noteId; findNotes returns the configured
 * pre-existing ids; multi returns one `null` per sub-action.
 * @param {object} [opts]
 * @param {number[]} [opts.existingNoteIds] - findNotes result, for reset testing.
 * @param {number|null} [opts.failNoteAtIndex] - global note index whose addNotes id comes back null.
 */
function createFakeAnki({ existingNoteIds = [], failNoteAtIndex = null } = {}) {
  const calls = [];
  let noteCounter = 1;
  let cardCounter = 1;
  let globalNoteIndex = 0;

  async function anki(action, params = {}) {
    calls.push({ action, params });

    switch (action) {
      case 'createDeck':
        return null;
      case 'findNotes':
        return existingNoteIds;
      case 'deleteNotes':
        return null;
      case 'addNotes':
        return params.notes.map(() => {
          const idx = globalNoteIndex++;
          if (failNoteAtIndex !== null && idx === failNoteAtIndex) return null;
          return noteCounter++;
        });
      case 'notesInfo':
        return params.notes.map((noteId) => ({ noteId, cards: [cardCounter++] }));
      case 'multi':
        return params.actions.map(() => null);
      default:
        throw new Error(`createFakeAnki: unexpected action "${action}"`);
    }
  }

  return { anki, calls };
}

describe('seedAnkiPerfDeck — batched addNotes', () => {
  it('T-44-124 plan of 1,250 with batchSize=500 calls addNotes 3x with chunk sizes [500,500,250] in order', async () => {
    const plan = buildFlatPlan(1250);
    const { anki, calls } = createFakeAnki();

    await seedAnkiPerfDeck(plan, { anki, batchSize: 500 });

    const addNotesCalls = calls.filter((c) => c.action === 'addNotes');
    expect(addNotesCalls.map((c) => c.params.notes.length)).toEqual([500, 500, 250]);
  });
});

describe('seedAnkiPerfDeck — batched notesInfo', () => {
  it('T-44-125 notesInfo is called in the same 3-chunk pattern over addNotes-returned noteIds, in return order', async () => {
    const plan = buildFlatPlan(1250);
    const { anki, calls } = createFakeAnki();

    await seedAnkiPerfDeck(plan, { anki, batchSize: 500 });

    const notesInfoCalls = calls.filter((c) => c.action === 'notesInfo');
    expect(notesInfoCalls.map((c) => c.params.notes.length)).toEqual([500, 500, 250]);

    // The fake hands out sequential noteIds (1..1250) in addNotes call order,
    // which is plan order. notesInfo must re-chunk exactly that returned
    // sequence, not re-derive its own ids.
    const allReturnedNoteIds = Array.from({ length: 1250 }, (_, i) => i + 1);
    const expectedChunks = [
      allReturnedNoteIds.slice(0, 500),
      allReturnedNoteIds.slice(500, 1000),
      allReturnedNoteIds.slice(1000, 1250),
    ];
    expect(notesInfoCalls.map((c) => c.params.notes)).toEqual(expectedChunks);
  });
});

describe('seedAnkiPerfDeck — batched multi (setSpecificValueOfCard)', () => {
  it('T-44-126 setBatchSize=200 calls multi 7x with each sub-action index-aligned to plan targetType/targetQueue', async () => {
    const plan = buildFlatPlan(1250);
    const { anki, calls } = createFakeAnki();

    await seedAnkiPerfDeck(plan, { anki, batchSize: 500, setBatchSize: 200 });

    const multiCalls = calls.filter((c) => c.action === 'multi');
    expect(multiCalls).toHaveLength(7);
    expect(multiCalls.map((c) => c.params.actions.length)).toEqual([200, 200, 200, 200, 200, 200, 50]);

    // Flatten every sub-action across multi calls; position i must carry
    // plan[i]'s type/queue and the cardId the fake minted for note i. Both
    // the fake and the plan assign sequentially in plan order, so the
    // expected cardId at position i is i + 1.
    const flatActions = multiCalls.flatMap((c) => c.params.actions);
    expect(flatActions).toHaveLength(1250);
    flatActions.forEach((action, i) => {
      expect(action.action).toBe('setSpecificValueOfCard');
      expect(action.params.card).toBe(i + 1);
      expect(action.params.keys).toEqual(['type', 'queue']);
      expect(action.params.newValues).toEqual([plan[i].targetType, plan[i].targetQueue]);
      expect(action.params.warning_check).toBe(true);
    });
  });
});

describe('seedAnkiPerfDeck — duplicate-expression positional mapping', () => {
  it('T-44-127 a duplicate-expression pair each gets its own note+card, resolved by plan position not expression lookup', async () => {
    // Real duplicate pair from the frozen computeDeckPlan output (T-44-014):
    // plan[60] is the duplicate-note re-entry of plan[0]'s expression.
    const plan = computeDeckPlan(VOCAB_100);
    expect(plan[0].expression).toBe(plan[60].expression);

    const { anki, calls } = createFakeAnki();
    await seedAnkiPerfDeck(plan, { anki });

    const addNotesCalls = calls.filter((c) => c.action === 'addNotes');
    const allNotes = addNotesCalls.flatMap((c) => c.params.notes);
    expect(allNotes).toHaveLength(plan.length);
    expect(allNotes[0].fields.Expression).toBe(plan[0].expression);
    expect(allNotes[60].fields.Expression).toBe(plan[60].expression);

    const notesInfoCalls = calls.filter((c) => c.action === 'notesInfo');
    const allRequestedNoteIds = notesInfoCalls.flatMap((c) => c.params.notes);
    expect(allRequestedNoteIds[0]).not.toBe(allRequestedNoteIds[60]); // distinct notes despite identical expression

    const multiCalls = calls.filter((c) => c.action === 'multi');
    const flatActions = multiCalls.flatMap((c) => c.params.actions);
    expect(flatActions[0].params.card).not.toBe(flatActions[60].params.card); // distinct cards despite identical expression
    expect(flatActions[0].params.newValues).toEqual([plan[0].targetType, plan[0].targetQueue]);
    expect(flatActions[60].params.newValues).toEqual([plan[60].targetType, plan[60].targetQueue]);

    // The duplicate must be resolved by array position, never by an
    // expression-string findCards lookup (which would collide the pair).
    expect(calls.some((c) => c.action === 'findCards')).toBe(false);
  });
});

describe('seedAnkiPerfDeck — addNotes failure', () => {
  it('T-44-128 a null noteId from addNotes rejects naming the failed plan index and skips notesInfo/multi', async () => {
    const plan = buildFlatPlan(10);
    const { anki, calls } = createFakeAnki({ failNoteAtIndex: 3 });

    await expect(seedAnkiPerfDeck(plan, { anki })).rejects.toThrow(/3/);

    expect(calls.some((c) => c.action === 'notesInfo')).toBe(false);
    expect(calls.some((c) => c.action === 'multi')).toBe(false);
  });
});

describe('seedAnkiPerfDeck — tuned defaults', () => {
  it('T-44-129 default batchSize=500 and setBatchSize=200 are provable at the chunk-count boundary', async () => {
    // addNotes boundary: exactly 500 notes -> 1 chunk; 501 -> 2 chunks.
    {
      const plan500 = buildFlatPlan(500);
      const { anki, calls } = createFakeAnki();
      await seedAnkiPerfDeck(plan500, { anki });
      expect(calls.filter((c) => c.action === 'addNotes')).toHaveLength(1);
    }
    {
      const plan501 = buildFlatPlan(501);
      const { anki, calls } = createFakeAnki();
      await seedAnkiPerfDeck(plan501, { anki });
      expect(calls.filter((c) => c.action === 'addNotes')).toHaveLength(2);
    }

    // multi boundary: exactly 200 notes -> 1 multi call; 201 -> 2 calls.
    {
      const plan200 = buildFlatPlan(200);
      const { anki, calls } = createFakeAnki();
      await seedAnkiPerfDeck(plan200, { anki });
      expect(calls.filter((c) => c.action === 'multi')).toHaveLength(1);
    }
    {
      const plan201 = buildFlatPlan(201);
      const { anki, calls } = createFakeAnki();
      await seedAnkiPerfDeck(plan201, { anki });
      expect(calls.filter((c) => c.action === 'multi')).toHaveLength(2);
    }
  });
});

describe('seedAnkiPerfDeck — reset before seeding', () => {
  it('T-44-130 default reset:true deletes pre-existing notes before any addNotes call', async () => {
    const plan = buildFlatPlan(5);
    const { anki, calls } = createFakeAnki({ existingNoteIds: [111, 222, 333] });

    await seedAnkiPerfDeck(plan, { anki });

    const findNotesCalls = calls.filter((c) => c.action === 'findNotes');
    expect(findNotesCalls).toHaveLength(1);
    expect(findNotesCalls[0].params.query).toBe('deck:"AnkiKan-Perf"');

    const deleteNotesCalls = calls.filter((c) => c.action === 'deleteNotes');
    expect(deleteNotesCalls).toHaveLength(1);
    expect(deleteNotesCalls[0].params.notes).toEqual([111, 222, 333]);

    const deleteIndex = calls.findIndex((c) => c.action === 'deleteNotes');
    const firstAddNotesIndex = calls.findIndex((c) => c.action === 'addNotes');
    expect(firstAddNotesIndex).toBeGreaterThan(deleteIndex);
  });

  it('T-44-131 reset:false never calls findNotes or deleteNotes', async () => {
    const plan = buildFlatPlan(5);
    const { anki, calls } = createFakeAnki({ existingNoteIds: [111, 222, 333] });

    await seedAnkiPerfDeck(plan, { anki, reset: false });

    expect(calls.some((c) => c.action === 'findNotes')).toBe(false);
    expect(calls.some((c) => c.action === 'deleteNotes')).toBe(false);
  });
});
