/**
 * Unit tests for content-script utilities.
 *
 * AC-3: isJapanese and extractWord are imported from ./scan-util.js (the inline
 * mirrors that used to live here have been removed). The existing T-22-009–T-22-018
 * test bodies and assertions preserve the same behaviour as the old T-001–T-014
 * inline-mirrored tests; only the import source changes.
 *
 * AC-1: cardTypeToStatus maps Anki card type integers to CSS class names.
 * AC-2: applyFurigana toggles anki-hide-furigana based on settings flags.
 * AC-4–AC-9: scanPage is tested via its new injection-seam signature.
 */

import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  isJapanese,
  extractWord,
  cardTypeToStatus,
  applyFurigana,
  scanPage,
  STATUS_CLASSES,
  ALL_CLASSES,
} from './scan-util.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a real DOM span from an HTML string using jsdom. */
function makeSpan(innerHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><body><span>${innerHTML}</span></body>`);
  return dom.window.document.querySelector('span');
}

/** Build a minimal JSDOM document with one or more span elements. */
function makeDoc(bodyHtml) {
  return new JSDOM(`<!DOCTYPE html><body>${bodyHtml}</body>`).window.document;
}

// ---------------------------------------------------------------------------
// cardTypeToStatus  (AC-1 — T-22-001, T-22-002, T-22-003, T-22-004)
// ---------------------------------------------------------------------------

describe('cardTypeToStatus', () => {
  it('T-22-001: maps type 0 to "anki-unlearned"', () => {
    // Type 0 is a new card that has never been seen; it must receive the
    // unlearned highlight so the user can identify vocabulary they have not
    // started learning yet.
    expect(cardTypeToStatus(0)).toBe('anki-unlearned');
  });

  it('T-22-002: maps type 2 to "anki-learned"', () => {
    // Type 2 is a review card that has graduated from the learning queue;
    // it must receive the learned highlight to distinguish it from newer cards.
    expect(cardTypeToStatus(2)).toBe('anki-learned');
  });

  it('T-22-003: maps type 1 to "anki-learning"', () => {
    // Type 1 is a card currently in the learning queue; the learning class
    // must be applied so the user can see which words are in progress.
    expect(cardTypeToStatus(1)).toBe('anki-learning');
  });

  it('T-22-004: maps an unrecognised type integer to "anki-learning"', () => {
    // Future Anki versions may introduce additional type values; any unknown
    // value must degrade gracefully to "anki-learning" rather than throwing.
    expect(cardTypeToStatus(99)).toBe('anki-learning');
  });
});

// ---------------------------------------------------------------------------
// applyFurigana  (AC-2 — T-22-005, T-22-006, T-22-007, T-22-008)
// ---------------------------------------------------------------------------

describe('applyFurigana', () => {
  it('T-22-005: adds anki-hide-furigana when furiganaGlobal is false, regardless of status', () => {
    // When the user disables furigana globally, every span must be hidden
    // irrespective of its learning status.
    const span = makeSpan('<ruby>日本<rt>にほん</rt></ruby>');
    applyFurigana(span, 'anki-unlearned', {
      furiganaGlobal: false,
      furiganaUnlearned: true,
      furiganaLearning: true,
      furiganaLearned: true,
    });
    expect(span.classList.contains('anki-hide-furigana')).toBe(true);
  });

  it('T-22-006: adds anki-hide-furigana when furiganaGlobal is true but the per-status flag is false for the matching status', () => {
    // The per-status override must be respected: a user who wants furigana
    // globally but not on learned cards must see furigana hidden for learned spans.
    const span = makeSpan('<ruby>食<rt>た</rt></ruby>べる');
    applyFurigana(span, 'anki-learned', {
      furiganaGlobal: true,
      furiganaUnlearned: true,
      furiganaLearning: true,
      furiganaLearned: false,
    });
    expect(span.classList.contains('anki-hide-furigana')).toBe(true);
  });

  it('T-22-007: does not add anki-hide-furigana when furiganaGlobal is true and the per-status flag is true for the matching status', () => {
    // When both the global flag and the per-status flag permit furigana,
    // the hide class must be absent so the reading annotation is visible.
    const span = makeSpan('<ruby>日本<rt>にほん</rt></ruby>');
    applyFurigana(span, 'anki-unlearned', {
      furiganaGlobal: true,
      furiganaUnlearned: true,
      furiganaLearning: true,
      furiganaLearned: false,
    });
    expect(span.classList.contains('anki-hide-furigana')).toBe(false);
  });

  it('T-22-008: adds anki-hide-furigana when furiganaLearning is false for an anki-learning span', () => {
    // The furiganaLearning flag must be consulted when the span status is
    // learning; the hide class must appear when the flag is false.
    const span = makeSpan('アニメ');
    applyFurigana(span, 'anki-learning', {
      furiganaGlobal: true,
      furiganaUnlearned: true,
      furiganaLearning: false,
      furiganaLearned: true,
    });
    expect(span.classList.contains('anki-hide-furigana')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isJapanese  (legacy T-001–T-010; now imported from scan-util.js per issue #22 AC-3)
// ---------------------------------------------------------------------------

describe('isJapanese', () => {
  it('returns true for a hiragana-only word', () => {
    // Kana-only words like "けが" (injury) have no kanji; the old ruby-based
    // filter would silently drop them — isJapanese must catch them instead.
    expect(isJapanese('けが')).toBe(true);
  });

  it('returns true for a katakana-only word', () => {
    // Loanwords written in katakana (e.g. "アニメ") must be highlighted.
    expect(isJapanese('アニメ')).toBe(true);
  });

  it('returns true for a kanji-only word', () => {
    // Basic kanji detection — the Han script property must match.
    expect(isJapanese('日本語')).toBe(true);
  });

  it('returns true for a mixed kana and kanji word', () => {
    // Real vocabulary entries commonly mix kanji and kana (e.g. verb stems).
    expect(isJapanese('食べる')).toBe(true);
  });

  it('returns false for an empty string', () => {
    // An empty word cannot be Japanese; returning true would cause spurious
    // Anki lookups for every blank span on the page.
    expect(isJapanese('')).toBe(false);
  });

  it('returns false for an ASCII-only word', () => {
    // ASCII words appear on mixed-language pages; they must not trigger
    // Japanese card lookups.
    expect(isJapanese('hello')).toBe(false);
  });

  it('returns false for ASCII punctuation only', () => {
    // Spans that contain only punctuation characters must not be candidates.
    expect(isJapanese('...')).toBe(false);
  });

  it('returns false for whitespace-only input', () => {
    // Whitespace-only content should never be looked up in Anki.
    expect(isJapanese('   ')).toBe(false);
  });

  it('returns false for CJK punctuation only (。)', () => {
    // Unicode Script=Han does NOT include CJK punctuation; the property-escape
    // regex /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u must
    // therefore correctly exclude it without extra logic.
    expect(isJapanese('。')).toBe(false);
  });

  it('returns false for CJK bracket punctuation only (「」)', () => {
    // Same rationale as the 。 case — bracket punctuation is not in any
    // Japanese script property.
    expect(isJapanese('「」')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractWord  (legacy T-011–T-014; now imported from scan-util.js per issue #22 AC-3)
// ---------------------------------------------------------------------------

describe('extractWord', () => {
  it('returns the text content of a plain-text span', () => {
    // The simplest candidate: a kana-only span with no ruby markup at all.
    // This is the core case enabled by the Issue #1 fix.
    const span = makeSpan('けが');
    expect(extractWord(span)).toBe('けが');
  });

  it('returns only the base text from a span containing a ruby element, excluding rt content', () => {
    // Ruby spans annotate kanji with readings; extractWord must strip the
    // furigana (rt) so the Anki query uses the kanji form, not the reading.
    const span = makeSpan('<ruby>日本<rt>にほん</rt></ruby>語');
    expect(extractWord(span)).toBe('日本語');
  });

  it('returns empty string for a span whose only text is inside rt nodes', () => {
    // A span with no base text (only rt content) should produce no candidate
    // word, preventing a meaningless Anki query.
    const span = makeSpan('<ruby><rt>にほん</rt></ruby>');
    expect(extractWord(span)).toBe('');
  });

  it('returns empty string for a whitespace-only span', () => {
    // Spans that contain only whitespace after trimming must not be treated
    // as Japanese word candidates.
    const span = makeSpan('   ');
    expect(extractWord(span)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// scanPage  (AC-4–AC-9 — T-22-027 through T-22-033)
// ---------------------------------------------------------------------------

describe('scanPage', () => {
  const baseSettings = {
    fieldName: 'Expression',
    furiganaGlobal: true,
    furiganaUnlearned: true,
    furiganaLearning: true,
    furiganaLearned: false,
    lemmaMode: 'off',
    useLemma: false,
  };

  it('T-22-027: returns { found: 0, matched: 0 } and never calls ankiRequest when there are no Japanese spans (AC-4)', async () => {
    // A page with no Japanese content must short-circuit before making any
    // network request; the counts must both be zero.
    const doc = makeDoc('<span>hello</span><span>world</span>');
    const ankiRequest = vi.fn();
    const fetchLemmas = vi.fn().mockResolvedValue({});

    const result = await scanPage(baseSettings, { ankiRequest, fetchLemmas, doc });

    expect(result).toEqual({ found: 0, matched: 0 });
    expect(ankiRequest).not.toHaveBeenCalled();
  });

  it('T-22-028: clears pre-existing status classes from spans before re-scanning (AC-5)', async () => {
    // A second scan must start from a clean slate; stale classes from the
    // previous scan must be removed so reclassified words display correctly.
    const doc = makeDoc('<span class="anki-learned">日本語</span>');
    const span = doc.querySelector('span');
    // ankiRequest returns an empty multi result so no new class is applied
    const ankiRequest = vi.fn().mockResolvedValue({ result: [[]], error: null });
    const fetchLemmas = vi.fn().mockResolvedValue({});

    await scanPage(baseSettings, { ankiRequest, fetchLemmas, doc });

    expect(span.classList.contains('anki-learned')).toBe(false);
  });

  it('T-22-029: sends a multi/findCards request whose actions list contains one entry per unique lookup word (AC-6)', async () => {
    // The first AnkiConnect round-trip must bundle all unique words into a
    // single multi request to minimise HTTP overhead.
    const doc = makeDoc('<span>日本語</span><span>勉強</span>');
    const ankiRequest = vi.fn().mockResolvedValue({ result: [[], []], error: null });
    const fetchLemmas = vi.fn().mockResolvedValue({});

    await scanPage(baseSettings, { ankiRequest, fetchLemmas, doc });

    expect(ankiRequest).toHaveBeenCalled();
    const [firstCallBody] = ankiRequest.mock.calls[0];
    expect(firstCallBody.action).toBe('multi');
    expect(firstCallBody.params.actions).toHaveLength(2);
    expect(firstCallBody.params.actions[0].action).toBe('findCards');
    expect(firstCallBody.params.actions[1].action).toBe('findCards');
  });

  it('T-22-030: applies the correct status class from cardsInfo and increments matched (AC-7)', async () => {
    // A span whose findCards result contains a card id must receive the CSS
    // class that corresponds to the card type returned by cardsInfo.
    const doc = makeDoc('<span>日本語</span>');
    const span = doc.querySelector('span');

    // Round trip 1: findCards returns card id 42 for 日本語
    // Round trip 2: cardsInfo returns type 2 (learned) for card 42
    const ankiRequest = vi.fn()
      .mockResolvedValueOnce({ result: [[42]], error: null })
      .mockResolvedValueOnce({ result: [{ cardId: 42, type: 2 }], error: null });
    const fetchLemmas = vi.fn().mockResolvedValue({});

    const result = await scanPage(baseSettings, { ankiRequest, fetchLemmas, doc });

    expect(span.classList.contains('anki-learned')).toBe(true);
    expect(result.matched).toBe(1);
    expect(result.found).toBe(1);
  });

  it('T-22-031: resolves with error:"connection" and matched:0 when ankiRequest throws (AC-8)', async () => {
    // A network failure (e.g. Anki not running) must not crash the extension;
    // scanPage must resolve with an error field so the popup can display a
    // helpful message rather than showing a rejected promise.
    const doc = makeDoc('<span>日本語</span>');
    const ankiRequest = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const fetchLemmas = vi.fn().mockResolvedValue({});

    const result = await scanPage(baseSettings, { ankiRequest, fetchLemmas, doc });

    expect(result.error).toBe('connection');
    expect(result.matched).toBe(0);
    expect(result.found).toBeGreaterThanOrEqual(1);
  });

  it('T-22-032: adds anki-duplicate when findCards returns more than one card id for a word (AC-9)', async () => {
    // When multiple cards share the same expression field, the span must
    // receive both a status class and anki-duplicate so the user can
    // investigate the ambiguity.
    const doc = makeDoc('<span>日本語</span>');
    const span = doc.querySelector('span');

    // findCards returns two card ids → duplicate
    const ankiRequest = vi.fn()
      .mockResolvedValueOnce({ result: [[10, 11]], error: null })
      .mockResolvedValueOnce({ result: [{ cardId: 10, type: 0 }, { cardId: 11, type: 0 }], error: null });
    const fetchLemmas = vi.fn().mockResolvedValue({});

    await scanPage(baseSettings, { ankiRequest, fetchLemmas, doc });

    expect(span.classList.contains('anki-duplicate')).toBe(true);
    // Must also have a status class (the type of the first card id)
    const hasStatus = STATUS_CLASSES.some((c) => span.classList.contains(c));
    expect(hasStatus).toBe(true);
  });

  it('T-22-033: returns { found: N, matched: 0 } and does not call cardsInfo when all findCards results are empty (edge case)', async () => {
    // If no card ids are found for any word, matched must be 0 and found must
    // reflect the number of Japanese spans; a second ankiRequest call for
    // cardsInfo would be a wasted round-trip.
    const doc = makeDoc('<span>日本語</span><span>勉強</span>');
    const ankiRequest = vi.fn()
      .mockResolvedValueOnce({ result: [[], []], error: null });
    const fetchLemmas = vi.fn().mockResolvedValue({});

    const result = await scanPage(baseSettings, { ankiRequest, fetchLemmas, doc });

    expect(result.found).toBe(2);
    expect(result.matched).toBe(0);
    // cardsInfo must NOT be called when there are no card ids to look up
    expect(ankiRequest).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Constants re-exported from scan-util.js  (T-22-034, T-22-035)
// ---------------------------------------------------------------------------

describe('exported constants', () => {
  it('T-22-034: STATUS_CLASSES contains exactly the three expected values', () => {
    // Other modules rely on this exact list to iterate over status selectors;
    // any change here would silently break scan/reset logic.
    expect(STATUS_CLASSES).toEqual(['anki-unlearned', 'anki-learning', 'anki-learned']);
  });

  it('T-22-035: ALL_CLASSES extends STATUS_CLASSES with anki-duplicate and anki-hide-furigana', () => {
    // The full class list is used for cleanup before rescanning; omitting any
    // class would leave stale markers on spans.
    expect(ALL_CLASSES).toContain('anki-duplicate');
    expect(ALL_CLASSES).toContain('anki-hide-furigana');
    for (const c of STATUS_CLASSES) {
      expect(ALL_CLASSES).toContain(c);
    }
  });
});
