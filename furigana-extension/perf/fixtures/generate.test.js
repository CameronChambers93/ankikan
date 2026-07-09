/**
 * Unit tests for the 'wide' variant of generateHTML() (perf/fixtures/generate.js),
 * issue #44 AC 5-8.
 *
 * dense/sparse both draw from the same ~65-word KANJI_NOUNS+KANJI_SINGLE pool, so
 * distinct lookup-word count plateaus regardless of page size — an XL page ends
 * up sending an S-sized network payload, the exact symptom this variant exists
 * to fix. These tests assert the wide variant actually scales with page size,
 * stays duplicate-free per page (by construction, not probabilistically), beats
 * dense by an order of magnitude at XL, and remains byte-deterministic (a hard
 * baseline-diff requirement carried over from the existing dense/sparse
 * variants).
 */
import { describe, it, expect } from 'vitest';
import { generateHTML, generateText, SIZES } from './generate.js';
import { KANJI_NOUNS, KANJI_SINGLE } from './corpus.js';
import { domFromHTML } from '../lib/dom.js';

const HAN_ONLY_RE = /^[一-龯㐀-䶿]+$/;

// The closed pool dense/sparse pages draw their kanji nouns from — the real
// ceiling on their distinct lookup-word count no matter how large the page.
// Derived from the corpus so it tracks the pools instead of a stale literal.
const DENSE_POOL_CAP = KANJI_NOUNS.length + KANJI_SINGLE.length;

describe('generateHTML — wide variant span shape', () => {
  it('T-44-005 every span is non-empty Han-only text with no data-lemma/data-reading and no duplicate textContent on the page', () => {
    // generateHTML wraps wide noun slots in a classless <span> at generation
    // time (bypassing the tokenizer entirely for those slots — see Technical
    // Design), so this markup must already look exactly like a pre-existing,
    // un-annotated word span: no data-lemma/data-reading, and — by the
    // no-cycling cursor design — zero duplicates within a single page.
    const html = generateHTML(1000, { variant: 'wide' });
    const { body } = domFromHTML(html);
    const spans = Array.from(body.querySelectorAll('span'));

    expect(spans.length).toBeGreaterThan(0);

    const seen = new Set();
    for (const span of spans) {
      const text = span.textContent;
      expect(text.length).toBeGreaterThan(0);
      expect(HAN_ONLY_RE.test(text)).toBe(true);
      expect(span.dataset.lemma).toBeUndefined();
      expect(span.dataset.reading).toBeUndefined();
      expect(seen.has(text)).toBe(false);
      seen.add(text);
    }
  });
});

describe('generateHTML — wide variant vocabulary scales with page size', () => {
  it('T-44-006 distinct span textContent count strictly increases across S/M/L/XL', () => {
    // dense/sparse's distinct-word count plateaus at ~65 regardless of size;
    // wide must not plateau — this is the direct proof that it scales.
    const counts = ['S', 'M', 'L', 'XL'].map((size) => {
      const html = generateHTML(SIZES[size], { variant: 'wide' });
      const { body } = domFromHTML(html);
      const distinct = new Set(Array.from(body.querySelectorAll('span')).map((s) => s.textContent));
      return distinct.size;
    });

    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThan(counts[i - 1]);
    }
  });

  it('T-44-007 wide XL distinct lookup words exceed dense XL by at least 10x (the regression symptom)', () => {
    // dense draws from a closed pool, so at XL size its distinct-word count is
    // capped by the pool itself no matter how much text is generated. wide's
    // count must dwarf that cap — this is the direct regression test for the
    // issue's stated symptom (XL page sending an S-sized network payload).
    const denseText = generateText(SIZES.XL, { variant: 'dense' });
    const wideHTML = generateHTML(SIZES.XL, { variant: 'wide' });
    const wideDistinct = new Set(
      Array.from(domFromHTML(wideHTML).body.querySelectorAll('span')).map((s) => s.textContent),
    );

    // Sanity: dense's raw text length grows with tokenCount even though its
    // vocabulary does not — confirms this isn't an accidental empty-string comparison.
    expect(denseText.length).toBeGreaterThan(0);
    expect(wideDistinct.size).toBeGreaterThanOrEqual(DENSE_POOL_CAP * 10);
  });
});

describe('generateHTML — wide variant determinism', () => {
  it('T-44-008 identical seed and count produce byte-identical HTML on repeat calls', () => {
    // Matches the hard byte-identical requirement already enforced for
    // dense/sparse — baseline diffing depends on it.
    const a = generateHTML(1000, { seed: 0x4b414e, variant: 'wide' });
    const b = generateHTML(1000, { seed: 0x4b414e, variant: 'wide' });
    expect(b).toBe(a);
  });
});
