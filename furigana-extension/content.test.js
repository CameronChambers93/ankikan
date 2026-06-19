/**
 * Unit tests for content-script utilities.
 *
 * AC-3: isJapanese and extractWord are imported from ./scan-util.js (the inline
 * mirrors that used to live here have been removed). The existing T-22-009–T-22-018
 * test bodies and assertions preserve the same behaviour as the old T-001–T-014
 * inline-mirrored tests; only the import source changes.
 *
 * AC-1: cardTypeToStatus maps Anki card type integers to CSS class names.
 *
 * Issue #26 changes:
 * - T-22-005–T-22-008: rewritten from applyFurigana(span, statusClass, settings)
 *   to furiganaVisible(status, settings) returning a boolean. The logical contract
 *   is identical; only the interface changed (no DOM manipulation, pure boolean).
 * - T-22-027–T-22-033: scanPage now accepts (records, settings, { ankiRequest,
 *   fetchLemmas }) where records is WordRecord[]. Tests build real JSDOM text
 *   nodes + Range objects and assert mutated record.status / record.duplicate
 *   instead of span class lists. scanPage no longer accepts a `doc` parameter
 *   for querying spans.
 * - furiganaVisible AC-10–AC-11 tests added as T-26-056–T-26-061.
 */

import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  isJapanese,
  extractWord,
  cardTypeToStatus,
  furiganaVisible,
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

/**
 * Build a WordRecord with a real JSDOM Range over a text node containing the
 * given Japanese surface string.  The Range is live in the document.
 */
function makeRecord(surface, overrides = {}) {
  const dom = new JSDOM(`<!DOCTYPE html><body><p>${surface}</p></body>`);
  const doc = dom.window.document;
  const textNode = doc.querySelector('p').firstChild;
  const range = doc.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, surface.length);
  return {
    range,
    surface,
    lemma: null,
    reading: null,
    status: null,
    duplicate: false,
    ...overrides,
  };
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
// furiganaVisible  (was applyFurigana — T-22-005–T-22-008, rewritten for #26)
//
// Old interface: applyFurigana(span, statusClass, settings) → void (DOM side-effect)
// New interface: furiganaVisible(status, settings) → boolean (pure function)
// The logical contract is the same — the old tests verified when the hide class
// was added; these verify the same conditions produce false instead.
// ---------------------------------------------------------------------------

