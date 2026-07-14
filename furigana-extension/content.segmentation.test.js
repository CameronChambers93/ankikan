/**
 * Unit tests for segmentAndWrap() from content.segmentation.js (issue #16).
 *
 * segmentAndWrap(root, isJap, tokenize) walks a DOM subtree, tokenises text
 * nodes that contain Japanese characters, and replaces them with <span> elements
 * per token.  isJap and tokenize are injected so the tests can control them
 * without a real kuromoji instance.
 *
 * The source module content.segmentation.js does not exist yet; the import
 * below is intentionally unresolvable so every test in this file starts red.
 *
 * isJapanese is NOT imported from an external module because content.js is a
 * classic browser content script (no ESM exports) and text-util.js is not a
 * planned deliverable for this issue. Instead, a faithful inline predicate
 * using the identical Unicode Script property regex from content.js is used as
 * the test fixture — this is correct because isJapanese is a *parameter* of
 * segmentAndWrap, not the function under test.
 *
 * Issue #44 (T-44-037–040): performance instrumentation. segmentAndWrap is
 * wrapped so a successful call records exactly one ankikan:t_segment
 * performance measure. PERF_NAMES is imported from content.timing.js (also
 * not yet implemented) so these assertions read the canonical name constant
 * rather than a hardcoded string literal.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { segmentAndWrap, katakanaToHiragana, splitKanjiKana, injectFurigana } from './content.segmentation.js';
import { PERF_NAMES } from './content.timing.js';

// ---------------------------------------------------------------------------
// Test fixture: isJapanese predicate
// Mirrors content.js line 12 exactly — same regex, same semantics.
// Using it as an injected parameter keeps test behaviour deterministic and
// identical to the real extension without coupling to a non-existent module.
// ---------------------------------------------------------------------------

/** Returns true if `word` contains at least one Han, Hiragana, or Katakana character. */
function isJapanese(word) {
  return /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(word);
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/** Return the document body populated with the given HTML string. */
function makeRoot(html) {
  document.body.innerHTML = html;
  return document.body;
}

// ---------------------------------------------------------------------------
// AC-1: basic wrapping
// ---------------------------------------------------------------------------

describe('segmentAndWrap — AC-1: Japanese tokens are wrapped in <span>', () => {
  it('test_japanese_token_text_equals_surface_form', () => {
    // Each span must reproduce the exact surface form so downstream Anki lookups
    // query the correct inflected form as it appears in the source text.
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: '日本語', basic_form: '日本語' },
    ]);
    const root = makeRoot('<p>日本語</p>');
    segmentAndWrap(root, isJapanese, tokenize);

    const spans = root.querySelectorAll('span');
    expect(spans.length).toBeGreaterThan(0);
    expect(spans[0].textContent).toBe('日本語');
  });

  it('test_conjugated_token_sets_data_lemma_to_basic_form', () => {
    // When basic_form differs from surface_form the span must carry data-lemma
    // so the Anki lookup can search the dictionary form (走る) rather than the
    // inflected surface (走った).
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: '走った', basic_form: '走る' },
    ]);
    const root = makeRoot('<p>走った</p>');
    segmentAndWrap(root, isJapanese, tokenize);

    const span = root.querySelector('span');
    expect(span).not.toBeNull();
    expect(span.dataset.lemma).toBe('走る');
  });

  it('test_token_with_basic_form_equal_to_surface_form_has_no_data_lemma', () => {
    // When basic_form === surface_form the span must NOT carry data-lemma;
    // setting it redundantly would clutter the DOM and confuse downstream code.
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: '日本語', basic_form: '日本語' },
    ]);
    const root = makeRoot('<p>日本語</p>');
    segmentAndWrap(root, isJapanese, tokenize);

    const span = root.querySelector('span');
    expect(span).not.toBeNull();
    expect(span.dataset.lemma).toBeUndefined();
  });

  it('test_token_with_basic_form_asterisk_has_no_data_lemma', () => {
    // Kuromoji uses '*' as a sentinel for "unknown / not applicable"; setting
    // data-lemma="*" would produce nonsense Anki lookups and must be suppressed.
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: '語', basic_form: '*' },
    ]);
    const root = makeRoot('<p>語</p>');
    segmentAndWrap(root, isJapanese, tokenize);

    const span = root.querySelector('span');
    expect(span).not.toBeNull();
    expect(span.dataset.lemma).toBeUndefined();
  });

  it('test_return_value_equals_number_of_spans_inserted', () => {
    // The integer return value is used by callers to decide whether any work
    // was done (e.g. to avoid redundant style refreshes).
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: '日本', basic_form: '日本' },
      { surface_form: '語', basic_form: '語' },
    ]);
    const root = makeRoot('<p>日本語</p>');
    const count = segmentAndWrap(root, isJapanese, tokenize);

    const spans = root.querySelectorAll('span');
    expect(typeof count).toBe('number');
    expect(count).toBe(spans.length);
  });
});

