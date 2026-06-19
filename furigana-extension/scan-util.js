import { resolveLemmaMode } from './lemma-util.js';

export const STATUS_CLASSES = ['anki-unlearned', 'anki-learning', 'anki-learned'];
export const ALL_CLASSES = [...STATUS_CLASSES, 'anki-duplicate', 'anki-hide-furigana'];

/** Returns true if `word` contains at least one Han, Hiragana, or Katakana character. */
export function isJapanese(word) {
  return /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(word);
}

/**
 * Extracts the visible Japanese text from a `<span>`, ignoring `<rt>` and `<rp>` ruby
 * annotation nodes so that furigana readings don't contaminate the lookup word.
 *
 * @param {HTMLSpanElement} span - A span that may contain plain text nodes and/or `<ruby>` elements.
 * @returns {string} The trimmed base text without furigana readings.
 */
export function extractWord(span) {
  let word = '';
  for (const node of span.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      word += node.textContent;
    } else if (node.nodeName === 'RUBY') {
      for (const ch of node.childNodes) {
        if (ch.nodeName !== 'RT' && ch.nodeName !== 'RP') {
          word += ch.textContent;
        }
      }
    }
  }
  return word.trim();
}

/**
 * Maps an Anki card `type` integer to its corresponding CSS status class name.
 * Type 0 = new/unlearned, type 2 = review/learned, all other values = learning.
 *
 * @param {number} type - Anki card type value from the `cardsInfo` API response.
 * @returns {'anki-unlearned'|'anki-learning'|'anki-learned'} CSS class name.
 */
export function cardTypeToStatus(type) {
  if (type === 0) return 'anki-unlearned';
  if (type === 2) return 'anki-learned';
  return 'anki-learning';
}

/**
 * Returns a boolean indicating whether furigana should be shown for a given
 * status and settings combination.
 *
 * @param {string} status - 'unlearned', 'learning', or 'learned'.
 * @param {object} settings - Extension settings with furigana* flags.
 * @returns {boolean}
 */
export function furiganaVisible(status, settings) {
  if (!settings.furiganaGlobal) return false;
  const perStatus = {
    unlearned: settings.furiganaUnlearned,
    learning: settings.furiganaLearning,
    learned: settings.furiganaLearned,
  };
  const flag = perStatus[status];
  return flag !== false;
}

/**
 * Maps an 'anki-<status>' CSS class to the plain status string.
 * Used for backward compatibility when callers still pass class names.
 */
function classToStatus(statusClass) {
  return statusClass.replace('anki-', '');
}

/**
 * Main scan routine accepting a WordRecord[] instead of DOM spans.
 * Queries AnkiConnect in two round trips (findCards → cardsInfo) and mutates
 * each record's `status` and `duplicate` fields in place.
 *
 * @param {Array} records - WordRecord[] from collectWords / collectFromSpans.
 * @param {object} settings - Extension settings.
 * @param {{ ankiRequest: Function, fetchLemmas: Function }} opts - Injected dependencies.
 * @returns {Promise<{found: number, matched: number, error?: string}>}
 */
export async function scanPage(records, settings, { ankiRequest, fetchLemmas } = {}) {
  if (!records || records.length === 0) {
    return { found: 0, matched: 0 };
  }

  // Build lookup word per record (prefer lemma over surface).
  const lookupWord = (rec) => rec.lemma || rec.surface;

  const uniqueLookupWords = [...new Set(records.map(lookupWord))];

  // Round trip 1: findCards for all unique lookup words
  const multiBody = {
    action: 'multi',
    version: 6,
    params: {
      actions: uniqueLookupWords.map((lw) => ({
        action: 'findCards',
        params: { query: `${settings.fieldName || 'Expression'}:"${lw}"` },
      })),
    },
  };

  let multiResponse;
  try {
    multiResponse = await ankiRequest(multiBody);
  } catch {
    return { found: records.length, matched: 0, error: 'connection' };
  }

  if (multiResponse.error || !Array.isArray(multiResponse.result)) {
    return { found: records.length, matched: 0, error: multiResponse.error || 'unknown' };
  }

  const wordToCardIds = {};
  uniqueLookupWords.forEach((lw, i) => {
    const raw = multiResponse.result[i];
    wordToCardIds[lw] = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.result) ? raw.result : []);
  });

  const allCardIds = [...new Set(Object.values(wordToCardIds).flat())];

  if (allCardIds.length === 0) {
    return { found: records.length, matched: 0 };
  }

  // Round trip 2: cardsInfo for all found card IDs
  let cardsResponse;
  try {
    cardsResponse = await ankiRequest({
      action: 'cardsInfo',
      version: 6,
      params: { cards: allCardIds },
    });
  } catch {
    return { found: records.length, matched: 0, error: 'connection' };
  }

  const cardIdToType = {};
  if (cardsResponse.result) {
    for (const card of cardsResponse.result) {
      cardIdToType[card.cardId] = card.type;
    }
  }

  let matched = 0;
  for (const record of records) {
    const cardIds = wordToCardIds[lookupWord(record)];
    if (!cardIds || cardIds.length === 0) continue;

    const statusClass = cardTypeToStatus(cardIdToType[cardIds[0]] ?? 0);
    record.status = classToStatus(statusClass);
    record.duplicate = cardIds.length > 1;
    matched++;
  }

  return { found: records.length, matched };
}
