/**
 * Unit tests for content.timing.js — performance instrumentation helper (issue #44,
 * Deliverable 3: performance instrumentation).
 *
 * content.timing.js does not exist yet; the import below is intentionally
 * unresolvable so every test in this file starts red with a module-not-found
 * error until the implementation is created.
 *
 * markStart(name) / markEnd(name) wrap the browser Performance API
 * (performance.mark / performance.measure) with two guarantees:
 *   1. clear-and-overwrite — at most one measure ever exists per name, even
 *      across repeated start/end cycles.
 *   2. no-op-safety — if `performance` is absent, or its mark/measure throw,
 *      the helper swallows the failure and never lets it reach the caller.
 *
 * PERF_NAMES is a frozen object of the five canonical performance-entry names
 * used across the extension's instrumentation call sites.
 *
 * Tests use the real Node/jsdom Performance API (mark/measure/clearMarks/
 * clearMeasures/getEntriesByName/getEntriesByType) exposed as the global
 * `performance` under vitest's jsdom environment — no live network I/O is
 * involved, so nothing here needs mocking beyond the deliberately "broken"
 * fake performance object used for the no-op-safety tests (AC-52).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { markStart, markEnd, PERF_NAMES } from './content.timing.js';
import { segmentAndWrap } from './content.segmentation.js';
import { scanPage } from './scan-util.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return a real isJapanese predicate identical to content.js's, for segmentAndWrap. */
function isJapanese(word) {
  return /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(word);
}

/** Build a minimal JSDOM document with one or more span elements. */
function makeDoc(bodyHtml) {
  return new JSDOM(`<!DOCTYPE html><body>${bodyHtml}</body></html>`).window.document;
}

/** Build a real JSDOM root <div> from an HTML fragment for segmentAndWrap. */
function makeRoot(html) {
  document.body.innerHTML = html;
  return document.body;
}

const baseSettings = {
  fieldName: 'Expression',
  furiganaGlobal: true,
  furiganaUnlearned: true,
  furiganaLearning: true,
  furiganaLearned: true,
  furiganaUnknown: true,
  lemmaMode: 'off',
  useLemma: false,
};

// Cross-test isolation: the performance timeline is a shared global. Clear
// marks/measures before and after every test so leftovers from clear-and-
// overwrite semantics never leak into a neighbouring test's assertions.
beforeEach(() => {
  performance.clearMarks();
  performance.clearMeasures();
});

afterEach(() => {
  // Restore the real `performance` binding FIRST: AC-51/AC-52 tests leave it
  // stubbed to undefined / a throwing fake, so clearing marks before unstubbing
  // would crash teardown and leak the stub into the next test's beforeEach.
  vi.unstubAllGlobals();
  performance.clearMarks();
  performance.clearMeasures();
});

// ---------------------------------------------------------------------------
// PERF_NAMES — canonical name table
// ---------------------------------------------------------------------------

describe('PERF_NAMES', () => {
  it('T-44-058 is frozen and exposes exactly the five canonical performance-entry names', () => {
    // Downstream call sites (segmentAndWrap, scanPage) reference PERF_NAMES.*
    // by key; any renaming or mutation here would silently desynchronise the
    // marks recorded from the marks asserted on in tests and dashboards.
    expect(Object.isFrozen(PERF_NAMES)).toBe(true);
    expect(PERF_NAMES).toEqual({
      SEGMENT: 'ankikan:t_segment',
      DOM_INJECT: 'ankikan:t_dom_inject',
      ANKI_FINDCARDS: 'ankikan:t_anki_findcards',
      ANKI_CARDSINFO: 'ankikan:t_anki_cardsinfo',
      TOTAL: 'ankikan:t_total',
    });
  });
});

// ---------------------------------------------------------------------------
// markStart / markEnd — base contract (direct unit tests of the helper)
// ---------------------------------------------------------------------------