// ---------------------------------------------------------------------------
// AC-2: anki-* spans are not re-wrapped
// ---------------------------------------------------------------------------

describe('segmentAndWrap — AC-2: anki-* spans are skipped (idempotency guard)', () => {
  it('test_anki_unlearned_span_text_node_is_not_re_wrapped', () => {
    // If a span with class anki-unlearned were descended into, a second call
    // would nest new spans inside it, breaking the highlight styling.
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: '日本語', basic_form: '日本語' },
    ]);
    const root = makeRoot('<span class="anki-unlearned">日本語</span>');
    segmentAndWrap(root, isJapanese, tokenize);

    // The text node inside the anki-unlearned span must be untouched.
    const ankiSpan = root.querySelector('.anki-unlearned');
    expect(ankiSpan.childNodes.length).toBe(1);
    expect(ankiSpan.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
    expect(ankiSpan.childNodes[0].textContent).toBe('日本語');
  });

  it('test_anki_learning_span_text_node_is_not_re_wrapped', () => {
    // Same protection as for anki-unlearned; each anki-* class must be guarded
    // independently in case the check is implemented per-class.
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: '勉強', basic_form: '勉強' },
    ]);
    const root = makeRoot('<span class="anki-learning">勉強</span>');
    segmentAndWrap(root, isJapanese, tokenize);

    const ankiSpan = root.querySelector('.anki-learning');
    expect(ankiSpan.childNodes.length).toBe(1);
    expect(ankiSpan.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
  });

  it('test_anki_learned_span_text_node_is_not_re_wrapped', () => {
    // Same protection for anki-learned.
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: '言語', basic_form: '言語' },
    ]);
    const root = makeRoot('<span class="anki-learned">言語</span>');
    segmentAndWrap(root, isJapanese, tokenize);

    const ankiSpan = root.querySelector('.anki-learned');
    expect(ankiSpan.childNodes.length).toBe(1);
    expect(ankiSpan.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
  });
});

// ---------------------------------------------------------------------------
// AC-3: script / style / textarea are skipped
// ---------------------------------------------------------------------------