describe('furiganaVisible', () => {
  it('T-22-005: returns false when furiganaGlobal is false, regardless of status', () => {
    // When the user disables furigana globally, every word must be suppressed
    // irrespective of its learning status — same contract as the old applyFurigana
    // adding anki-hide-furigana unconditionally when furiganaGlobal is false.
    expect(furiganaVisible('unlearned', {
      furiganaGlobal: false,
      furiganaUnlearned: true,
      furiganaLearning: true,
      furiganaLearned: true,
    })).toBe(false);
  });

  it('T-22-006: returns false when furiganaGlobal is true but the per-status flag is false for the matching status', () => {
    // The per-status override must be respected: a user who wants furigana
    // globally but not on learned words must get false for status "learned".
    // Mirrors old test: applyFurigana added anki-hide-furigana for anki-learned
    // when furiganaLearned was false.
    expect(furiganaVisible('learned', {
      furiganaGlobal: true,
      furiganaUnlearned: true,
      furiganaLearning: true,
      furiganaLearned: false,
    })).toBe(false);
  });

  it('T-22-007: returns true when furiganaGlobal is true and the per-status flag is true for the matching status', () => {
    // When both the global flag and the per-status flag permit furigana, the
    // function must return true so the reading annotation is visible.
    // Mirrors old test: anki-hide-furigana was absent when both flags were true.
    expect(furiganaVisible('unlearned', {
      furiganaGlobal: true,
      furiganaUnlearned: true,
      furiganaLearning: true,
      furiganaLearned: false,
    })).toBe(true);
  });

  it('T-22-008: returns false when furiganaLearning is false for status "learning"', () => {
    // The furiganaLearning flag must be consulted when status is "learning";
    // false must produce false here.
    // Mirrors old test: applyFurigana added anki-hide-furigana for anki-learning
    // when furiganaLearning was false.
    expect(furiganaVisible('learning', {
      furiganaGlobal: true,
      furiganaUnlearned: true,
      furiganaLearning: false,
      furiganaLearned: true,
    })).toBe(false);
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
// scanPage with WordRecord[]  (AC-8–AC-9 — T-22-027 through T-22-033, rewritten #26)
//
// Old interface: scanPage(settings, { ankiRequest, fetchLemmas, doc })
//   — queried DOM for <span> elements, applied CSS classes to spans.
// New interface: scanPage(records, settings, { ankiRequest, fetchLemmas })
//   — accepts WordRecord[], mutates record.status and record.duplicate,
//     does not touch the DOM directly.
// ---------------------------------------------------------------------------

describe('scanPage (WordRecord interface)', () => {
  const baseSettings = {
    fieldName: 'Expression',
    furiganaGlobal: true,
    furiganaUnlearned: true,
    furiganaLearning: true,
    furiganaLearned: false,
    lemmaMode: 'off',
    useLemma: false,
  };

  it('T-22-027: returns { found: 0, matched: 0 } and never calls ankiRequest when records is empty (AC-4)', async () => {
    // An empty records array means no Japanese content was collected; the
    // function must short-circuit with zero counts and no network call.
    const ankiRequest = vi.fn();
    const fetchLemmas = vi.fn().mockResolvedValue({});

    const result = await scanPage([], baseSettings, { ankiRequest, fetchLemmas });

    expect(result).toEqual({ found: 0, matched: 0 });
    expect(ankiRequest).not.toHaveBeenCalled();
  });

  it('T-22-028: record.status remains null after scan when findCards returns empty (AC-5)', async () => {
    // When no Anki cards are found for any record, status must remain null so
    // the overlay does not colour words that have not been looked up.
    const record = makeRecord('日本語');
    const ankiRequest = vi.fn().mockResolvedValue({ result: [[]], error: null });
    const fetchLemmas = vi.fn().mockResolvedValue({});

    await scanPage([record], baseSettings, { ankiRequest, fetchLemmas });

    expect(record.status).toBeNull();
  });

  it('T-22-029: sends a multi/findCards request with one action per unique lookup word (AC-6)', async () => {
    // The first AnkiConnect round-trip must bundle all unique words into a
    // single multi request to minimise HTTP overhead.
    const rec1 = makeRecord('日本語');
    const rec2 = makeRecord('勉強');
    const ankiRequest = vi.fn().mockResolvedValue({ result: [[], []], error: null });
    const fetchLemmas = vi.fn().mockResolvedValue({});

    await scanPage([rec1, rec2], baseSettings, { ankiRequest, fetchLemmas });

    expect(ankiRequest).toHaveBeenCalled();
    const [firstCallBody] = ankiRequest.mock.calls[0];
    expect(firstCallBody.action).toBe('multi');
    expect(firstCallBody.params.actions).toHaveLength(2);
    expect(firstCallBody.params.actions[0].action).toBe('findCards');
    expect(firstCallBody.params.actions[1].action).toBe('findCards');
  });

  it('T-22-030: sets record.status from cardsInfo and increments matched (AC-7)', async () => {
    // A record whose findCards result contains a card id must have its status
    // set to the value that corresponds to the card type from cardsInfo.
    const record = makeRecord('日本語');

    // Round trip 1: findCards returns card id 42 for 日本語
    // Round trip 2: cardsInfo returns type 2 (learned) for card 42
    const ankiRequest = vi.fn()
      .mockResolvedValueOnce({ result: [[42]], error: null })
      .mockResolvedValueOnce({ result: [{ cardId: 42, type: 2 }], error: null });
    const fetchLemmas = vi.fn().mockResolvedValue({});

    const result = await scanPage([record], baseSettings, { ankiRequest, fetchLemmas });

    expect(record.status).toBe('learned');
    expect(result.matched).toBe(1);
    expect(result.found).toBe(1);
  });

  it('T-22-031: resolves with error:"connection" and matched:0 when ankiRequest throws (AC-8)', async () => {
    // A network failure must not crash the extension; scanPage must resolve with
    // an error field so the popup can display a helpful message.
    const record = makeRecord('日本語');
    const ankiRequest = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const fetchLemmas = vi.fn().mockResolvedValue({});

    const result = await scanPage([record], baseSettings, { ankiRequest, fetchLemmas });

    expect(result.error).toBe('connection');
    expect(result.matched).toBe(0);
    expect(result.found).toBeGreaterThanOrEqual(1);
  });

  it('T-22-032: sets record.duplicate=true when findCards returns more than one card id (AC-9)', async () => {
    // When multiple cards share the same expression field, the record must have
    // duplicate=true so the overlay can display the anki-duplicate marker.
    const record = makeRecord('日本語');

    // findCards returns two card ids → duplicate
    const ankiRequest = vi.fn()
      .mockResolvedValueOnce({ result: [[10, 11]], error: null })
      .mockResolvedValueOnce({ result: [{ cardId: 10, type: 0 }, { cardId: 11, type: 0 }], error: null });
    const fetchLemmas = vi.fn().mockResolvedValue({});

    await scanPage([record], baseSettings, { ankiRequest, fetchLemmas });

    expect(record.duplicate).toBe(true);
    // Must also have a status set
    expect(record.status).not.toBeNull();
  });

  it('T-22-033: returns { found: N, matched: 0 } and does not call cardsInfo when all findCards results are empty', async () => {
    // If no card ids are found for any word, matched must be 0 and found must
    // equal the number of records; a second ankiRequest call for cardsInfo
    // would be a wasted round-trip.
    const rec1 = makeRecord('日本語');
    const rec2 = makeRecord('勉強');
    const ankiRequest = vi.fn()
      .mockResolvedValueOnce({ result: [[], []], error: null });
    const fetchLemmas = vi.fn().mockResolvedValue({});

    const result = await scanPage([rec1, rec2], baseSettings, { ankiRequest, fetchLemmas });

    expect(result.found).toBe(2);
    expect(result.matched).toBe(0);
    // cardsInfo must NOT be called when there are no card ids to look up
    expect(ankiRequest).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// furiganaVisible — extended coverage (AC-10–AC-11 — T-26-056–T-26-063)
// ---------------------------------------------------------------------------

describe('furiganaVisible — extended (AC-10, AC-11)', () => {
  it('T-26-056: returns false for status "learned" when furiganaLearned is false', () => {
    // The learned per-status flag maps to the "learned" status string (not the
    // CSS class name); it must be consulted when status === "learned".
    expect(furiganaVisible('learned', {
      furiganaGlobal: true,
      furiganaUnlearned: true,
      furiganaLearning: true,
      furiganaLearned: false,
    })).toBe(false);
  });

  it('T-26-057: returns true for status "learned" when furiganaLearned is true', () => {
    // When a user explicitly enables furigana for learned cards the function
    // must return true so the overlay renders the reading.
    expect(furiganaVisible('learned', {
      furiganaGlobal: true,
      furiganaUnlearned: true,
      furiganaLearning: true,
      furiganaLearned: true,
    })).toBe(true);
  });

  it('T-26-058: returns true for status "unlearned" when furiganaUnlearned is true', () => {
    // The most common default: new words show furigana to help the user read them.
    expect(furiganaVisible('unlearned', {
      furiganaGlobal: true,
      furiganaUnlearned: true,
      furiganaLearning: false,
      furiganaLearned: false,
    })).toBe(true);
  });

  it('T-26-059: returns true for status "learning" when furiganaLearning is true', () => {
    // Learning words showing furigana is the standard user configuration.
    expect(furiganaVisible('learning', {
      furiganaGlobal: true,
      furiganaUnlearned: false,
      furiganaLearning: true,
      furiganaLearned: false,
    })).toBe(true);
  });

  it('T-26-060: returns false for every status when furiganaGlobal is false', () => {
    // The global flag is a master switch; it must override all per-status flags.
    const settings = {
      furiganaGlobal: false,
      furiganaUnlearned: true,
      furiganaLearning: true,
      furiganaLearned: true,
    };
    expect(furiganaVisible('unlearned', settings)).toBe(false);
    expect(furiganaVisible('learning', settings)).toBe(false);
    expect(furiganaVisible('learned', settings)).toBe(false);
  });

  it('T-26-061: defaults to true for an unknown status when furiganaGlobal is true', () => {
    // If the implementation cannot find a per-status flag for an unknown status
    // value it must default to showing furigana rather than hiding it (fail open).
    expect(furiganaVisible('unknown-status', {
      furiganaGlobal: true,
      furiganaUnlearned: true,
      furiganaLearning: true,
      furiganaLearned: true,
    })).toBe(true);
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
