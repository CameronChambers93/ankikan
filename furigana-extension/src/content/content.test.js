/**
 * Unit tests for isJapanese() and extractWord() from content.js.
 *
 * content.js is a classic browser content script — it cannot export symbols
 * for ESM import. These tests define the functions inline, mirroring the
 * implementations in content.js exactly. Any change to content.js must be
 * reflected here; the E2E tests (e2e/ankican.e2e.js) verify the actual
 * browser behaviour end-to-end.
 *
 * TODO (out of scope for this ticket, requires full AnkiConnect mock):
 *   - Test that a kana-only word whose Anki lookup returns multiple card IDs
 *     receives the `anki-duplicate` class.
 */

import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';

// ---------------------------------------------------------------------------
// Implementations — must stay in sync with content.js
// ---------------------------------------------------------------------------

function isJapanese(word) {
  return /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(word);
}

function extractWord(span) {
  let word = '';
  for (const node of span.childNodes) {
    if (node.nodeType === 3 /* TEXT_NODE */) {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a real DOM span from an HTML string using jsdom. */
function makeSpan(innerHTML) {
  const dom = new JSDOM(`<!DOCTYPE html><body><span>${innerHTML}</span></body>`);
  return dom.window.document.querySelector('span');
}

// ---------------------------------------------------------------------------
// isJapanese
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
// extractWord
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
