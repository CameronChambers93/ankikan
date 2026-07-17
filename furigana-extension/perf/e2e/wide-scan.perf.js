/**
 * Tier-2 Playwright perf harness — wide-page SCAN scenario (issue #44,
 * Slice 11 + Slice 12).
 *
 * Proves `scanPage` scales against a realistic wide-vocabulary page at Tier-2
 * size: a large total `<span>` count (O(spans) DOM-walk + `extractWord`)
 * combined with a large *distinct*-lookup-word count (the two live
 * AnkiConnect round trips `findCards`/`cardsInfo`, sized by unique words).
 *
 * KEY DESIGN DIFFERENCE from browser-smoke.perf.js/stress.perf.js/longtask.perf.js:
 * this scenario needs NO kuromoji dict-seed and NO `lemmaMode:'local'`.
 * `content.js`'s default settings (`lemmaMode: null`) resolve via
 * `resolveLemmaMode` to `'off'`, so `segmentAndWrap` never runs client-side —
 * the extension calls `scanPage` directly against whatever `<span>` markup the
 * served page already contains. This file serves a Node-built
 * `generatePreSegmentedHTML(…, {variant:'wide'})` page (exactly what
 * `build-fixtures.js` produces for `.presegmented.html`), giving full-scale
 * DOM-walk + live-AnkiConnect payload stress with none of the ~15-20s
 * dict-seed cost the other Tier-2 files pay. There is deliberately no popup
 * open, no `clearStorage`/`seedStorage` call, and no `seedKuromojiDict` call
 * here — that is the load-bearing absence, not an oversight.
 *
 * SLICE 12 ADDITION (AC-27...31): a SECOND live browser size (`SIZES.S`) is
 * captured in the SAME run, confirming the wide-page scaling claim live at
 * two sizes rather than one. `wideVocabulary` is seed-prefix-consistent (a
 * smaller size's vocabulary is always a strict prefix of a larger size's), so
 * the already-seeded `AnkiKan-Perf` deck (sized for SIZES.L) is a superset of
 * SIZES.S's vocabulary too — the second capture reuses the SAME seeded deck,
 * no second reseed. The second capture opens a second page in the SAME
 * `browserContext`, closing it once its measures are read.
 *
 * PREREQUISITES:
 *   - Anki must be running with AnkiConnect on localhost:8765 (port OCCUPIED).
 *   - NO pre-seeded deck is required beyond what this file seeds itself: the
 *     shared `beforeAll` reseeds the dedicated "AnkiKan-Perf" deck (reset-then-
 *     seed idempotent, per Slice 10's `seedAnkiPerfDeck`) at SIZES.L scale —
 *     distinct from "AnkiKan-E2E", never touched here.
 *   - The extension must be built (`pnpm run build`) — Chromium loads dist/,
 *     not source.
 *
 * Run with:
 *   pnpm exec playwright test --config=perf/playwright.perf.config.js wide-scan
 *
 * PERFORMANCE NOTE: all nine tests below share ONE expensive `beforeAll`
 * (live-Anki reseed of ~2,310 notes + real kuromoji tokenizer build + Node-side
 * fixture generation for TWO sizes + extension launch + two scans against two
 * pages in the same context), captured ONCE into module-scope variables. Each
 * `test()` then asserts a single facet of that shared capture — the Slice
 * 4/5/7 "one expensive shared setup, several facet tests" pattern.
 */

import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

import { PERF_NAMES } from '../../content.timing.js';
import { computeDeckPlan, seedAnkiPerfDeck } from '../setup-anki-perf.js';
import { wideVocabulary, wideVocabSize } from '../fixtures/wide-vocab.js';
import { SIZES } from '../fixtures/generate.js';
import { generatePreSegmentedHTML } from '../fixtures/pre-segment.js';
import { getTokenizer } from '../lib/tokenizer.js';
import { domFromHTML } from '../lib/dom.js';
import { extractWord, isJapanese } from '../../scan-util.js';
import { assembleWideScanResult } from './lib/perf-results.js';
import { writeResults, defaultIo } from '../lib/write-results.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// perf/e2e/ -> furigana-extension root (two levels up).
const EXTENSION_PATH = path.resolve(__dirname, '../..');
const FIXTURE_URL = 'http://test-wide-scan.local/';
const FIXTURE_URL_SECOND = 'http://test-wide-scan-s.local/';

// Real, non-fabricated plan built from the actual exported planning functions
// (Slice 10's exact seeding computation) — module scope, pure, so both the
// beforeAll reseed and T-44-146's pre-proven anki-unknown/anki-duplicate
// expectations read from the identical plan.
const plan = computeDeckPlan(wideVocabulary(wideVocabSize(SIZES.L)));

