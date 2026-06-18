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
 */

import { describe, it, expect, vi } from 'vitest';
import { segmentAndWrap } from './content.segmentation.js';

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