describe('markStart / markEnd — base contract', () => {
  it('T-44-055 markStart(name) records exactly one performance mark named "<name>:start"', () => {
    markStart('probe');
    const marks = performance.getEntriesByName('probe:start', 'mark');
    expect(marks.length).toBe(1);
  });

  it('T-44-056 markEnd(name) after markStart records exactly one measure named "<name>" with duration >= 0', () => {
    markStart('probe');
    markEnd('probe');
    const measures = performance.getEntriesByName('probe', 'measure');
    expect(measures.length).toBe(1);
    expect(measures[0].duration).toBeGreaterThanOrEqual(0);
  });

  it('T-44-057 a second markStart/markEnd cycle for the same name still yields exactly one measure (clear-and-overwrite)', () => {
    // Tested directly against the helper (not through a segmentAndWrap/scanPage
    // call site) to lock down the clear-and-overwrite contract at its source.
    markStart('probe');
    markEnd('probe');
    markStart('probe');
    markEnd('probe');
    const measures = performance.getEntriesByName('probe', 'measure');
    expect(measures.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC-51 (T-44-051): performance absent — real call sites survive
// ---------------------------------------------------------------------------

describe('markStart / markEnd — AC-51: performance is absent globally', () => {
  it('T-44-051 segmentAndWrap and scanPage complete and return correct shapes when performance is undefined', async () => {
    // Build DOM fixtures BEFORE stubbing performance away: jsdom's Window
    // constructor (inside makeDoc's `new JSDOM`) reads performance.now, so it
    // must run while the real global is still present. The no-op-safety under
    // test concerns the function calls, not fixture construction.
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: '日本語', basic_form: '日本語' },
    ]);
    const root = makeRoot('<p>日本語</p>');
    const doc = makeDoc('<span>勉強</span>');
    const ankiRequest = vi.fn().mockResolvedValue({ result: [[]], error: null });
    const fetchLemmas = vi.fn().mockResolvedValue({});

    vi.stubGlobal('performance', undefined);

    // segmentAndWrap must still wrap tokens and return the correct count.
    let segCount;
    expect(() => {
      segCount = segmentAndWrap(root, isJapanese, tokenize);
    }).not.toThrow();
    expect(segCount).toBe(1);
    expect(root.querySelector('span').textContent).toBe('日本語');

    // scanPage must still resolve its normal { found, matched } contract.
    let result;
    await expect(
      (async () => {
        result = await scanPage(baseSettings, { ankiRequest, fetchLemmas, doc });
      })(),
    ).resolves.not.toThrow();

    expect(result).toEqual({ found: 1, matched: 0 });
  });
});

// ---------------------------------------------------------------------------
// AC-52 (T-44-052): mark/measure throw — no-op-safe, caller unaffected
// ---------------------------------------------------------------------------

describe('markStart / markEnd — AC-52: performance.mark/measure throw', () => {
  /** A performance stand-in whose mark/measure always throw, to prove swallowing. */
  function makeThrowingPerformance() {
    return {
      mark: vi.fn(() => {
        throw new Error('mark blocked');
      }),
      measure: vi.fn(() => {
        throw new Error('measure blocked');
      }),
      clearMarks: vi.fn(),
      clearMeasures: vi.fn(),
      getEntriesByName: vi.fn(() => []),
      getEntriesByType: vi.fn(() => []),
    };
  }

  it('T-44-052 markStart/markEnd called directly swallow throwing mark/measure without propagating', () => {
    vi.stubGlobal('performance', makeThrowingPerformance());
    expect(() => markStart('probe')).not.toThrow();
    expect(() => markEnd('probe')).not.toThrow();
  });

  it('T-44-052 segmentAndWrap completes normally when the injected performance throws on mark/measure', () => {
    vi.stubGlobal('performance', makeThrowingPerformance());
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: '勉強', basic_form: '勉強' },
    ]);
    const root = makeRoot('<p>勉強</p>');
    let count;
    expect(() => {
      count = segmentAndWrap(root, isJapanese, tokenize);
    }).not.toThrow();
    expect(count).toBe(1);
    expect(root.querySelector('span').textContent).toBe('勉強');
  });

  it('T-44-052 scanPage resolves its normal contract when the injected performance throws on mark/measure', async () => {
    // Build the DOM fixture before installing the throwing stub — jsdom's Window
    // constructor reads performance.now during `new JSDOM`, so makeDoc must run
    // while the real performance global is still in place.
    const doc = makeDoc('<span>日本語</span>');
    const ankiRequest = vi.fn()
      .mockResolvedValueOnce({ result: [[42]], error: null })
      .mockResolvedValueOnce({ result: [{ cardId: 42, type: 2 }], error: null });
    const fetchLemmas = vi.fn().mockResolvedValue({});

    vi.stubGlobal('performance', makeThrowingPerformance());

    const result = await scanPage(baseSettings, { ankiRequest, fetchLemmas, doc });

    expect(result).toEqual({ found: 1, matched: 1 });
    const span = doc.querySelector('span');
    expect(span.classList.contains('anki-learned')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-53 (T-44-053): all recorded measure names are namespaced under "ankikan:"
// ---------------------------------------------------------------------------

describe('markStart / markEnd — AC-53: every recorded measure is namespaced under "ankikan:"', () => {
  it('T-44-053 a full segmentAndWrap + scanPage run records only "ankikan:"-prefixed measures', async () => {
    const tokenize = vi.fn().mockReturnValue([
      { surface_form: '日本語', basic_form: '日本語' },
    ]);
    const root = makeRoot('<p>日本語</p>');
    segmentAndWrap(root, isJapanese, tokenize);

    const doc = makeDoc('<span>日本語</span>');
    const ankiRequest = vi.fn()
      .mockResolvedValueOnce({ result: [[42]], error: null })
      .mockResolvedValueOnce({ result: [{ cardId: 42, type: 2 }], error: null });
    const fetchLemmas = vi.fn().mockResolvedValue({});
    await scanPage(baseSettings, { ankiRequest, fetchLemmas, doc });

    const measures = performance.getEntriesByType('measure');
    expect(measures.length).toBeGreaterThan(0);
    for (const m of measures) {
      expect(m.name.startsWith('ankikan:')).toBe(true);
    }
  });
});