describe('segmentAndWrap — AC-3: inert element content is not touched', () => {
  it('test_script_element_content_receives_no_spans', () => {
    // Script content is never user-visible text; injecting spans would break
    // the JavaScript syntax.
    const tokenize = vi.fn();
    const root = makeRoot('<div><script>var x = "日本語";</script></div>');
    segmentAndWrap(root, isJapanese, tokenize);

    expect(root.querySelectorAll('span').length).toBe(0);
    expect(tokenize).not.toHaveBeenCalled();
  });

  it('test_style_element_content_receives_no_spans', () => {
    // Style content is CSS text; injecting spans would corrupt the stylesheet.
    const tokenize = vi.fn();
    const root = makeRoot('<div><style>.日本語 { color: red; }</style></div>');
    segmentAndWrap(root, isJapanese, tokenize);

    expect(root.querySelectorAll('span').length).toBe(0);
    expect(tokenize).not.toHaveBeenCalled();
  });

  it('test_textarea_element_content_receives_no_spans', () => {
    // Textarea content is editable user input; inserting element nodes inside
    // it changes its text value and would corrupt form data.
    const tokenize = vi.fn();
    const root = makeRoot('<div><textarea>日本語を入力</textarea></div>');
    segmentAndWrap(root, isJapanese, tokenize);

    expect(root.querySelectorAll('span').length).toBe(0);
    expect(tokenize).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC-4: idempotency
// ---------------------------------------------------------------------------

describe('segmentAndWrap — AC-4: calling twice produces the same result', () => {
  it('test_second_call_does_not_insert_additional_spans', () => {
    // If the function is not idempotent, a page listener firing twice would
    // nest spans inside spans, multiplying markup on every re-run.
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: '日本語', basic_form: '日本語' },
    ]);
    const root = makeRoot('<p>日本語</p>');

    const countFirst = segmentAndWrap(root, isJapanese, tokenize);
    const htmlAfterFirst = root.innerHTML;

    const countSecond = segmentAndWrap(root, isJapanese, tokenize);
    const htmlAfterSecond = root.innerHTML;

    expect(countSecond).toBe(countFirst);
    expect(htmlAfterSecond).toBe(htmlAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// AC-5: mixed-language text nodes
// ---------------------------------------------------------------------------

describe('segmentAndWrap — AC-5: mixed Japanese/non-Japanese text nodes', () => {
  it('test_only_japanese_tokens_are_wrapped_in_mixed_text', () => {
    // English runs that happen to surround Japanese text must remain as plain
    // text nodes; wrapping them in spans would incorrectly make them Anki
    // lookup candidates.
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: 'Hello ', basic_form: 'Hello ' },
      { surface_form: '日本語', basic_form: '日本語' },
      { surface_form: ' world', basic_form: ' world' },
    ]);
    const root = makeRoot('<p>Hello 日本語 world</p>');
    segmentAndWrap(root, isJapanese, tokenize);

    const spans = root.querySelectorAll('span');
    expect(spans.length).toBe(1);
    expect(spans[0].textContent).toBe('日本語');

    // The English text must survive as plain text, not be deleted.
    expect(root.textContent).toContain('Hello ');
    expect(root.textContent).toContain(' world');
  });

  it('test_non_japanese_only_root_returns_zero_and_inserts_no_spans', () => {
    // A root containing only ASCII text must short-circuit cleanly and return 0
    // rather than calling tokenize on non-Japanese content.
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: 'hello world', basic_form: 'hello world' },
    ]);
    const root = makeRoot('<p>hello world</p>');
    const count = segmentAndWrap(root, isJapanese, tokenize);

    expect(root.querySelectorAll('span').length).toBe(0);
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-6: ruby structure preservation
// ---------------------------------------------------------------------------

describe('segmentAndWrap — AC-6: ruby / rt / rp elements are left intact', () => {
  it('test_rt_content_is_not_wrapped_in_spans', () => {
    // The <rt> element holds the phonetic reading of a kanji base.  Injecting
    // spans inside it would break browser ruby rendering and double-annotate
    // furigana as if they were independent vocabulary items.
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: '日本', basic_form: '日本' },
    ]);
    // Provide a tokenize stub that returns the ruby base text only; the rt text
    // should never reach tokenize at all.
    const root = makeRoot('<ruby>日本<rt>にほん</rt></ruby>');
    segmentAndWrap(root, isJapanese, tokenize);

    const rt = root.querySelector('rt');
    expect(rt).not.toBeNull();
    // rt must contain only its original text node — no child spans.
    expect(rt.querySelectorAll('span').length).toBe(0);
    expect(rt.textContent).toBe('にほん');
  });
});

// ---------------------------------------------------------------------------
// Boundary / edge cases
// ---------------------------------------------------------------------------

describe('segmentAndWrap — edge cases', () => {
  it('test_empty_root_returns_zero_and_does_not_throw', () => {
    // An empty container must be handled gracefully; returning anything other
    // than 0 or throwing would signal that the walk is mis-counting.
    const tokenize = vi.fn();
    const root = makeRoot('<div></div>');
    const div = root.querySelector('div');

    let count;
    expect(() => {
      count = segmentAndWrap(div, isJapanese, tokenize);
    }).not.toThrow();

    expect(count).toBe(0);
    expect(tokenize).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Issue #31: reading annotation — segmentAndWrap sets dataset.reading (AC 1–3)
// ===========================================================================

describe('segmentAndWrap — issue #31 AC-1: token with reading sets span.dataset.reading', () => {
  it('test_token_with_katakana_reading_sets_dataset_reading', () => {
    // dataset.reading must carry the raw kuromoji reading field so that
    // injectFurigana can later synthesise <ruby> markup from it; if this
    // attribute is absent, furigana injection has nothing to work with.
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: '食べる', basic_form: '食べる', reading: 'タベル' },
    ]);
    const root = makeRoot('<p>食べる</p>');
    segmentAndWrap(root, isJapanese, tokenize);

    const span = root.querySelector('span');
    expect(span).not.toBeNull();
    expect(span.dataset.reading).toBe('タベル');
  });
});

describe('segmentAndWrap — issue #31 AC-2: tokens with absent/empty/sentinel reading do NOT set dataset.reading', () => {
  it('test_token_with_undefined_reading_does_not_set_dataset_reading', () => {
    // An undefined reading field means kuromoji could not determine the
    // pronunciation; setting dataset.reading to undefined/string would
    // cause injectFurigana to inject garbage <rt> content.
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: '語', basic_form: '語', reading: undefined },
    ]);
    const root = makeRoot('<p>語</p>');
    segmentAndWrap(root, isJapanese, tokenize);

    const span = root.querySelector('span');
    expect(span).not.toBeNull();
    expect(span.dataset.reading).toBeUndefined();
  });

  it('test_token_with_empty_reading_does_not_set_dataset_reading', () => {
    // An empty string reading is equally useless for furigana generation
    // and must not appear in the DOM as dataset.reading="".
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: '語', basic_form: '語', reading: '' },
    ]);
    const root = makeRoot('<p>語</p>');
    segmentAndWrap(root, isJapanese, tokenize);

    const span = root.querySelector('span');
    expect(span).not.toBeNull();
    expect(span.dataset.reading).toBeUndefined();
  });

  it('test_token_with_asterisk_reading_does_not_set_dataset_reading', () => {
    // Kuromoji emits '*' for unknown readings, identical to the basic_form
    // sentinel; treating it as a real reading would produce <rt>*</rt>.
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: '語', basic_form: '語', reading: '*' },
    ]);
    const root = makeRoot('<p>語</p>');
    segmentAndWrap(root, isJapanese, tokenize);

    const span = root.querySelector('span');
    expect(span).not.toBeNull();
    expect(span.dataset.reading).toBeUndefined();
  });
});