/**
 * Node-side ground truth for scanPage's distinct-lookup-word count: dedupes by
 * `data-lemma` when present (mirroring `scanPage`'s own lookup-word
 * resolution), falling back to the real `extractWord` span text, and drops
 * any non-Japanese result — the same real helpers `scanPage` itself uses, so
 * this is a faithful Node-side prediction of the live AnkiConnect payload
 * size, not a reimplementation of `scanPage`.
 * @param {HTMLElement} body
 * @returns {number}
 */
function countDistinctLookupWords(body) {
  return new Set(
    [...body.querySelectorAll('span')]
      .map((s) => s.dataset.lemma || extractWord(s))
      .filter(isJapanese),
  ).size;
}

// ---------------------------------------------------------------------------
// Shared state: one browser context, one page, one scan, captured once.
// ---------------------------------------------------------------------------

let browserContext;
let page;

/** Node-computed expected total <span> count for the served fixture (ground truth). */
let expectedSpanCount = 0;
/** Live DOM total <span> count read back from the page after the scan. */
let liveSpanCount = 0;
/** Every measure name on the shared main-world timeline. */
let allMeasureNames = [];
/**
 * The `ankikan:`-namespaced measures read from the page's MAIN world.
 * @type {Array<{name: string, duration: number}>}
 */
let ankikanMeasures = [];
/** @type {{ matched: boolean, unknown: boolean, duplicate: boolean }} */
let statusFlags = { matched: false, unknown: false, duplicate: false };

/** Slice 12: Node-computed expected total <span> count for the SIZES.S fixture. */
let expectedSpanCountSecond = 0;
/** Slice 12: live DOM total <span> count read back from the second page's scan. */
let liveSpanCountSecond = 0;
/** Slice 12: every measure name on the second page's main-world timeline. */
let allMeasureNamesSecond = [];
/**
 * Slice 12: the `ankikan:`-namespaced measures read from the second page's
 * MAIN world.
 * @type {Array<{name: string, duration: number}>}
 */
let ankikanMeasuresSecond = [];
/** Slice 12: Node-computed distinct-lookup-word count for the SIZES.L fixture. */
let expectedDistinctWordCountL = 0;
/** Slice 12: Node-computed distinct-lookup-word count for the SIZES.S fixture. */
let expectedDistinctWordCountSecond = 0;

