/**
 * Unit tests for word-collect.js (issue #26).
 *
 * word-collect.js does not exist yet; the imports below are intentionally
 * unresolvable so every test starts red until the developer creates the module.
 *
 * AC-1: collectWords returns WordRecords whose range bounds the token in the
 *       original text node.
 * AC-2: surface/lemma fields are set correctly from kuromoji token fields.
 * AC-3: reading is katakana-converted to hiragana; absent/asterisk → null.
 * AC-4: SCRIPT/STYLE/TEXTAREA/RT/RP content is skipped.
 * AC-5: collectFromSpans reads range and lemma from existing span[data-lemma].
 * AC-6: non-Japanese text nodes produce no records.
 * AC-7: katakanaToHiragana converts correctly.
 */

import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  collectWords,
  collectFromSpans,
  katakanaToHiragana,
} from './word-collect.js';
import { isJapanese } from './scan-util.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a real JSDOM document body with the given HTML and return (doc, body).
 * Using a fresh document per test avoids cross-test DOM state.
 */
function makeDoc(bodyHtml) {
  const dom = new JSDOM(`<!DOCTYPE html><body>${bodyHtml}</body>`);
  return { doc: dom.window.document, body: dom.window.document.body };
}

/**
 * Minimal kuromoji token stub.  `reading` is optional so individual tests can
 * omit it to simulate absent fields.
 */
function makeToken(surface_form, basic_form, reading) {
  const t = { surface_form, basic_form };
  if (reading !== undefined) t.reading = reading;
  return t;
}

// ---------------------------------------------------------------------------
// AC-7: katakanaToHiragana
// ---------------------------------------------------------------------------

describe('katakanaToHiragana (AC-7)', () => {
  it('T-26-001: converts full-width katakana ニホン to hiragana にほん', () => {
    // The plan specifies U+30A1–U+30F6 shift down by 0x60; this exercises three
    // common katakana codepoints so the range is verified empirically.
    expect(katakanaToHiragana('ニホン')).toBe('にほん');
  });

  it('T-26-002: leaves hiragana input unchanged', () => {
    // Hiragana codepoints are below U+30A1 and must not be shifted.
    expect(katakanaToHiragana('にほん')).toBe('にほん');
  });

  it('T-26-003: shifts only katakana chars in a mixed string', () => {
    // A mixed string must convert only the katakana portion; hiragana and kanji
    // must be preserved as-is.
    expect(katakanaToHiragana('アニメが好き')).toBe('あにめが好き');
  });

  it('T-26-004: preserves ー (U+30FC long vowel mark) unchanged', () => {
    // U+30FC is the katakana-hiragana prolonged sound mark; the plan states it
    // is an identity mapping and must not be corrupted.
    expect(katakanaToHiragana('コーヒー')).toBe('こーひー');
  });

  it('T-26-005: returns an empty string unchanged', () => {
    // Edge case: empty input must not throw or produce garbage.
    expect(katakanaToHiragana('')).toBe('');
  });

  it('T-26-006: converts all standard katakana codepoints A–N in the plan range', () => {
    // Spot-check the first and last characters of the U+30A1–U+30F6 range so
    // an off-by-one in the shift constant is caught.
    expect(katakanaToHiragana('ァ')).toBe('ぁ'); // U+30A1 → U+3041
    expect(katakanaToHiragana('ヶ')).toBe('ゖ'); // U+30F6 → U+3096
  });
});

// ---------------------------------------------------------------------------
// AC-1: range shape
// ---------------------------------------------------------------------------