describe('segmentAndWrap — issue #31 AC-3: kana-only surface forms do NOT set dataset.reading', () => {
  it('test_kana_only_surface_form_does_not_set_dataset_reading', () => {
    // A surface form that is already pure kana needs no furigana annotation
    // because its pronunciation is already visible in the text; setting
    // dataset.reading would cause injectFurigana to wrap kana in <ruby>
    // unnecessarily, producing redundant and confusing output.
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: 'たべ', basic_form: 'たべ', reading: 'タベ' },
    ]);
    const root = makeRoot('<p>たべ</p>');
    segmentAndWrap(root, isJapanese, tokenize);

    const span = root.querySelector('span');
    expect(span).not.toBeNull();
    expect(span.dataset.reading).toBeUndefined();
  });

  it('test_katakana_only_surface_form_does_not_set_dataset_reading', () => {
    // Katakana-only surfaces are also self-pronouncing and must not receive
    // a redundant furigana annotation.
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: 'アニメ', basic_form: 'アニメ', reading: 'アニメ' },
    ]);
    const root = makeRoot('<p>アニメ</p>');
    segmentAndWrap(root, isJapanese, tokenize);

    const span = root.querySelector('span');
    expect(span).not.toBeNull();
    expect(span.dataset.reading).toBeUndefined();
  });
});

// ===========================================================================
// Issue #31: katakanaToHiragana (ACs 4–6)
// ===========================================================================

describe('katakanaToHiragana — issue #31 AC-4: basic katakana-to-hiragana conversion', () => {
  it('test_katakana_string_converts_to_hiragana', () => {
    // Reading fields from kuromoji arrive as katakana; they must be converted
    // to hiragana before being placed in <rt> because native Japanese furigana
    // convention uses hiragana, not katakana.
    expect(katakanaToHiragana('タベル')).toBe('たべる');
  });
});

