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
 *
 * Issue #31 (T-31-018–T-31-021): scanPage furigana injection pass — verifies
 * that <ruby>/<rt> markup is synthesised for spans carrying dataset.reading.
 *
 * Issue #33: T-22-034 updated — STATUS_CLASSES now includes 'anki-unknown'.
 *            T-22-033 updated — zero-card result now applies 'anki-unknown'.
 *            New: T-33-001 through T-33-014 cover AC-1 through AC-9 for unknown.
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
// applyFurigana — issue #33 anki-unknown status  (T-33-001 through T-33-004)
// ---------------------------------------------------------------------------

describe('applyFurigana — anki-unknown status (issue #33)', () => {
  it('T-33-001: hides furigana on anki-unknown span when furiganaGlobal is false', () => {
    // The global toggle must override all per-status flags including the new
    // unknown category; when global is off every span must be hidden.
    const span = makeSpan('<ruby>彼女<rt>かのじょ</rt></ruby>');
    applyFurigana(span, 'anki-unknown', {
      furiganaGlobal: false,
      furiganaUnlearned: true,
      furiganaLearning: true,
      furiganaLearned: true,
      furiganaUnknown: true,
    });
    expect(span.classList.contains('anki-hide-furigana')).toBe(true);
  });

  it('T-33-002: shows furigana on anki-unknown span when furiganaGlobal is true and furiganaUnknown is true', () => {
    // When both the global toggle and the per-status furiganaUnknown flag are
    // enabled, the hide class must be absent so unknown-status readings are visible.
    const span = makeSpan('<ruby>彼女<rt>かのじょ</rt></ruby>');
    applyFurigana(span, 'anki-unknown', {
      furiganaGlobal: true,
      furiganaUnlearned: true,
      furiganaLearning: true,
      furiganaLearned: true,
      furiganaUnknown: true,
    });
    expect(span.classList.contains('anki-hide-furigana')).toBe(false);
  });

  it('T-33-003: hides furigana on anki-unknown span when furiganaUnknown is false', () => {
    // The per-status furiganaUnknown flag must be respected when explicitly
    // set to false, even when the global toggle is on.
    const span = makeSpan('<ruby>日記<rt>にっき</rt></ruby>');
    applyFurigana(span, 'anki-unknown', {
      furiganaGlobal: true,
      furiganaUnlearned: true,
      furiganaLearning: true,
      furiganaLearned: true,
      furiganaUnknown: false,
    });
    expect(span.classList.contains('anki-hide-furigana')).toBe(true);
  });

  it('T-33-004: shows furigana on anki-unknown span when furiganaUnknown is undefined (nullish fallback defaults to true)', () => {
    // When furiganaUnknown is absent from settings, the ?? true fallback must
    // apply so unknown words show furigana by default on first install.
    const span = makeSpan('<ruby>語<rt>ご</rt></ruby>');
    applyFurigana(span, 'anki-unknown', {
      furiganaGlobal: true,
      furiganaUnlearned: true,
      furiganaLearning: true,
      furiganaLearned: false,
      // furiganaUnknown intentionally absent
    });
    expect(span.classList.contains('anki-hide-furigana')).toBe(false);
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
    furiganaUnknown: true,
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

  it('T-22-033: all spans get anki-unknown, matched===0, found===span-count when all findCards results are empty (issue #33 AC-3)', async () => {
    // When no card ids are found for any word, every Japanese span must receive
    // anki-unknown so the user can see which words are not in their Anki deck.
    // matched must be 0 (no Anki match) and found must reflect the candidate count.
    // cardsInfo must not be called since there are no card ids to fetch.
    const doc = makeDoc('<span>日本語</span><span>勉強</span>');
    const span1 = doc.querySelectorAll('span')[0];
    const span2 = doc.querySelectorAll('span')[1];
    const ankiRequest = vi.fn()
      .mockResolvedValueOnce({ result: [[], []], error: null });
    const fetchLemmas = vi.fn().mockResolvedValue({});

    const result = await scanPage(baseSettings, { ankiRequest, fetchLemmas, doc });

    expect(result.found).toBe(2);
    expect(result.matched).toBe(0);
    // Both unmatched spans must receive anki-unknown
    expect(span1.classList.contains('anki-unknown')).toBe(true);
    expect(span2.classList.contains('anki-unknown')).toBe(true);
    // cardsInfo must NOT be called when there are no card ids to look up
    expect(ankiRequest).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// scanPage — issue #33 additional unknown-class tests  (T-33-005 through T-33-010)
// ---------------------------------------------------------------------------

describe('scanPage — anki-unknown classification (issue #33)', () => {
  const baseSettings = {
    fieldName: 'Expression',
    furiganaGlobal: true,
    furiganaUnlearned: true,
    furiganaLearning: true,
    furiganaLearned: false,
    furiganaUnknown: true,
    lemmaMode: 'off',
    useLemma: false,
  };

  it('T-33-005: one matched span (anki-learned) and one unmatched span → unmatched gets anki-unknown (issue #33 AC-4)', async () => {
    // A mixed result — one word found in Anki, one not — must assign anki-unknown
    // only to the unmatched span; the matched span must keep its real status.
    const doc = makeDoc('<span>日本語</span><span>謎</span>');
    const span1 = doc.querySelectorAll('span')[0];
    const span2 = doc.querySelectorAll('span')[1];

    // findCards: 日本語 → card 42; 謎 → no cards
    const ankiRequest = vi.fn()
      .mockResolvedValueOnce({ result: [[42], []], error: null })
      .mockResolvedValueOnce({ result: [{ cardId: 42, type: 2 }], error: null });
    const fetchLemmas = vi.fn().mockResolvedValue({});

    const result = await scanPage(baseSettings, { ankiRequest, fetchLemmas, doc });

    expect(span1.classList.contains('anki-learned')).toBe(true);
    expect(span1.classList.contains('anki-unknown')).toBe(false);
    expect(span2.classList.contains('anki-unknown')).toBe(true);
    expect(result.matched).toBe(1);
    expect(result.found).toBe(2);
  });

  it('T-33-006: re-run removes stale anki-unknown before reapplying (issue #33 AC-5)', async () => {
    // A second scan on a span previously classified as anki-unknown must clear
    // the stale class before reclassifying, preventing class accumulation.
    const doc = makeDoc('<span class="anki-unknown">彼女</span>');
    const span = doc.querySelector('span');

    // Second scan: this word is now found in Anki as learned
    const ankiRequest = vi.fn()
      .mockResolvedValueOnce({ result: [[99]], error: null })
      .mockResolvedValueOnce({ result: [{ cardId: 99, type: 2 }], error: null });
    const fetchLemmas = vi.fn().mockResolvedValue({});

    await scanPage(baseSettings, { ankiRequest, fetchLemmas, doc });

    // anki-unknown must be gone; anki-learned must be present
    expect(span.classList.contains('anki-unknown')).toBe(false);
    expect(span.classList.contains('anki-learned')).toBe(true);
  });

  it('T-33-007: scanPage re-run of a previously-matched word that now matches zero cards applies anki-unknown (issue #33 AC-5 edge)', async () => {
    // If a word was previously learned but the card was deleted from Anki, the
    // second scan must classify it as anki-unknown, not leave the stale class.
    const doc = makeDoc('<span class="anki-learned">消えた</span>');
    const span = doc.querySelector('span');

    // Second scan: word no longer found in Anki
    const ankiRequest = vi.fn()
      .mockResolvedValueOnce({ result: [[]], error: null });
    const fetchLemmas = vi.fn().mockResolvedValue({});

    await scanPage(baseSettings, { ankiRequest, fetchLemmas, doc });

    expect(span.classList.contains('anki-learned')).toBe(false);
    expect(span.classList.contains('anki-unknown')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Constants re-exported from scan-util.js  (T-22-034, T-22-035)
// ---------------------------------------------------------------------------

describe('exported constants', () => {
  it('T-22-034: STATUS_CLASSES is exactly [anki-unlearned, anki-learning, anki-learned, anki-unknown] (issue #33 updated)', () => {
    // Issue #33 adds anki-unknown as the fourth status class; this exact array
    // is used by other modules to iterate over status selectors for reset logic.
    // CHANGED from issue #22: expected value now includes 'anki-unknown'.
    expect(STATUS_CLASSES).toEqual(['anki-unlearned', 'anki-learning', 'anki-learned', 'anki-unknown']);
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

  it('T-33-008: ALL_CLASSES contains anki-unknown (issue #33 AC-2)', () => {
    // ALL_CLASSES is the complete list used for cleanup; it must include
    // anki-unknown so stale unknown markers are removed before rescanning.
    expect(ALL_CLASSES).toContain('anki-unknown');
  });
});

// ===========================================================================
// Issue #31: scanPage furigana injection pass (T-31-018 – T-31-021)
//
// These tests verify that scanPage calls injectFurigana on spans that carry
// dataset.reading, regardless of whether the span matched an Anki card.
// The ruby/rt structure must be present after scanPage completes.
// ===========================================================================

describe('scanPage — issue #31 AC-15/16: furigana injection for spans with dataset.reading', () => {
  const baseSettings = {
    fieldName: 'Expression',
    furiganaGlobal: true,
    furiganaUnlearned: true,
    furiganaLearning: true,
    furiganaLearned: true,
    lemmaMode: 'off',
    useLemma: false,
  };

  it('T-31-018: test_unmatched_span_with_dataset_reading_gets_ruby_injected', async () => {
    // Furigana must be synthesised for spans that kuromoji annotated with a
    // reading even when Anki has no matching card; this is the primary use-case
    // of #31 — plain kanji on pages without pre-existing <ruby> markup.
    const doc = makeDoc('<span>食べる</span>');
    const span = doc.querySelector('span');
    span.dataset.reading = 'タベル';

    // No Anki card found for this word
    const ankiRequest = vi.fn().mockResolvedValue({ result: [[]], error: null });
    const fetchLemmas = vi.fn().mockResolvedValue({});

    await scanPage(baseSettings, { ankiRequest, fetchLemmas, doc });

    expect(span.querySelector('ruby')).not.toBeNull();
    const rt = span.querySelector('rt');
    expect(rt).not.toBeNull();
    expect(rt.textContent.length).toBeGreaterThan(0);
  });

  it('T-31-019: test_matched_span_with_dataset_reading_gets_ruby_injected', async () => {
    // A span that both has a kuromoji reading AND matches an Anki card must
    // also receive injected furigana; injection must not be gated on match status.
    const doc = makeDoc('<span>食べる</span>');
    const span = doc.querySelector('span');
    span.dataset.reading = 'タベル';

    // Anki card found → span will be classified as anki-unlearned
    const ankiRequest = vi.fn()
      .mockResolvedValueOnce({ result: [[42]], error: null })
      .mockResolvedValueOnce({ result: [{ cardId: 42, type: 0 }], error: null });
    const fetchLemmas = vi.fn().mockResolvedValue({});

    await scanPage(baseSettings, { ankiRequest, fetchLemmas, doc });

    expect(span.classList.contains('anki-unlearned')).toBe(true);
    expect(span.querySelector('ruby')).not.toBeNull();
    const rt = span.querySelector('rt');
    expect(rt).not.toBeNull();
    expect(rt.textContent.length).toBeGreaterThan(0);
  });
});

describe('scanPage — issue #31 AC-17: furigana visibility gating unchanged after injection', () => {
  it('T-31-020: test_anki_unlearned_span_with_furigana_hidden_gets_hide_class', async () => {
    // The per-status furigana toggle must still apply after ruby is injected;
    // anki-hide-furigana must appear on the span AND synthesised <ruby> must be
    // present — verifying both that injection ran and that gating still works.
    const settings = {
      fieldName: 'Expression',
      furiganaGlobal: true,
      furiganaUnlearned: false,  // hide furigana for unlearned words
      furiganaLearning: true,
      furiganaLearned: true,
      lemmaMode: 'off',
      useLemma: false,
    };

    const doc = makeDoc('<span>食べる</span>');
    const span = doc.querySelector('span');
    span.dataset.reading = 'タベル';

    const ankiRequest = vi.fn()
      .mockResolvedValueOnce({ result: [[7]], error: null })
      .mockResolvedValueOnce({ result: [{ cardId: 7, type: 0 }], error: null });
    const fetchLemmas = vi.fn().mockResolvedValue({});

    await scanPage(settings, { ankiRequest, fetchLemmas, doc });

    // Injection must have happened (ruby is present) AND the hide class must be set.
    // Both assertions fail until injectFurigana is wired into scanPage.
    expect(span.querySelector('ruby')).not.toBeNull();
    expect(span.classList.contains('anki-unlearned')).toBe(true);
    expect(span.classList.contains('anki-hide-furigana')).toBe(true);
  });
});

describe('scanPage — issue #31 AC-18: pre-existing ruby in original HTML is not modified', () => {
  it('T-31-021: test_span_with_preexisting_ruby_not_modified_by_scanpage', async () => {
    // A span carrying BOTH a dataset.reading AND an existing <ruby> child
    // must not receive a second injected <ruby>; injectFurigana's guard must
    // detect the pre-existing <ruby> and bail out, leaving exactly one <rt>.
    // dataset.reading is set so that a naive implementation without the guard
    // would proceed to inject, producing a second <rt>.
    const doc = makeDoc('<span><ruby>日本<rt>にほん</rt></ruby>語</span>');
    const span = doc.querySelector('span');
    // Give it a reading so an implementation without the "already has ruby" guard
    // would fire injectFurigana and produce a second <rt>.
    span.dataset.reading = 'ニホンゴ';
    const originalHTML = span.innerHTML;

    const ankiRequest = vi.fn().mockResolvedValue({ result: [[]], error: null });
    const fetchLemmas = vi.fn().mockResolvedValue({});

    await scanPage(
      {
        fieldName: 'Expression',
        furiganaGlobal: true,
        furiganaUnlearned: true,
        furiganaLearning: true,
        furiganaLearned: true,
        lemmaMode: 'off',
        useLemma: false,
      },
      { ankiRequest, fetchLemmas, doc },
    );

    // Exactly one <rt> must exist — the original author-provided one.
    // If injectFurigana fired without the guard, a second <rt> would appear.
    expect(span.querySelectorAll('rt').length).toBe(1);
    expect(span.innerHTML).toBe(originalHTML);
  });
});
