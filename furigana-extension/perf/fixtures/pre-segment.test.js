/**
 * Unit tests for generatePreSegmentedHTML() (perf/fixtures/pre-segment.js),
 * issue #44 AC 9-11 and Slice 11 AC 16-21 (T-44-137/138/141/142).
 *
 * Tier-2 Playwright scenarios need pages that already carry
 * <span data-lemma data-reading> markup so scanPage's DOM-scan cost can be
 * isolated from segmentAndWrap's tokenize-and-wrap cost. These tests lock the
 * fixture's span shape to segmentAndWrap's real contract, confirm the fixture is
 * genuinely idempotent (a second segmentAndWrap pass is a true no-op), and guard
 * the wide+real-tokenizer interaction traced in Technical Design (wide compounds
 * must never be re-tokenized, only the surrounding text).
 *
 * Slice 11 extends this to Tier-2 sizes (SIZES.S/M/L/XL, up to 50,000 tokens)
 * to prove the wide-variant fixture scales — both in total span count and in
 * distinct lookup-word count — and that the shape/idempotency contracts proven
 * at small scale (T-44-009/010) still hold at XL scale.
 */
import { describe, it, expect } from 'vitest';
import { generatePreSegmentedHTML } from './pre-segment.js';
import { generateHTML, SIZES } from './generate.js';
import { segmentAndWrap, splitKanjiKana } from '../../content.segmentation.js';
import { isJapanese, extractWord } from '../../scan-util.js';
import { domFromHTML } from '../lib/dom.js';

const HAN_RE = /[一-龯㐀-䶿]/;

/**
 * A fast stand-in for the real kuromoji tokenizer. Composed from the real,
 * already-exported splitKanjiKana (never hand-rolled) so kanji/kana run grouping
 * is identical to production. Kanji runs get a deliberately-diverging basic_form
 * plus a reading (exercising the data-lemma / data-reading "present" branches of
 * segmentAndWrap's contract); kana runs keep basic_form === surface_form and no
 * reading (exercising the "absent" branches) — so any generated page exercises
 * both sides of the "iff" contract in one call.
 */
function stubTokenize(text) {
  return splitKanjiKana(text).map((run) => (
    run.isKanji
      ? { surface_form: run.text, basic_form: `${run.text}ダ`, reading: 'テスト' }
      : { surface_form: run.text, basic_form: run.text, reading: undefined }
  ));
}

describe('generatePreSegmentedHTML — span shape matches segmentAndWrap contract', () => {
  it('T-44-009 dense-variant spans carry textContent===surface_form and data-lemma/data-reading exactly per the real contract', () => {
    const html = generatePreSegmentedHTML(500, stubTokenize, { variant: 'dense' });
    const { body } = domFromHTML(html);
    const spans = Array.from(body.querySelectorAll('span'));

    expect(spans.length).toBeGreaterThan(0);

    let sawLemma = false;
    let sawReading = false;
    let sawKanaAbsent = false;

    for (const span of spans) {
      const text = span.textContent;
      const isHan = HAN_RE.test(text);

      if (isHan) {
        // Our stub always diverges basic_form for kanji runs, and never emits '*'.
        expect(span.dataset.lemma).toBe(`${text}ダ`);
        expect(span.dataset.reading).toBe('テスト');
        sawLemma = true;
        sawReading = true;
      } else {
        // Our stub never diverges basic_form or sets a reading for kana runs.
        expect(span.dataset.lemma).toBeUndefined();
        expect(span.dataset.reading).toBeUndefined();
        sawKanaAbsent = true;
      }
    }

    // Guard against a vacuous pass: the fixture must actually exercise both
    // the "present" and "absent" branches of the contract.
    expect(sawLemma).toBe(true);
    expect(sawReading).toBe(true);
    expect(sawKanaAbsent).toBe(true);
  });
});

describe('generatePreSegmentedHTML — idempotency', () => {
  it('T-44-010 re-running segmentAndWrap over the fixture inserts no additional spans', () => {
    // Confirms the fixture is genuinely in "already segmented" state — if it
    // weren't, a second pass would nest new spans inside the existing ones.
    const html = generatePreSegmentedHTML(500, stubTokenize, { variant: 'dense' });
    const { body } = domFromHTML(html);
    const spanCountBefore = body.querySelectorAll('span').length;
    const htmlBefore = body.innerHTML;

    const count = segmentAndWrap(body, isJapanese, stubTokenize);

    expect(body.querySelectorAll('span').length).toBe(spanCountBefore);
    expect(body.innerHTML).toBe(htmlBefore);
    expect(count).toBe(spanCountBefore);
  });
});

describe('generatePreSegmentedHTML — wide variant leaves pre-existing compounds untouched', () => {
  it('T-44-011 wide compounds are byte-unchanged and surrounding text gets newly segmented spans', () => {
    // The central risk this issue calls out: synthetic wide compounds have no
    // kuromoji dictionary entry, so running them through a real tokenizer would
    // shred each one into single-character UNK tokens. isWordSpan's
    // pre-existing-span skip must leave them alone while still segmenting the
    // surrounding particle/verb/adjective text normally.
    const rawHTML = generateHTML(500, { variant: 'wide' });
    const rawSpans = Array.from(domFromHTML(rawHTML).body.querySelectorAll('span')).map((s) => s.outerHTML);

    const preSegHTML = generatePreSegmentedHTML(500, stubTokenize, { variant: 'wide' });
    const preSegBody = domFromHTML(preSegHTML).body;
    const preSegSpans = Array.from(preSegBody.querySelectorAll('span'));
    const preSegOuterHTMLs = new Set(preSegSpans.map((s) => s.outerHTML));

    expect(rawSpans.length).toBeGreaterThan(0);
    for (const original of rawSpans) {
      expect(preSegOuterHTMLs.has(original)).toBe(true);
    }

    // New spans must also exist for the surrounding text that raw
    // generateHTML('wide') deliberately leaves unwrapped as plain text.
    expect(preSegSpans.length).toBeGreaterThan(rawSpans.length);
  });
});