describe('katakanaToHiragana — issue #31 AC-5: already-hiragana input is returned unchanged', () => {
  it('test_hiragana_input_returned_unchanged', () => {
    // Hiragana codepoints are below the katakana range; they must not be
    // shifted and must pass through the function without modification.
    expect(katakanaToHiragana('たべる')).toBe('たべる');
  });
});

describe('katakanaToHiragana — issue #31 AC-6: mixed katakana and non-katakana string', () => {
  it('test_only_katakana_codepoints_converted_kanji_untouched', () => {
    // A mixed string containing both katakana and kanji must have only the
    // katakana codepoints shifted; kanji lie outside the katakana Unicode block
    // and must emerge from the function byte-for-byte identical.
    expect(katakanaToHiragana('タベル食べる')).toBe('たべる食べる');
  });
});

// ===========================================================================
// Issue #31: splitKanjiKana (ACs 7–9)
// ===========================================================================

describe('splitKanjiKana — issue #31 AC-7: mixed kanji+kana string produces alternating runs', () => {
  it('test_mixed_string_splits_into_kanji_and_kana_runs', () => {
    // Furigana injection must annotate only the kanji characters; splitting
    // the surface form into kanji vs kana runs lets injectFurigana pair each
    // kanji run with its corresponding portion of the reading.
    expect(splitKanjiKana('食べる')).toEqual([
      { text: '食', isKanji: true },
      { text: 'べる', isKanji: false },
    ]);
  });
});

describe('splitKanjiKana — issue #31 AC-8: kana-only string produces a single non-kanji run', () => {
  it('test_kana_only_string_produces_single_non_kanji_run', () => {
    // A surface form with no kanji must produce a single segment so callers
    // can quickly determine that no <ruby> injection is needed.
    expect(splitKanjiKana('たべる')).toEqual([
      { text: 'たべる', isKanji: false },
    ]);
  });
});

describe('splitKanjiKana — issue #31 AC-9: all-kanji string produces a single kanji run', () => {
  it('test_all_kanji_string_produces_single_kanji_run', () => {
    // A surface form that is entirely kanji must produce a single kanji segment
    // covering the whole string so the full reading can be placed in one <rt>.
    expect(splitKanjiKana('食事')).toEqual([
      { text: '食事', isKanji: true },
    ]);
  });
});

// ===========================================================================
// Issue #31: injectFurigana (ACs 10–14)
// ===========================================================================

describe('injectFurigana — issue #31 AC-10: kanji+kana surface gets ruby on the kanji run', () => {
  it('test_mixed_surface_form_injects_ruby_on_kanji_portion_only', () => {
    // The injected <ruby> must wrap only the kanji portion '食' with the
    // corresponding hiragana slice 'た', leaving the trailing kana 'べる'
    // as plain text — matching how human-authored furigana appears in print.
    const span = document.createElement('span');
    span.textContent = '食べる';
    span.dataset.reading = 'タベル';
    injectFurigana(span);
    expect(span.innerHTML).toContain('<ruby>食<rt>た</rt></ruby>べる');
  });
});

describe('injectFurigana — issue #31 AC-11: span already containing <ruby> is not modified', () => {
  it('test_span_with_existing_ruby_child_is_left_unmodified', () => {
    // If the span already has author-provided ruby markup, injecting additional
    // <ruby> elements would corrupt the existing furigana; the function must
    // detect the presence of any <ruby> child and bail out.
    const span = document.createElement('span');
    span.innerHTML = '<ruby>日本<rt>にほん</rt></ruby>語';
    const originalHTML = span.innerHTML;
    injectFurigana(span);
    expect(span.innerHTML).toBe(originalHTML);
  });
});

describe('injectFurigana — issue #31 AC-12: span without dataset.reading is not modified', () => {
  it('test_span_without_dataset_reading_left_unmodified', () => {
    // Without a reading there is nothing to put in <rt>; the function must
    // leave the span's DOM unchanged to avoid injecting empty ruby tags.
    const span = document.createElement('span');
    span.textContent = '食べる';
    const originalHTML = span.innerHTML;
    injectFurigana(span);
    expect(span.innerHTML).toBe(originalHTML);
  });
});