test.describe.serial('wide-scan perf harness (issue #44 AC-23...31)', () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(async () => {
    // A live reseed of ~2,310 notes plus a real kuromoji tokenizer build and
    // an XL-scale (SIZES.L) tokenize pass is slow — give the hook itself the
    // same generous budget as the describe block.
    test.setTimeout(120_000);

    // Reseed AnkiKan-Perf (reset-then-seed idempotent, so a redundant call
    // from a prior run is cheap-and-correct regardless of file execution
    // order) and build the real Node-side kuromoji tokenizer, in parallel.
    const [, tokenizer] = await Promise.all([
      seedAnkiPerfDeck(plan),
      getTokenizer(),
    ]);

    // Build the pre-segmented wide-variant fixture in Node with the real
    // tokenizer — exactly what build-fixtures.js produces for
    // .presegmented.html — and count its expected spans by parsing (not
    // regexing) the HTML, giving a ground-truth number to check the live DOM
    // against below.
    const fixtureHTML = generatePreSegmentedHTML(
      SIZES.L,
      tokenizer.tokenize.bind(tokenizer),
      { variant: 'wide' },
    );
    const { body } = domFromHTML(fixtureHTML);
    expectedSpanCount = body.querySelectorAll('span').length;
    expectedDistinctWordCountL = countDistinctLookupWords(body);

    browserContext = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });

    // Ensure the service worker is up before navigating.
    if (!browserContext.serviceWorkers().length) {
      await browserContext.waitForEvent('serviceworker');
    }

    // Deliberately NO popup / clearStorage / seedStorage / seedKuromojiDict
    // call here: default chrome.storage.local resolves lemmaMode to 'off', so
    // segmentAndWrap never runs client-side and scanPage operates directly on
    // the already-segmented markup this fixture serves.
    page = await browserContext.newPage();

    await page.route(FIXTURE_URL, (route) =>
      route.fulfill({ contentType: 'text/html', body: fixtureHTML }),
    );
    await page.goto(FIXTURE_URL);

    // Scan complete once the first anki-* class lands on the page. Generous
    // timeout: a single `multi` call embedding ~2,854 findCards sub-queries
    // against live AnkiConnect is untested at this scale (see plan risks).
    await page.locator('[class*="anki-"]').first().waitFor({ timeout: 90_000 });

    // Capture everything ONCE from the page's MAIN world — every test below
    // asserts against these module-scope snapshots rather than re-running the
    // scan.
    allMeasureNames = await page.evaluate(() =>
      performance.getEntriesByType('measure').map((m) => m.name),
    );
    ankikanMeasures = await page.evaluate(() =>
      performance
        .getEntriesByType('measure')
        .filter((m) => m.name.startsWith('ankikan:'))
        .map((m) => ({ name: m.name, duration: m.duration })),
    );
    liveSpanCount = await page.evaluate(() => document.querySelectorAll('span').length);
    statusFlags = await page.evaluate(() => ({
      matched: document.querySelectorAll('.anki-unlearned, .anki-learning, .anki-learned').length > 0,
      unknown: document.querySelectorAll('.anki-unknown').length > 0,
      duplicate: document.querySelectorAll('.anki-duplicate').length > 0,
    }));

    await writeResults(assembleWideScanResult(ankikanMeasures), {
      resultsDir: path.join(__dirname, '..', 'results'),
      prefix: 'wide-scan',
      io: defaultIo,
    });

    // -------------------------------------------------------------------
    // Slice 12 (AC-27...31): a SECOND live size, in the SAME run, against
    // the SAME already-seeded AnkiKan-Perf deck. `wideVocabulary` is
    // seed-prefix-consistent, so SIZES.S's vocabulary is a strict prefix of
    // SIZES.L's — the deck seeded above (sized for SIZES.L) is already a
    // superset of SIZES.S's vocabulary, so NO reseed is needed here.
    // -------------------------------------------------------------------
    const fixtureHTMLSecond = generatePreSegmentedHTML(
      SIZES.S,
      tokenizer.tokenize.bind(tokenizer),
      { variant: 'wide' },
    );
    const { body: bodySecond } = domFromHTML(fixtureHTMLSecond);
    expectedSpanCountSecond = bodySecond.querySelectorAll('span').length;
    expectedDistinctWordCountSecond = countDistinctLookupWords(bodySecond);

    const pageSecond = await browserContext.newPage();

    await pageSecond.route(FIXTURE_URL_SECOND, (route) =>
      route.fulfill({ contentType: 'text/html', body: fixtureHTMLSecond }),
    );
    await pageSecond.goto(FIXTURE_URL_SECOND);

    await pageSecond.locator('[class*="anki-"]').first().waitFor({ timeout: 90_000 });

    allMeasureNamesSecond = await pageSecond.evaluate(() =>
      performance.getEntriesByType('measure').map((m) => m.name),
    );
    ankikanMeasuresSecond = await pageSecond.evaluate(() =>
      performance
        .getEntriesByType('measure')
        .filter((m) => m.name.startsWith('ankikan:'))
        .map((m) => ({ name: m.name, duration: m.duration })),
    );
    liveSpanCountSecond = await pageSecond.evaluate(() => document.querySelectorAll('span').length);

    await pageSecond.close();

    await writeResults(assembleWideScanResult(ankikanMeasuresSecond, { size: 'S' }), {
      resultsDir: path.join(__dirname, '..', 'results'),
      prefix: 'wide-scan-s',
      io: defaultIo,
    });
  });

  test.afterAll(async () => {
    await browserContext?.close();
  });

  test('T-44-144 live span count exactly matches the Node-computed expected span count and exceeds 5000 (AC-23)', async () => {
    // The Node-side count (parsed via domFromHTML, not a regex) is ground
    // truth for what the fixture actually contains; the live DOM count must
    // match it exactly — proving scanPage didn't drop or duplicate spans —
    // and exceed 5000, the Tier-2 scale threshold this slice targets.
    expect(liveSpanCount).toBe(expectedSpanCount);
    expect(liveSpanCount).toBeGreaterThan(5000);
  });

  test('T-44-145 t_anki_findcards/t_anki_cardsinfo/t_dom_inject/t_total are all present and t_segment is absent (AC-24)', async () => {
    // segmentAndWrap never runs (lemmaMode resolves to 'off' with no
    // dict-seed), so ankikan:t_segment must never appear on this timeline —
    // the four remaining phase measures must all still fire.
    expect(allMeasureNames).toContain(PERF_NAMES.ANKI_FINDCARDS);
    expect(allMeasureNames).toContain(PERF_NAMES.ANKI_CARDSINFO);
    expect(allMeasureNames).toContain(PERF_NAMES.DOM_INJECT);
    expect(allMeasureNames).toContain(PERF_NAMES.TOTAL);
    expect(allMeasureNames).not.toContain(PERF_NAMES.SEGMENT);
  });

  test('T-44-146 the scan exercises all three status outcomes: matched, anki-unknown, and anki-duplicate (AC-25)', async () => {
    // Pre-proven in Vitest (T-44-139/140): the wide-L page's distinct
    // span-text count strictly exceeds computeDeckPlan's matchedCount (so
    // anki-unknown must fire), and every duplicate-note expression is a
    // member of the page's distinct span-text set (so anki-duplicate must
    // fire). This test is the live confirmation that both pre-proofs hold in
    // a real browser against real AnkiConnect, alongside at least one
    // deck-matched status.
    expect(statusFlags.matched).toBe(true);
    expect(statusFlags.unknown).toBe(true);
    expect(statusFlags.duplicate).toBe(true);
  });

  test('T-44-147 every captured measure has a finite duration >= 0, and ankikan:t_total duration is strictly > 0 (AC-26)', async () => {
    // The "resolves within timeout" facet of AC-26 is enforced by beforeAll
    // completing at all (see the 90s scan-wait / 120s describe timeout above).
    expect(ankikanMeasures.length).toBeGreaterThan(0);

    for (const measure of ankikanMeasures) {
      expect(Number.isFinite(measure.duration)).toBe(true);
      expect(measure.duration).toBeGreaterThanOrEqual(0);
    }

    const total = ankikanMeasures.find((m) => m.name === PERF_NAMES.TOTAL);
    expect(total).toBeTruthy();
    expect(total.duration).toBeGreaterThan(0);
  });

  test('T-44-148 the second live size (SIZES.S) span count exactly matches its Node-computed expected span count (AC-27)', async () => {
    // Same ground-truth proof as T-44-144, at the second size: the live DOM
    // count must match the Node-parsed count exactly, so scanPage's
    // no-drop/no-duplicate guarantee is confirmed at BOTH sizes in this run,
    // not just at L.
    expect(liveSpanCountSecond).toBe(expectedSpanCountSecond);
  });

  test('T-44-149 the L-size live span count is strictly greater than the second (S) size live span count (AC-28)', async () => {
    // Direction-only check that the wide-page scaling claim holds live: a
    // larger requested size must actually produce a larger live span count.
    expect(liveSpanCount).toBeGreaterThan(liveSpanCountSecond);
  });

  test('T-44-150 at the second size, the four phase measures are present and t_segment is absent (AC-29)', async () => {
    // Mirrors T-44-145 at the second size: the "no dict-seed needed" design
    // (lemmaMode resolves to 'off') must hold regardless of page size.
    expect(allMeasureNamesSecond).toContain(PERF_NAMES.ANKI_FINDCARDS);
    expect(allMeasureNamesSecond).toContain(PERF_NAMES.ANKI_CARDSINFO);
    expect(allMeasureNamesSecond).toContain(PERF_NAMES.DOM_INJECT);
    expect(allMeasureNamesSecond).toContain(PERF_NAMES.TOTAL);
    expect(allMeasureNamesSecond).not.toContain(PERF_NAMES.SEGMENT);
  });

  test('T-44-151 the L-size DOM-inject and total durations are each >= the second (S) size durations (AC-30)', async () => {
    // Direction/`>=` only, NEVER an absolute-ms threshold or strict `>`:
    // hardware/JIT variance across a single CI run can make two timings of a
    // small page nearly identical, or occasionally even edge past a larger
    // page's timing on a noisy run for a near-zero-cost phase; `>=` is the
    // scaling claim this slice can honestly stand behind.
    for (const name of [PERF_NAMES.DOM_INJECT, PERF_NAMES.TOTAL]) {
      const measureL = ankikanMeasures.find((m) => m.name === name);
      const measureSecond = ankikanMeasuresSecond.find((m) => m.name === name);
      expect(measureL).toBeTruthy();
      expect(measureSecond).toBeTruthy();
      expect(measureL.duration).toBeGreaterThanOrEqual(measureSecond.duration);
    }
  });

  test('T-44-152 the L-size distinct-lookup-word count is strictly greater than the second (S) size count (AC-31)', async () => {
    // A deterministic, Node-computed payload-scaling guard, decoupled from
    // network timing: the number of DISTINCT words scanPage sends to
    // AnkiConnect (the actual driver of findCards/cardsInfo payload size)
    // must strictly grow with page size, independent of any live duration
    // measurement's variance.
    expect(expectedDistinctWordCountL).toBeGreaterThan(expectedDistinctWordCountSecond);
  });
});