// ---------------------------------------------------------------------------
// Slice 11 — Tier-2 wide-page scaling (T-44-137/138/141/142, AC 16/17/20/21)
//
// scanPage's live cost is driven by two independent dimensions: total <span>
// count (O(spans) DOM walk + extractWord) and distinct lookup-word count (size
// of the two AnkiConnect round trips). These tests prove both dimensions
// strictly scale with token count on the wide-variant pre-segmented fixture,
// and that the shape/idempotency contracts established at small scale
// (T-44-009/010) still hold when the fixture is generated at Tier-2 sizes up
// to SIZES.XL (50,000 tokens).
// ---------------------------------------------------------------------------

describe('generatePreSegmentedHTML — wide-variant total span count scales with token count', () => {
  it('T-44-137 total <span> count strictly increases across SIZES.S/M/L/XL for the wide variant', () => {
    const counts = [SIZES.S, SIZES.M, SIZES.L, SIZES.XL].map((size) => {
      const html = generatePreSegmentedHTML(size, stubTokenize, { variant: 'wide' });
      const { body } = domFromHTML(html);
      return body.querySelectorAll('span').length;
    });

    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThan(counts[i - 1]);
    }
  }, 30_000);
});

describe('generatePreSegmentedHTML — wide-variant distinct lookup-word count scales with token count', () => {
  it('T-44-138 distinct lookup-word count strictly increases across SIZES.S/M/L/XL for the wide variant', () => {
    const distinctCounts = [SIZES.S, SIZES.M, SIZES.L, SIZES.XL].map((size) => {
      const html = generatePreSegmentedHTML(size, stubTokenize, { variant: 'wide' });
      const { body } = domFromHTML(html);
      const spans = Array.from(body.querySelectorAll('span'));
      // Mirrors scanPage's own lookup-word derivation: prefer the segmented
      // data-lemma, fall back to the visible text via the real extractWord,
      // and only count words scanPage itself would treat as Japanese.
      const lookupWords = spans
        .map((span) => span.dataset.lemma || extractWord(span))
        .filter((word) => isJapanese(word));
      return new Set(lookupWords).size;
    });

    for (let i = 1; i < distinctCounts.length; i++) {
      expect(distinctCounts[i]).toBeGreaterThan(distinctCounts[i - 1]);
    }
  }, 30_000);
});

describe('generatePreSegmentedHTML — span shape matches segmentAndWrap contract at XL wide scale', () => {
  it('T-44-141 every newly-segmented span at SIZES.XL wide scale carries textContent===surface_form and data-lemma/data-reading exactly per the real contract', () => {
    // Wide-variant compounds are pre-existing spans (isWordSpan's skip logic,
    // proven at small scale by T-44-011) and are never fed through tokenize, so
    // they legitimately carry no data-lemma/data-reading regardless of Han
    // content — they are excluded here the same way T-44-011 identifies them
    // (byte-match against the raw, un-segmented wide page), so this test
    // applies T-44-009's exact per-span contract check only to the spans
    // segmentAndWrap actually created, proving the contract-check doesn't
    // break at Tier-2 (50,000 token) scale.
    const rawHTML = generateHTML(SIZES.XL, { variant: 'wide' });
    const rawSpanOuterHTMLs = new Set(
      Array.from(domFromHTML(rawHTML).body.querySelectorAll('span')).map((s) => s.outerHTML)
    );

    const html = generatePreSegmentedHTML(SIZES.XL, stubTokenize, { variant: 'wide' });
    const { body } = domFromHTML(html);
    const allSpans = Array.from(body.querySelectorAll('span'));
    const newlySegmentedSpans = allSpans.filter((s) => !rawSpanOuterHTMLs.has(s.outerHTML));

    expect(allSpans.length).toBeGreaterThan(0);
    expect(newlySegmentedSpans.length).toBeGreaterThan(0);

    let sawLemma = false;
    let sawReading = false;
    let sawKanaAbsent = false;

    for (const span of newlySegmentedSpans) {
      const text = span.textContent;
      const isHan = HAN_RE.test(text);

      if (isHan) {
        expect(span.dataset.lemma).toBe(`${text}ダ`);
        expect(span.dataset.reading).toBe('テスト');
        sawLemma = true;
        sawReading = true;
      } else {
        expect(span.dataset.lemma).toBeUndefined();
        expect(span.dataset.reading).toBeUndefined();
        sawKanaAbsent = true;
      }
    }

    expect(sawLemma).toBe(true);
    expect(sawReading).toBe(true);
    expect(sawKanaAbsent).toBe(true);
  }, 30_000);
});

describe('generatePreSegmentedHTML — idempotency at XL wide scale', () => {
  it('T-44-142 re-running segmentAndWrap over the wide-variant XL fixture inserts no additional spans', () => {
    // Mirrors T-44-010's idempotency check exactly, at Tier-2 (SIZES.XL,
    // 50,000 token) scale with the wide variant instead of dense.
    const html = generatePreSegmentedHTML(SIZES.XL, stubTokenize, { variant: 'wide' });
    const { body } = domFromHTML(html);
    const spanCountBefore = body.querySelectorAll('span').length;
    const htmlBefore = body.innerHTML;

    const count = segmentAndWrap(body, isJapanese, stubTokenize);

    expect(body.querySelectorAll('span').length).toBe(spanCountBefore);
    expect(body.innerHTML).toBe(htmlBefore);
    expect(count).toBe(spanCountBefore);
  }, 30_000);
});
