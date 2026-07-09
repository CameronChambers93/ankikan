/**
 * Plans and seeds an Anki deck sized for the 'wide' perf fixture's vocabulary,
 * so scanPage's anki-unlearned/learning/learned/unknown/duplicate status paths
 * are all exercisable against a wide page at real scale.
 *
 * computeDeckPlan is pure (no fetch/Math.random/Date.now) so it's fully
 * Vitest-covered; seedAnkiPerfDeck is a thin, dependency-injected I/O shell that
 * mirrors e2e/setup-anki-e2e.js's fetch helper (deliberately not imported
 * cross-directory) and is exercised only against a live AnkiConnect instance.
 *
 *   node perf/setup-anki-perf.js
 *
 * Requires Anki to be running with AnkiConnect on localhost:8765.
 */

import { wideVocabulary, wideVocabSize } from './fixtures/wide-vocab.js';
import { SIZES } from './fixtures/generate.js';

const ANKI_URL = 'http://127.0.0.1:8765';
const DECK_NAME = 'AnkiKan-Perf';
const MODEL_NAME = 'Japanese';

/**
 * Computes which vocab words become Anki notes, which are deliberately left
 * unmatched, and which are duplicated — pure planning logic, no I/O.
 *
 * @param {string[]} vocab
 * @param {object} [opts]
 * @param {number} [opts.overlapRatio=0.6] - Fraction of vocab (prefix) matched into the deck.
 * @param {number} [opts.duplicateRatio=0.1] - Fraction of matched words duplicated.
 * @returns {Array<{expression: string, targetType: number, targetQueue: number}>}
 */
export function computeDeckPlan(vocab, { overlapRatio = 0.6, duplicateRatio = 0.1 } = {}) {
  if (overlapRatio <= 0 || overlapRatio > 1) {
    throw new Error(`computeDeckPlan: overlapRatio must be in (0, 1], got ${overlapRatio}`);
  }

  const matchedCount = Math.round(vocab.length * overlapRatio);
  const matched = vocab.slice(0, matchedCount);
  const toEntry = (expression, i) => ({ expression, targetType: i % 3, targetQueue: i % 3 });

  const plan = matched.map(toEntry);

  const duplicateCount = Math.round(matchedCount * duplicateRatio);
  const duplicates = matched.slice(0, duplicateCount).map(toEntry);

  return [...plan, ...duplicates];
}

async function ankiRequest(action, params = {}) {
  const res = await fetch(ANKI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`AnkiConnect error for ${action}: ${json.error}`);
  return json.result;
}

/**
 * Seeds AnkiConnect with the notes described by `plan`. Thin I/O shell over
 * computeDeckPlan's output; `anki` is injectable for testing, defaulting to a
 * local fetch-based helper.
 *
 * @param {ReturnType<typeof computeDeckPlan>} plan
 * @param {object} [opts]
 * @param {(action: string, params?: object) => Promise<any>} [opts.anki]
 */
export async function seedAnkiPerfDeck(plan, { anki = ankiRequest } = {}) {
  await anki('createDeck', { deck: DECK_NAME });

  for (const { expression, targetType, targetQueue } of plan) {
    await anki('addNotes', {
      notes: [{
        deckName: DECK_NAME,
        modelName: MODEL_NAME,
        fields: { Expression: expression, vocabularyEnglish: '' },
        options: { allowDuplicate: true, duplicateScope: 'deck' },
      }],
    });
    const cardIds = await anki('findCards', {
      query: `deck:"${DECK_NAME}" Expression:"${expression}"`,
    });
    const cardId = cardIds[cardIds.length - 1];
    await anki('setSpecificValueOfCard', {
      card: cardId,
      keys: ['type', 'queue'],
      newValues: [targetType, targetQueue],
      warning_check: true,
    });
  }
}

async function main() {
  const vocab = wideVocabulary(wideVocabSize(SIZES.XL));
  const plan = computeDeckPlan(vocab);
  console.log(`Seeding ${plan.length} notes into ${DECK_NAME}...`);
  await seedAnkiPerfDeck(plan);
  console.log('Done.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
