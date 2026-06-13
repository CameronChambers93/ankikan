/**
 * Creates/restores the "AnkiKan-E2E" test deck in Anki.
 *
 * Run once before executing ankican.e2e.js:
 *   node e2e/setup-anki-e2e.js
 *
 * Requires Anki to be running with AnkiConnect on localhost:8765.
 * Idempotent — safe to run multiple times; re-uses existing cards.
 *
 * Deck contents:
 *   けが    → type 0 (new/unlearned)   → expects anki-unlearned class
 *   アニメ  → type 1 (learning)        → expects anki-learning class
 *   日本語  → type 2 (review/learned)  → expects anki-learned class
 */

const ANKI_URL = 'http://127.0.0.1:8765';
const DECK_NAME = 'AnkiKan-E2E';
const MODEL_NAME = 'Japanese';

const CARDS = [
  { expression: 'けが',   meaning: 'injury',           targetType: 0, targetQueue: 0 },
  { expression: 'アニメ', meaning: 'anime',             targetType: 1, targetQueue: 1 },
  { expression: '日本語', meaning: 'Japanese language', targetType: 2, targetQueue: 2 },
];

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

async function main() {
  console.log('Creating deck:', DECK_NAME);
  await anki('createDeck', { deck: DECK_NAME });

  for (const card of CARDS) {
    // Find existing card in the test deck
    let [cardId] = await anki('findCards', {
      query: `deck:"${DECK_NAME}" Expression:"${card.expression}"`,
    });

    if (cardId == null) {
      // Add note if not already present
      const [noteId] = await anki('addNotes', {
        notes: [{
          deckName: DECK_NAME,
          modelName: MODEL_NAME,
          fields: { Expression: card.expression, vocabularyEnglish: card.meaning },
          options: { allowDuplicate: false, duplicateScope: 'deck' },
        }],
      });
      [cardId] = await anki('findCards', {
        query: `deck:"${DECK_NAME}" Expression:"${card.expression}"`,
      });
      console.log(`  Added note for ${card.expression} (noteId=${noteId}, cardId=${cardId})`);
    } else {
      console.log(`  Found existing card for ${card.expression} (cardId=${cardId})`);
    }

    // Set card state
    await anki('setSpecificValueOfCard', {
      card: cardId,
      keys: ['type', 'queue'],
      newValues: [card.targetType, card.targetQueue],
      warning_check: true,
    });
    if (card.targetType === 2) {
      await anki('setSpecificValueOfCard', {
        card: cardId,
        keys: ['interval', 'factor'],
        newValues: [10, 2500],
        warning_check: true,
      });
    }
    console.log(`  Set ${card.expression} to type=${card.targetType}`);
  }

  console.log('Done. AnkiKan-E2E deck is ready.');
}

main().catch((err) => { console.error(err.message); process.exit(1); });