describe('injectFurigana — issue #31 AC-13: kana-only textContent produces no <ruby>', () => {
  it('test_kana_only_content_produces_no_ruby_element', () => {
    // Pure kana surfaces need no furigana; if injectFurigana wraps them in
    // <ruby> the page would display redundant double-annotation visible to the user.
    const span = document.createElement('span');
    span.textContent = 'たべる';
    span.dataset.reading = 'タベル';
    injectFurigana(span);
    expect(span.querySelector('ruby')).toBeNull();
  });
});

describe('injectFurigana — issue #31 AC-14: all-kanji surface wraps entire word in one ruby', () => {
  it('test_all_kanji_surface_wraps_whole_word_in_single_ruby', () => {
    // When the surface form contains only kanji the entire word is a single
    // kanji run and the complete hiragana reading belongs in one <rt>; splitting
    // it into per-character rubies would be incorrect and hard to read.
    const span = document.createElement('span');
    span.textContent = '日本語';
    span.dataset.reading = 'ニホンゴ';
    injectFurigana(span);
    expect(span.innerHTML).toContain('<ruby>日本語<rt>にほんご</rt></ruby>');
  });
});

// ===========================================================================
// Issue #44: performance instrumentation for segmentAndWrap (T-44-037–040)
// ===========================================================================

describe('segmentAndWrap — issue #44: performance instrumentation', () => {
  // Cross-test isolation: clear the shared performance timeline before and
  // after each test so clear-and-overwrite measures from one test never leak
  // into a neighbouring test's getEntriesByName/getEntriesByType assertions.
  beforeEach(() => {
    performance.clearMarks();
    performance.clearMeasures();
  });

  afterEach(() => {
    performance.clearMarks();
    performance.clearMeasures();
  });

  it('T-44-037 a successful call records exactly one ankikan:t_segment measure with duration >= 0', () => {
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: '日本語', basic_form: '日本語' },
    ]);
    const root = makeRoot('<p>日本語</p>');
    segmentAndWrap(root, isJapanese, tokenize);

    const measures = performance.getEntriesByName(PERF_NAMES.SEGMENT, 'measure');
    expect(measures.length).toBe(1);
    expect(measures[0].duration).toBeGreaterThanOrEqual(0);
  });

  it('T-44-038 segmentAndWrap(null, ...) records no ankikan:t_segment measure (guard runs before instrumentation)', () => {
    const tokenize = vi.fn();
    const result = segmentAndWrap(null, isJapanese, tokenize);

    expect(result).toBe(0);
    expect(tokenize).not.toHaveBeenCalled();
    const measures = performance.getEntriesByName(PERF_NAMES.SEGMENT, 'measure');
    expect(measures.length).toBe(0);
  });

  it('T-44-039 two successive calls still yield exactly one ankikan:t_segment measure (clear-and-overwrite)', () => {
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: '日本語', basic_form: '日本語' },
    ]);
    const root = makeRoot('<p>日本語</p>');

    segmentAndWrap(root, isJapanese, tokenize);
    segmentAndWrap(root, isJapanese, tokenize);

    const measures = performance.getEntriesByName(PERF_NAMES.SEGMENT, 'measure');
    expect(measures.length).toBe(1);
  });

  it('T-44-040 pre-existing behavior is unchanged: span counts, dataset.lemma, dataset.reading, and return value are unaffected by instrumentation', () => {
    // A NEW assertion co-located with the marks test, using the real function
    // and live JSDOM data, proving instrumentation is behaviorally invisible
    // rather than merely re-running the pre-existing suite above.
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: '走った', basic_form: '走る', reading: 'ハシッタ' },
    ]);
    const root = makeRoot('<p>走った</p>');
    const count = segmentAndWrap(root, isJapanese, tokenize);

    const spans = root.querySelectorAll('span');
    expect(count).toBe(1);
    expect(spans.length).toBe(1);
    expect(spans[0].textContent).toBe('走った');
    expect(spans[0].dataset.lemma).toBe('走る');
    expect(spans[0].dataset.reading).toBe('ハシッタ');
  });
});
