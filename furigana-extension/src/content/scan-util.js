import { resolveLemmaMode } from '../shared/lemma-util.js';
import { injectFurigana } from './content.segmentation.js';

export const STATUS_CLASSES = ['anki-unlearned', 'anki-learning', 'anki-learned', 'anki-unknown'];
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
 * Adds or removes the `anki-hide-furigana` class on a span based on per-status furigana settings.
 * If `furiganaGlobal` is false, furigana is always hidden regardless of status.
 *
 * @param {HTMLSpanElement} span - The span whose furigana visibility to update.
 * @param {'anki-unlearned'|'anki-learning'|'anki-learned'} statusClass - The span's current Anki status.
 * @param {object} settings - Extension settings containing furigana visibility flags.
 */
export function applyFurigana(span, statusClass, settings) {
  if (!settings.furiganaGlobal) {
    span.classList.add('anki-hide-furigana');
    return;
  }
  const show = {
    'anki-unlearned': settings.furiganaUnlearned,
    'anki-learning': settings.furiganaLearning,
    'anki-learned': settings.furiganaLearned,
    'anki-unknown': settings.furiganaUnknown ?? true,
  }[statusClass] ?? true;
  span.classList.toggle('anki-hide-furigana', !show);
}

/**
 * Main scan routine: clears existing highlights, finds all Japanese `<span>` elements,
 * optionally resolves surface forms to lemmas, then queries AnkiConnect in two round trips
 * (findCards → cardsInfo) to classify each word and apply the appropriate status class.
 *
 * Round trip 1: `multi/findCards` — resolves each unique lookup word to a list of card IDs.
 * Round trip 2: `cardsInfo` — fetches the card type (new/learning/review) for all found cards.
 *
 * @param {object} settings - Extension settings (fieldName, useLemma, furigana flags, etc.).
 * @param {{ankiRequest: Function, fetchLemmas: Function, doc: Document}} opts - Injected dependencies.
 * @returns {Promise<{found: number, matched: number, error?: string}>} Scan result counts.
 */
export async function scanPage(settings, { ankiRequest, fetchLemmas, doc = (typeof document !== 'undefined' ? document : null) } = {}) {
  doc.querySelectorAll(STATUS_CLASSES.map((c) => '.' + c).join(','))
    .forEach((el) => el.classList.remove(...ALL_CLASSES));

  const allSpans = Array.from(doc.querySelectorAll('span'));
  const candidates = allSpans
    .map((span) => ({ span, word: extractWord(span) }))
    .filter(({ word }) => isJapanese(word));

  if (candidates.length === 0) {
    return { found: 0, matched: 0 };
  }

  // Build lemma map: surface → dictionary form.
  // Priority: lemma server (live, context-aware) > data-lemma attribute (pre-annotated HTML).
  const lemmaMap = {};
  for (const { span, word } of candidates) {
    if (span.dataset.lemma) lemmaMap[word] = span.dataset.lemma;
  }
  const mode = resolveLemmaMode(settings);
  if (mode !== 'off') {
    try {
      Object.assign(lemmaMap, await fetchLemmas(candidates, mode));
    } catch {
      // Backend unavailable; fall back to data-lemma / surface form.
    }
  }

  const lookupWord = (word) => lemmaMap[word] || word;
  const uniqueLookupWords = [...new Set(candidates.map(({ word }) => lookupWord(word)))];

  // Round trip 1: findCards for all unique lookup words
  const multiBody = {
    action: 'multi',
    version: 6,
    params: {
      actions: uniqueLookupWords.map((lw) => ({
        action: 'findCards',
        params: { query: `${settings.fieldName}:"${lw}"` },
      })),
    },
  };

  let multiResponse;
  try {
    multiResponse = await ankiRequest(multiBody);
  } catch {
    return { found: candidates.length, matched: 0, error: 'connection' };
  }

  if (multiResponse.error || !Array.isArray(multiResponse.result)) {
    return { found: candidates.length, matched: 0, error: multiResponse.error || 'unknown' };
  }

  const wordToCardIds = {};
  uniqueLookupWords.forEach((lw, i) => {
    const raw = multiResponse.result[i];
    wordToCardIds[lw] = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.result) ? raw.result : []);
  });

  const allCardIds = [...new Set(Object.values(wordToCardIds).flat())];

  const cardIdToType = {};
  if (allCardIds.length > 0) {
    // Round trip 2: cardsInfo for all found card IDs
    let cardsResponse;
    try {
      cardsResponse = await ankiRequest({
        action: 'cardsInfo',
        version: 6,
        params: { cards: allCardIds },
      });
    } catch {
      return { found: candidates.length, matched: 0, error: 'connection' };
    }

    if (cardsResponse.result) {
      for (const card of cardsResponse.result) {
        cardIdToType[card.cardId] = card.type;
      }
    }
  }

  let matched = 0;
  for (const { span, word } of candidates) {
    const cardIds = wordToCardIds[lookupWord(word)];
    if (!cardIds || cardIds.length === 0) {
      span.classList.add('anki-unknown');
      applyFurigana(span, 'anki-unknown', settings);
      continue;
    }

    const statusClass = cardTypeToStatus(cardIdToType[cardIds[0]] ?? 0);
    span.classList.add(statusClass);
    if (cardIds.length > 1) span.classList.add('anki-duplicate');
    applyFurigana(span, statusClass, settings);
    matched++;
  }

  for (const { span } of candidates) {
    injectFurigana(span);
  }

  return { found: candidates.length, matched };
}
