/**
 * Tests for content.grouping.js — DOM grouping utilities for Issue #10.
 *
 * These tests are written in the TDD red phase: content.grouping.js does not
 * yet exist, so all imports will fail with a module-not-found error until the
 * implementation is created.
 *
 * Every test uses real JSDOM DOM nodes. extractWordFn is the only thing mocked
 * because it is an injected dependency of groupCandidates, not part of the
 * module under test.
 */

import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { BLOCK_ELEMENTS, findBlockAncestor, groupCandidates } from './content.grouping.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a JSDOM document from an HTML fragment and return { document, window }.
 * Always wraps in a full HTML skeleton so querySelector works predictably.
 */
function makeDoc(bodyHtml) {
  const { window } = new JSDOM(`<!DOCTYPE html><html><head></head><body>${bodyHtml}</body></html>`);
  return window.document;
}

// ---------------------------------------------------------------------------
// BLOCK_ELEMENTS constant
// ---------------------------------------------------------------------------

describe('BLOCK_ELEMENTS', () => {
  it('is a Set', () => {
    // groupCandidates and findBlockAncestor rely on Set.has() for O(1) lookups;
    // any other type would silently break the ancestor walk.
    expect(BLOCK_ELEMENTS).toBeInstanceOf(Set);
  });

  it('contains "P"', () => {
    // <p> is the most common prose block; sentences inside paragraphs must group together.
    expect(BLOCK_ELEMENTS.has('P')).toBe(true);
  });

  it('contains "DIV"', () => {
    // Many sites (NHK Web Easy etc.) wrap article text in <div>s instead of <p>s.
    expect(BLOCK_ELEMENTS.has('DIV')).toBe(true);
  });

  it('contains "LI"', () => {
    // List items present discrete reading units and should group their spans.
    expect(BLOCK_ELEMENTS.has('LI')).toBe(true);
  });

  it('contains "TD"', () => {
    // Table cells are block-like containers; vocabulary in a cell should be grouped.
    expect(BLOCK_ELEMENTS.has('TD')).toBe(true);
  });

  it('contains "BLOCKQUOTE"', () => {
    // Blockquotes wrap multi-word quotations that should be tokenised together.
    expect(BLOCK_ELEMENTS.has('BLOCKQUOTE')).toBe(true);
  });

  it('contains "ARTICLE"', () => {
    // Article elements often wrap an entire news body on reading-practice sites.
    expect(BLOCK_ELEMENTS.has('ARTICLE')).toBe(true);
  });

  it('contains "SECTION"', () => {
    // Sections divide thematic content and are block-level containers.
    expect(BLOCK_ELEMENTS.has('SECTION')).toBe(true);
  });

  it('contains "H1" through "H6"', () => {
    // Headings are discrete sentences; their words should be grouped together.
    for (const tag of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6']) {
      expect(BLOCK_ELEMENTS.has(tag), `expected BLOCK_ELEMENTS to contain "${tag}"`).toBe(true);
    }
  });

  it('does not contain "SPAN"', () => {
    // <span> is an inline element; treating it as a block ancestor would
    // prevent siblings inside the same <p> from being grouped.
    expect(BLOCK_ELEMENTS.has('SPAN')).toBe(false);
  });

  it('does not contain "A"', () => {
    // Anchor tags are inline; grouping should skip them and climb to the real block.
    expect(BLOCK_ELEMENTS.has('A')).toBe(false);
  });

  it('does not contain "EM"', () => {
    // <em> is an inline emphasis element and must not act as a grouping boundary.
    expect(BLOCK_ELEMENTS.has('EM')).toBe(false);
  });

  it('does not contain "STRONG"', () => {
    // <strong> is inline; the walker must pass through it to find the block ancestor.
    expect(BLOCK_ELEMENTS.has('STRONG')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findBlockAncestor
// ---------------------------------------------------------------------------

describe('findBlockAncestor', () => {
  it('returns the <p> element when a span is a direct child of <p>', () => {
    // The simplest grouping case: <p><span>...</span></p>.
    // findBlockAncestor must return the <p>, not the body or document.
    const doc = makeDoc('<p><span id="s">日本語</span></p>');
    const span = doc.getElementById('s');
    const result = findBlockAncestor(span);
    expect(result.tagName).toBe('P');
  });

  it('returns the <p> element — not the intermediate <span> — when structure is <p><span><span></p>', () => {
    // An inline <span> wrapper must be skipped; the walker looks for block elements only.
    const doc = makeDoc('<p><span><span id="s">読む</span></span></p>');
    const span = doc.getElementById('s');
    const result = findBlockAncestor(span);
    expect(result.tagName).toBe('P');
  });

  it('returns the <div> — not the outer <p> — when span is inside <div> inside <p>', () => {
    // The walker returns the FIRST (nearest) block ancestor it encounters going
    // up from parentElement, so <div> wins over the outer <p>.
    const doc = makeDoc('<p><div id="d"><span id="s">食べる</span></div></p>');
    const span = doc.getElementById('s');
    const result = findBlockAncestor(span);
    expect(result.tagName).toBe('DIV');
  });

  it('returns the <div> when a span is nested inside <span> inside <div>', () => {
    // Intermediate inline <span> must be transparent to the walker.
    const doc = makeDoc('<div id="d"><span><span id="s">走る</span></span></div>');
    const span = doc.getElementById('s');
    const result = findBlockAncestor(span);
    expect(result.tagName).toBe('DIV');
  });

  it('returns the <td> element when a span is inside a table cell', () => {
    // Table cells are block-like containers; words inside a cell should be
    // associated with that cell as their group boundary.
    const doc = makeDoc('<table><tr><td id="td"><span id="s">学ぶ</span></td></tr></table>');
    const span = doc.getElementById('s');
    const result = findBlockAncestor(span);
    expect(result.tagName).toBe('TD');
  });

  it('returns element.parentElement when no block ancestor exists before <body>', () => {
    // A span that is a direct child of <body> has no block ancestor; the
    // function must fall back to parentElement so callers always get a node.
    const doc = makeDoc('<span id="s">けが</span>');
    const span = doc.getElementById('s');
    const result = findBlockAncestor(span);
    // The direct parent is <body>; that is what should be returned as fallback.
    expect(result).toBe(span.parentElement);
  });

  it('returns the actual <p> node object, not just a matching tagName string', () => {
    // Callers use the returned node as a key in a Map; it must be the exact
    // DOM node, not a copy or wrapper.
    const doc = makeDoc('<p id="p1"><span id="s">勉強</span></p>');
    const span = doc.getElementById('s');
    const p = doc.getElementById('p1');
    expect(findBlockAncestor(span)).toBe(p);
  });
});

// ---------------------------------------------------------------------------
// groupCandidates
// ---------------------------------------------------------------------------

describe('groupCandidates', () => {
  it('returns an empty array when candidates is empty', () => {
    // An empty input must short-circuit cleanly; no errors, no phantom groups.
    const extractWordFn = vi.fn();
    const result = groupCandidates([], extractWordFn);
    expect(result).toEqual([]);
    expect(extractWordFn).not.toHaveBeenCalled();
  });

  it('returns one entry when two candidate spans share a single <p>', () => {
    // Two words inside the same paragraph form one logical sentence unit and
    // must be grouped under that paragraph for context-aware tokenisation.
    const doc = makeDoc('<p id="p1"><span id="s1">日本</span><span id="s2">語</span></p>');
    const s1 = doc.getElementById('s1');
    const s2 = doc.getElementById('s2');
    const candidates = [
      { span: s1, word: '日本' },
      { span: s2, word: '語' },
    ];
    const extractWordFn = vi.fn((span) => span.textContent);
    const result = groupCandidates(candidates, extractWordFn);
    expect(result).toHaveLength(1);
  });

  it('surfaces list for a single-<p> group contains both candidate words', () => {
    // The surfaces array must enumerate every candidate word in the group so
    // the caller can match tokenised output back to individual spans.
    const doc = makeDoc('<p id="p1"><span id="s1">日本</span><span id="s2">語</span></p>');
    const s1 = doc.getElementById('s1');
    const s2 = doc.getElementById('s2');
    const candidates = [
      { span: s1, word: '日本' },
      { span: s2, word: '語' },
    ];
    const extractWordFn = vi.fn((span) => span.textContent);
    const result = groupCandidates(candidates, extractWordFn);
    expect(result[0].surfaces).toContain('日本');
    expect(result[0].surfaces).toContain('語');
  });

  it('returns two entries when candidate spans are in two separate <p> elements', () => {
    // Spans separated by a block boundary belong to different sentences and
    // must produce independent group entries.
    const doc = makeDoc(
      '<p id="p1"><span id="s1">読む</span></p>' +
      '<p id="p2"><span id="s2">書く</span></p>'
    );
    const s1 = doc.getElementById('s1');
    const s2 = doc.getElementById('s2');
    const candidates = [
      { span: s1, word: '読む' },
      { span: s2, word: '書く' },
    ];
    const extractWordFn = vi.fn((span) => span.textContent);
    const result = groupCandidates(candidates, extractWordFn);
    expect(result).toHaveLength(2);
  });

  it('returns one entry when two candidates share a <div> (NHK-style markup)', () => {
    // NHK Web Easy wraps sentences in <div>s, not <p>s. The grouper must
    // treat <div> as a valid block boundary so the full sentence is sent together.
    const doc = makeDoc('<div id="d1"><span id="s1">走る</span><span id="s2">速い</span></div>');
    const s1 = doc.getElementById('s1');
    const s2 = doc.getElementById('s2');
    const candidates = [
      { span: s1, word: '走る' },
      { span: s2, word: '速い' },
    ];
    const extractWordFn = vi.fn((span) => span.textContent);
    const result = groupCandidates(candidates, extractWordFn);
    expect(result).toHaveLength(1);
  });

  it('builds `text` from ALL spans in the block, not just candidate spans', () => {
    // Non-candidate spans (e.g. already-highlighted words) still contribute to
    // the sentence context. The text field must represent the complete sentence
    // so the tokeniser receives full grammatical context.
    const doc = makeDoc(
      '<p id="p1">' +
        '<span id="s1">私</span>' +   // candidate
        '<span id="s2">は</span>' +   // NOT a candidate
        '<span id="s3">学生</span>' + // candidate
      '</p>'
    );
    const s1 = doc.getElementById('s1');
    const s3 = doc.getElementById('s3');
    const candidates = [
      { span: s1, word: '私' },
      { span: s3, word: '学生' },
    ];
    // extractWordFn returns each span's textContent so we can verify all 3 were called
    const extractWordFn = vi.fn((span) => span.textContent);
    const result = groupCandidates(candidates, extractWordFn);
    // text must include the non-candidate span "は"
    expect(result[0].text).toContain('は');
    // text must also include the candidate spans
    expect(result[0].text).toContain('私');
    expect(result[0].text).toContain('学生');
  });

  it('calls extractWordFn on all spans in the block, including non-candidate spans', () => {
    // The implementation must call querySelectorAll('span') on the block, not
    // iterate only the candidates array, so the text is built from the full sentence.
    const doc = makeDoc(
      '<p id="p1">' +
        '<span id="s1">私</span>' +
        '<span id="s2">は</span>' +
        '<span id="s3">学生</span>' +
      '</p>'
    );
    const s1 = doc.getElementById('s1');
    const s3 = doc.getElementById('s3');
    const candidates = [
      { span: s1, word: '私' },
      { span: s3, word: '学生' },
    ];
    const extractWordFn = vi.fn((span) => span.textContent);
    groupCandidates(candidates, extractWordFn);
    // extractWordFn must have been called 3 times (all spans in the block)
    expect(extractWordFn).toHaveBeenCalledTimes(3);
  });

  it('returns one entry with one surface for a lone candidate in its own <p>', () => {
    // A single-word group must not be dropped or merged; every candidate
    // deserves a lookup even if it is alone in its block.
    const doc = makeDoc('<p id="p1"><span id="s1">勉強</span></p>');
    const s1 = doc.getElementById('s1');
    const candidates = [{ span: s1, word: '勉強' }];
    const extractWordFn = vi.fn((span) => span.textContent);
    const result = groupCandidates(candidates, extractWordFn);
    expect(result).toHaveLength(1);
    expect(result[0].surfaces).toEqual(['勉強']);
  });

  it('surfaces array contains the `word` values from candidates, not extractWordFn return values', () => {
    // The word field on each candidate is the pre-computed surface form used for
    // Anki lookups. extractWordFn builds the sentence text, not the surfaces list;
    // mixing them would send wrong forms to AnkiConnect.
    const doc = makeDoc('<p id="p1"><span id="s1">食べる</span></p>');
    const s1 = doc.getElementById('s1');
    // extractWordFn returns something different from word to prove they are kept separate
    const extractWordFn = vi.fn(() => 'EXTRACTED');
    const candidates = [{ span: s1, word: '食べる' }];
    const result = groupCandidates(candidates, extractWordFn);
    expect(result[0].surfaces).toEqual(['食べる']);
    expect(result[0].text).toBe('EXTRACTED');
  });

  it('each result entry has a `text` property that is a string', () => {
    // Callers pass text directly to the tokeniser; a non-string would cause a
    // runtime crash in the server request.
    const doc = makeDoc('<p id="p1"><span id="s1">走る</span></p>');
    const s1 = doc.getElementById('s1');
    const extractWordFn = vi.fn((span) => span.textContent);
    const result = groupCandidates([{ span: s1, word: '走る' }], extractWordFn);
    expect(typeof result[0].text).toBe('string');
  });

  it('each result entry has a `surfaces` property that is an array', () => {
    // Callers iterate surfaces to match tokeniser output back to spans; a
    // non-array would break that mapping loop.
    const doc = makeDoc('<p id="p1"><span id="s1">走る</span></p>');
    const s1 = doc.getElementById('s1');
    const extractWordFn = vi.fn((span) => span.textContent);
    const result = groupCandidates([{ span: s1, word: '走る' }], extractWordFn);
    expect(Array.isArray(result[0].surfaces)).toBe(true);
  });

  it('produces groups in DOM order (first block before second block)', () => {
    // Callers process groups sequentially; out-of-order groups would misalign
    // the tokeniser results with the visual order of spans on the page.
    const doc = makeDoc(
      '<p id="p1"><span id="s1">一番目</span></p>' +
      '<p id="p2"><span id="s2">二番目</span></p>'
    );
    const s1 = doc.getElementById('s1');
    const s2 = doc.getElementById('s2');
    const candidates = [
      { span: s1, word: '一番目' },
      { span: s2, word: '二番目' },
    ];
    const extractWordFn = vi.fn((span) => span.textContent);
    const result = groupCandidates(candidates, extractWordFn);
    expect(result[0].surfaces[0]).toBe('一番目');
    expect(result[1].surfaces[0]).toBe('二番目');
  });
});