describe('collectWords — range shape (AC-1)', () => {
  it('T-26-007: range.startContainer and endContainer are the original text node', () => {
    // Range-based highlighting depends on the container being the text node itself;
    // if it pointed to the parent element the offset semantics would differ.
    const { body } = makeDoc('<p>日本語</p>');
    const textNode = body.querySelector('p').firstChild;
    const tokenize = vi.fn().mockReturnValue([
      makeToken('日本語', '日本語', 'ニホンゴ'),
    ]);

    const records = collectWords(body, { isJapanese, tokenize });

    expect(records.length).toBeGreaterThan(0);
    const rec = records[0];
    expect(rec.range.startContainer).toBe(textNode);
    expect(rec.range.endContainer).toBe(textNode);
  });

  it('T-26-008: range offsets bound the token surface form within the text node', () => {
    // startOffset and endOffset must equal the character indices in the text node
    // so that the Range selects exactly the token's characters.
    const { body } = makeDoc('<p>日本語</p>');
    const tokenize = vi.fn().mockReturnValue([
      makeToken('日本語', '日本語', 'ニホンゴ'),
    ]);

    const records = collectWords(body, { isJapanese, tokenize });

    const rec = records[0];
    expect(rec.range.startOffset).toBe(0);
    expect(rec.range.endOffset).toBe(3); // '日本語'.length === 3
  });

  it('T-26-009: ranges for two consecutive tokens in the same text node have non-overlapping offsets', () => {
    // When a text node contains two tokens, each record's offsets must step past
    // the previous token so ranges don't overlap.
    const { body } = makeDoc('<p>日本語勉強</p>');
    const tokenize = vi.fn().mockReturnValue([
      makeToken('日本語', '日本語', 'ニホンゴ'),
      makeToken('勉強', '勉強', 'ベンキョウ'),
    ]);

    const records = collectWords(body, { isJapanese, tokenize });

    expect(records.length).toBe(2);
    expect(records[0].range.startOffset).toBe(0);
    expect(records[0].range.endOffset).toBe(3);
    expect(records[1].range.startOffset).toBe(3);
    expect(records[1].range.endOffset).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// AC-2: surface / lemma
// ---------------------------------------------------------------------------

describe('collectWords — surface and lemma (AC-2)', () => {
  it('T-26-010: record.surface equals token surface_form', () => {
    // The surface field drives the Anki card lookup when no lemma is available;
    // it must be the exact inflected form from the tokenizer.
    const { body } = makeDoc('<p>走った</p>');
    const tokenize = vi.fn().mockReturnValue([
      makeToken('走った', '走る', 'ハシッタ'),
    ]);

    const records = collectWords(body, { isJapanese, tokenize });

    expect(records[0].surface).toBe('走った');
  });

  it('T-26-011: record.lemma is basic_form when it differs from surface and is not asterisk', () => {
    // The lemma is the dictionary form used for more accurate Anki matching;
    // it must be set when the tokenizer provides a different basic_form.
    const { body } = makeDoc('<p>走った</p>');
    const tokenize = vi.fn().mockReturnValue([
      makeToken('走った', '走る', 'ハシッタ'),
    ]);

    const records = collectWords(body, { isJapanese, tokenize });

    expect(records[0].lemma).toBe('走る');
  });

  it('T-26-012: record.lemma is null when basic_form equals surface_form', () => {
    // When the tokenizer returns the same form for both fields, storing a lemma
    // would be redundant; null signals "use surface".
    const { body } = makeDoc('<p>日本語</p>');
    const tokenize = vi.fn().mockReturnValue([
      makeToken('日本語', '日本語', 'ニホンゴ'),
    ]);

    const records = collectWords(body, { isJapanese, tokenize });

    expect(records[0].lemma).toBeNull();
  });

  it('T-26-013: record.lemma is null when basic_form is the asterisk sentinel', () => {
    // Kuromoji emits "*" when the dictionary form is unavailable; storing it
    // would cause nonsense Anki queries.
    const { body } = makeDoc('<p>語</p>');
    const tokenize = vi.fn().mockReturnValue([
      makeToken('語', '*', 'ゴ'),
    ]);

    const records = collectWords(body, { isJapanese, tokenize });

    expect(records[0].lemma).toBeNull();
  });

  it('T-26-014: record.status is null and record.duplicate is false before scanning', () => {
    // collectWords populates geometry and identity fields only; scanPage is
    // responsible for setting status and duplicate — they must start unset.
    const { body } = makeDoc('<p>日本語</p>');
    const tokenize = vi.fn().mockReturnValue([
      makeToken('日本語', '日本語', 'ニホンゴ'),
    ]);

    const records = collectWords(body, { isJapanese, tokenize });

    expect(records[0].status).toBeNull();
    expect(records[0].duplicate).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-3: reading field
// ---------------------------------------------------------------------------

describe('collectWords — reading (AC-3)', () => {
  it('T-26-015: record.reading is the hiragana-converted reading when katakana reading present', () => {
    // Furigana is rendered in hiragana; the reading must be converted from the
    // katakana that kuromoji returns.
    const { body } = makeDoc('<p>日本語</p>');
    const tokenize = vi.fn().mockReturnValue([
      makeToken('日本語', '日本語', 'ニホンゴ'),
    ]);

    const records = collectWords(body, { isJapanese, tokenize });

    expect(records[0].reading).toBe('にほんご');
  });

  it('T-26-016: record.reading is null when reading is absent from the token', () => {
    // Some kuromoji tokens omit the reading field; reading must not be set to
    // undefined/garbage when that field is missing.
    const { body } = makeDoc('<p>日本語</p>');
    const tokenize = vi.fn().mockReturnValue([
      makeToken('日本語', '日本語'), // no reading field
    ]);

    const records = collectWords(body, { isJapanese, tokenize });

    expect(records[0].reading).toBeNull();
  });

  it('T-26-017: record.reading is null when token reading is the asterisk sentinel', () => {
    // Kuromoji uses "*" for unknown readings; storing it would render literal
    // asterisks as furigana.
    const { body } = makeDoc('<p>語</p>');
    const tokenize = vi.fn().mockReturnValue([
      makeToken('語', '*', '*'),
    ]);

    const records = collectWords(body, { isJapanese, tokenize });

    expect(records[0].reading).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-4: SKIP_TAGS
// ---------------------------------------------------------------------------

describe('collectWords — SKIP_TAGS exclusion (AC-4)', () => {
  it('T-26-018: no record produced for Japanese text inside a SCRIPT element', () => {
    // Script content is executable code; injecting ranges inside it would break
    // the extension's ability to correctly calculate positions.
    const { body } = makeDoc('<script>var x = "日本語";</script>');
    const tokenize = vi.fn();

    const records = collectWords(body, { isJapanese, tokenize });

    expect(records.length).toBe(0);
    expect(tokenize).not.toHaveBeenCalled();
  });

  it('T-26-019: no record produced for Japanese text inside a STYLE element', () => {
    // Style content is CSS; tokenizing it serves no purpose and may corrupt
    // offset calculations if the text contains Japanese selector names.
    const { body } = makeDoc('<style>.日本語 { color: red; }</style>');
    const tokenize = vi.fn();

    const records = collectWords(body, { isJapanese, tokenize });

    expect(records.length).toBe(0);
    expect(tokenize).not.toHaveBeenCalled();
  });

  it('T-26-020: no record produced for Japanese text inside a TEXTAREA element', () => {
    // TEXTAREA content is editable user input; ranging into it could corrupt
    // form values.
    const { body } = makeDoc('<textarea>日本語を入力</textarea>');
    const tokenize = vi.fn();

    const records = collectWords(body, { isJapanese, tokenize });

    expect(records.length).toBe(0);
    expect(tokenize).not.toHaveBeenCalled();
  });

  it('T-26-021: no record produced for Japanese text inside an RT element', () => {
    // RT holds the phonetic reading of a kanji base; building a furigana overlay
    // on top of an existing RT reading would produce double furigana.
    const { body } = makeDoc('<ruby>日本<rt>にほん</rt></ruby>');
    const tokenize = vi.fn().mockReturnValue([
      makeToken('日本', '日本', 'ニホン'),
    ]);

    const records = collectWords(body, { isJapanese, tokenize });

    // Only the base text "日本" (not the RT content) should be recorded.
    const rtRecords = records.filter((r) => r.surface === 'にほん');
    expect(rtRecords.length).toBe(0);
  });

  it('T-26-022: no record produced for Japanese text inside an RP element', () => {
    // RP elements hold fallback parentheses for non-ruby-aware browsers and must
    // also be skipped.
    const { body } = makeDoc('<ruby>語<rp>（</rp><rt>ご</rt><rp>）</rp></ruby>');
    const tokenize = vi.fn().mockReturnValue([
      makeToken('語', '語', 'ゴ'),
    ]);

    const records = collectWords(body, { isJapanese, tokenize });

    const rpRecords = records.filter((r) => r.surface === '（' || r.surface === '）');
    expect(rpRecords.length).toBe(0);
  });

  it('T-26-023: existing anki spans are not descended into', () => {
    // An anki-* span from a previous scan must not have its text node
    // re-collected; doing so would produce duplicate ranges on the same text.
    const { body } = makeDoc('<span class="anki-unlearned">日本語</span>');
    const tokenize = vi.fn();

    const records = collectWords(body, { isJapanese, tokenize });

    expect(records.length).toBe(0);
    expect(tokenize).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC-6: non-Japanese exclusion
// ---------------------------------------------------------------------------

describe('collectWords — non-Japanese exclusion (AC-6)', () => {
  it('T-26-024: returns empty array for a root containing only ASCII text', () => {
    // ASCII text must not cause tokenize to be called; it produces no records.
    const { body } = makeDoc('<p>hello world</p>');
    const tokenize = vi.fn();

    const records = collectWords(body, { isJapanese, tokenize });

    expect(records.length).toBe(0);
    expect(tokenize).not.toHaveBeenCalled();
  });

  it('T-26-025: returns empty array for a root with only CJK punctuation', () => {
    // CJK punctuation (。「」) is not Japanese script; it must not trigger record
    // creation because it cannot be looked up as vocabulary.
    const { body } = makeDoc('<p>。「」</p>');
    const tokenize = vi.fn();

    const records = collectWords(body, { isJapanese, tokenize });

    expect(records.length).toBe(0);
  });

  it('T-26-026: non-Japanese tokens within a Japanese text node produce no record', () => {
    // A tokenizer may segment "Hello 日本語" into multiple tokens; only the
    // Japanese ones must produce records.
    const { body } = makeDoc('<p>Hello 日本語</p>');
    const tokenize = vi.fn().mockReturnValue([
      makeToken('Hello ', 'Hello ', undefined),
      makeToken('日本語', '日本語', 'ニホンゴ'),
    ]);

    const records = collectWords(body, { isJapanese, tokenize });

    expect(records.length).toBe(1);
    expect(records[0].surface).toBe('日本語');
  });
});

// ---------------------------------------------------------------------------
// AC-5: collectFromSpans
// ---------------------------------------------------------------------------

describe('collectFromSpans (AC-5)', () => {
  it('T-26-027: returns one record per Japanese span with data-lemma', () => {
    // collectFromSpans is the path for pre-annotated pages; it must discover
    // every span that carries a valid Japanese word.
    const { body } = makeDoc('<span data-lemma="走る">走った</span>');

    const records = collectFromSpans(body);

    expect(records.length).toBe(1);
  });

  it('T-26-028: record.lemma comes from span dataset.lemma', () => {
    // The lemma was already resolved by the server during segmentation; it must
    // be preserved verbatim rather than re-computed.
    const { body } = makeDoc('<span data-lemma="走る">走った</span>');

    const records = collectFromSpans(body);

    expect(records[0].lemma).toBe('走る');
  });

  it('T-26-029: record.lemma is null when data-lemma is absent', () => {
    // A span without data-lemma has no pre-computed dictionary form; lemma must
    // be null to signal "use surface for lookup".
    const { body } = makeDoc('<span>日本語</span>');

    const records = collectFromSpans(body);

    // If the span is Japanese it should appear as a record; the lemma must be null.
    if (records.length > 0) {
      expect(records[0].lemma).toBeNull();
    }
  });

  it('T-26-030: record.reading is null (page ruby handled by CSS, not overlay)', () => {
    // Pre-annotated pages already have <ruby><rt> markup; the overlay must not
    // emit its own furigana on top of the page's own — reading must be null.
    const { body } = makeDoc('<span data-lemma="走る">走った</span>');

    const records = collectFromSpans(body);

    expect(records[0].reading).toBeNull();
  });

  it('T-26-031: record.range spans the full content of the span element', () => {
    // The range must cover the entire text inside the span so the overlay rect
    // tracks the complete word's bounding box.
    const { body } = makeDoc('<span data-lemma="走る">走った</span>');
    const span = body.querySelector('span');

    const records = collectFromSpans(body);

    const r = records[0].range;
    // The range must be set to span the contents of the span element
    expect(r.startContainer).toBe(span);
    expect(r.endContainer).toBe(span);
  });

  it('T-26-032: non-Japanese spans produce no record in collectFromSpans', () => {
    // Only Japanese content spans are valid annotation targets; ASCII spans must
    // be silently excluded.
    const { body } = makeDoc('<span>hello</span>');

    const records = collectFromSpans(body);

    expect(records.length).toBe(0);
  });

  it('T-26-033: record.status is null and record.duplicate is false', () => {
    // Status and duplicate are set by scanPage; collectFromSpans must not
    // pre-populate them.
    const { body } = makeDoc('<span data-lemma="走る">走った</span>');

    const records = collectFromSpans(body);

    expect(records[0].status).toBeNull();
    expect(records[0].duplicate).toBe(false);
  });
});
