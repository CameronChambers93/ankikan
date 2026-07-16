/**
 * Tier-3 Stress Playwright harness (issue #44 Slice 5 — AC-60..66).
 *
 * Exercises the already-shipped MutationObserver re-segmentation (issue #18),
 * manual re-scan (issue #22), and instrumentation (`content.timing.js`) code
 * paths under sustained load, not single-shot happy-path load — this is what
 * distinguishes "Tier-3 Stress" from the Tier-2 `browser-smoke.perf.js`
 * single-scan harness it mirrors the setup of. Three scenarios:
 *
 *   (a) infinite-scroll churn      — burst + spaced DOM injections into an
 *                                    initially-empty page (T-44-066/067/068)
 *   (b) SPA re-navigation          — repeated remove/inject cycles, watching
 *                                    for unbounded DOM/heap growth (T-44-071/072)
 *   (c) idempotent re-scan         — repeated manual `{action:'scan'}` calls
 *                                    against an already-annotated page, which
 *                                    must add nothing new (T-44-069/070)
 *
 * PREREQUISITES (same as browser-smoke.perf.js):
 *   - Anki must be running with AnkiConnect on localhost:8765 (port OCCUPIED).
 *   - The "AnkiKan-E2E" deck must exist (node e2e/setup-anki-e2e.js), with
 *     けが (unlearned), アニメ (learning), 日本語 (learned).
 *   - The extension must be built (`pnpm run build`) — Chromium loads dist/,
 *     not source.
 *
 * This is a MANUAL / occasional-run suite, not a per-commit gate — it drives
 * real AnkiConnect round trips and real kuromoji tokenization repeatedly
 * (dozens of live network calls across the file), which is too slow and too
 * environment-dependent for CI. Run explicitly via:
 *
 *   pnpm run build && pnpm run perf:e2e
 *
 * or, to run only this file:
 *
 *   pnpm exec playwright test --config=perf/playwright.perf.config.js perf/e2e/stress.perf.js
 */

import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

import { PERF_NAMES } from '../../content.timing.js';
import { stats } from '../lib/bench.js';
import { generateBrowserSmokeHTML } from '../fixtures/browser-smoke.js';
import { readKuromojiDictFilesBase64, seedKuromojiDict } from './lib/dict-seed.js';
import { assembleStressResult } from './lib/perf-results.js';
import { writeResults, defaultIo } from '../lib/write-results.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// perf/e2e/ -> furigana-extension root (two levels up).
const EXTENSION_PATH = path.resolve(__dirname, '../..');

// The three AnkiKan-E2E deck sentences (けが unlearned / アニメ learning /
// 日本語 learned) — sanctioned inline literal per the issue #44 Slice-5 plan,
// matching the exact strings in perf/fixtures/browser-smoke.js verbatim.
const SENTENCES = ['今日はけがをしました。', 'アニメを見るのが好きです。', '日本語を勉強しています。'];

// Empty-container fixture — the observer.e2e.js pattern. The page has NO
// initial Japanese text, so the initial segmentAndWrap/scanPage pass finds
// nothing and `startObserver` is already attached by the time we inject.
const EMPTY_FIXTURE_HTML = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>AnkiKan Stress E2E</title></head>
<body>
  <div id="container"></div>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Small popup/storage helpers, copied verbatim from the pattern shared by
// browser-smoke.perf.js / observer.e2e.js / manual-scan.e2e.js.
// ---------------------------------------------------------------------------

/** Opens popup.html at a known extensionId and returns the page. */
async function openPopup(browserContext, extId) {
  const popup = await browserContext.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  return popup;
}

/** Clears chrome.storage.local via an extension page. */
async function clearStorage(popup) {
  await popup.evaluate(() => new Promise((resolve) => chrome.storage.local.clear(resolve)));
}

/** Seeds chrome.storage.local via an extension page so values take effect for content scripts. */
async function seedStorage(popup, values) {
  await popup.evaluate(
    (vals) => new Promise((resolve) => chrome.storage.local.set(vals, resolve)),
    values,
  );
}

/**
 * Sends the manual-scan message via chrome.tabs.sendMessage from an
 * extension-origin popup context — the exact mechanism popup.js's #scanBtn
 * uses, reused verbatim from e2e/manual-scan.e2e.js.
 *
 * @param {import('@playwright/test').Page} popup
 * @param {string} testUrl
 */
async function sendManualScan(popup, testUrl) {
  return popup.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ url });
    if (!tabs.length) return { error: 'tab not found' };
    const tabId = tabs[0].id;
    try {
      return await chrome.tabs.sendMessage(tabId, { action: 'scan' });
    } catch (e) {
      return { error: String(e) };
    }
  }, testUrl);
}

// ---------------------------------------------------------------------------
// Local stress-harness helpers.
// ---------------------------------------------------------------------------

/**
 * Injects a single `<p data-iter="i">` containing `SENTENCES[i % 3]` into
 * `#container`. One round trip per call — used by the spaced-injection loops
 * (scenarios a/b) where each injection must be its own MutationObserver
 * mutation record, not batched with the others.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} i
 */
async function injectSentence(page, i) {
  await page.evaluate(
    ({ i, sentences }) => {
      const p = document.createElement('p');
      p.dataset.iter = String(i);
      p.textContent = sentences[i % sentences.length];
      document.getElementById('container').appendChild(p);
    },
    { i, sentences: SENTENCES },
  );
}

/**
 * Waits for the container with `data-iter="i"` to contain at least one
 * `anki-*`-classed span — proof that the debounced MutationObserver flush
 * (segmentAndWrap + scanPage) has fully settled for that container.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} i
 * @param {number} [timeoutMs]
 */
async function waitForContainerAnnotated(page, i, timeoutMs = 20_000) {
  await page.locator(`[data-iter="${i}"] [class*="anki-"]`).first().waitFor({ timeout: timeoutMs });
}

/**
 * Reads the current duration of the named `performance.measure()` entry from
 * the page's main world. `content.timing.js`'s `markEnd` clears-and-overwrites
 * same-named measures on every call, so at most one entry is ever present —
 * this must be read immediately after a flush settles and before the next
 * mutation, or it will be overwritten by the next flush's measure.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 * @returns {Promise<number|undefined>}
 */
async function readMeasureDuration(page, name) {
  const durations = await page.evaluate(
    (n) => performance.getEntriesByName(n, 'measure').map((m) => m.duration),
    name,
  );
  return durations.length ? durations[durations.length - 1] : undefined;
}

/**
 * Counts `<span>` elements inside the container with `data-iter="i"`.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} i
 * @returns {Promise<number>}
 */
async function containerSpanCount(page, i) {
  return page.evaluate((iter) => document.querySelectorAll(`[data-iter="${iter}"] span`).length, i);
}

/**
 * Counts every live element node in the document — the coarse "did the DOM
 * grow" signal used by the SPA re-navigation and idempotent-re-scan scenarios.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
async function liveNodeCount(page) {
  return page.evaluate(() => document.querySelectorAll('*').length);
}

/**
 * Forces a GC pass via the CDP HeapProfiler domain, then reads JSHeapUsedSize
 * from the CDP Performance domain. `page.metrics()` is Puppeteer-only and
 * throws under Playwright — this CDP-session route is the correct substitute.
 *
 * @param {import('@playwright/test').CDPSession} session
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number|undefined>}
 */
async function sampleHeap(session, page) {
  await session.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(200); // defensive buffer for GC completion tail
  const { metrics } = await session.send('Performance.getMetrics');
  return metrics.find((m) => m.name === 'JSHeapUsedSize')?.value;
}

// ---------------------------------------------------------------------------
// File-level shared context: one extension launch, one storage seed, one dict
// seed — reused by all three scenarios below (each scenario opens its own
// page/fixture, since they need different HTML and different container ids).
// ---------------------------------------------------------------------------

let browserContext;
let extensionId;

// Module-scope accumulators for the Slice-9 stress result write-out — fed
// additively by each scenario below (which keep their own local arrays and
// assertions untouched) so the file-level afterAll can assemble one
// {meta, records} result from all three scenarios' captures.
/** @type {number[]} */
let stressScrollDurations = [];
/** @type {number[]} */
let stressRescanDurations = [];
/** @type {number[]} */
let stressHeapSamples = [];

test.beforeAll(async () => {
  test.setTimeout(90_000); // dict-seed alone can take ~15-20s (browser-smoke.perf.js note)

  browserContext = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  let [background] = browserContext.serviceWorkers();
  if (!background) background = await browserContext.waitForEvent('serviceworker');
  extensionId = background.url().split('/')[2];

  const popup = await openPopup(browserContext, extensionId);
  await clearStorage(popup);
  await seedStorage(popup, { lemmaMode: 'local' });

  const dictFiles = readKuromojiDictFilesBase64();
  await seedKuromojiDict(popup, dictFiles);
  await popup.close();
});

test.afterAll(async () => {
  await writeResults(
    assembleStressResult({
      scrollDurations: stressScrollDurations,
      rescanDurations: stressRescanDurations,
      heapSamples: stressHeapSamples,
    }),
    { resultsDir: path.join(__dirname, '..', 'results'), prefix: 'stress', io: defaultIo },
  );
  await browserContext?.close();
});

// ---------------------------------------------------------------------------
// Scenario (a) — infinite-scroll churn (AC-60/61/62)
//
// A page that starts empty (so startObserver's local-mode gate is true on
// load), then receives first a synchronous burst of containers and then a
// series of individually-timed spaced injections.
// ---------------------------------------------------------------------------

test.describe.serial('infinite-scroll churn stress harness (issue #44 AC-60/61/62)', () => {
  let page;

  test.beforeAll(async () => {
    page = await browserContext.newPage();
    const url = 'http://test-stress-scroll.local/';
    await page.route(url, (route) =>
      route.fulfill({ contentType: 'text/html', body: EMPTY_FIXTURE_HTML }),
    );
    await page.goto(url);

    // Let the content script finish its async start-up (tokenizer build +
    // initial segmentAndWrap/scanPage + startObserver attach) before the
    // first mutation — mirrors observer.e2e.js's settle window verbatim.
    await page.waitForTimeout(5000);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('T-44-066 12 synchronously-appended containers each receive annotation with no nested span wrapping (AC-60)', async () => {
    // A burst of 12 containers appended in ONE page.evaluate() call simulates
    // a single infinite-scroll "page" of newly loaded content landing in one
    // DOM mutation batch — the debounced observer must still wrap and scan
    // every one of them, and must never double-wrap (span span nesting).
    const K = 12;

    await page.evaluate(
      ({ sentences, k }) => {
        const container = document.getElementById('container');
        for (let i = 0; i < k; i++) {
          const p = document.createElement('p');
          p.dataset.iter = String(i);
          p.textContent = sentences[i % sentences.length];
          container.appendChild(p);
        }
      },
      { sentences: SENTENCES, k: K },
    );

    // Wait for the LAST container to be annotated — a proxy for "the whole
    // batch's single debounced flush has fully settled".
    await waitForContainerAnnotated(page, K - 1, 20_000);

    for (let i = 0; i < K; i++) {
      const spanCount = await containerSpanCount(page, i);
      expect(spanCount).toBeGreaterThanOrEqual(1);
    }

    const nestedSpanCount = await page.evaluate(
      () => document.querySelectorAll('#container span span').length,
    );
    expect(nestedSpanCount).toBe(0);
  });

  // -------------------------------------------------------------------------
  // The spaced-injection loop (AC-61/62) is captured ONCE here and asserted
  // on by two independently-meaningful tests below, rather than re-running
  // six real AnkiConnect + kuromoji round trips twice — the same amortized-
  // shared-setup pattern browser-smoke.perf.js and the plan's scenario (b)
  // both use. Container ids continue at 12 (after the burst's 0..11) so the
  // two sub-scenarios never collide inside the shared #container.
  // -------------------------------------------------------------------------

  test.describe.serial('spaced injections (AC-61/62)', () => {
    const ITER_START = 12;
    const N = 6;
    /** @type {number[]} */
    let totalDurations = [];
    /** @type {Array<{i:number, spanCount:number}>} */
    let spanCountsByIter = [];

    test.beforeAll(async () => {
      test.setTimeout(120_000); // 6 real AnkiConnect round trips + >=900ms spacing each

      for (let n = 0; n < N; n++) {
        const i = ITER_START + n;
        await injectSentence(page, i);
        await waitForContainerAnnotated(page, i, 20_000);

        // Read immediately — clear-and-overwrite semantics mean the next
        // injection's flush will overwrite this same-named measure.
        const duration = await readMeasureDuration(page, PERF_NAMES.TOTAL);
        totalDurations.push(duration);

        const spanCount = await containerSpanCount(page, i);
        spanCountsByIter.push({ i, spanCount });

        // >=900ms gap between injections — generous margin beyond the 300ms
        // debounce plus the observer's disconnect/reconnect window around
        // each flush (content.js's startObserver reconnects only after
        // scanPage's AnkiConnect round trip resolves).
        await page.waitForTimeout(900);
      }

      stressScrollDurations.push(...totalDurations);
    });

    test('T-44-067 6 spaced injections each yield a finite, non-negative ankikan:t_total duration (AC-61)', async () => {
      const s = stats(totalDurations);
      expect(s.n).toBe(N);
      for (const duration of totalDurations) {
        expect(Number.isFinite(duration)).toBe(true);
        expect(duration).toBeGreaterThanOrEqual(0);
      }
    });

    test('T-44-068 spaced injections of the same sentence produce identical span counts, with no nested span wrapping (AC-62)', async () => {
      // Group by i % 3 — every third injection reuses the same SENTENCES[]
      // entry, so a healthy segmentAndWrap must tokenize it into the exact
      // same number of spans every time (deterministic tokenization output),
      // with zero tolerance.
      const byRemainder = new Map();
      for (const { i, spanCount } of spanCountsByIter) {
        const remainder = i % 3;
        if (!byRemainder.has(remainder)) byRemainder.set(remainder, []);
        byRemainder.get(remainder).push(spanCount);
      }

      expect(byRemainder.size).toBe(3);
      for (const counts of byRemainder.values()) {
        const [first, ...rest] = counts;
        for (const count of rest) expect(count).toBe(first);
      }

      const nestedSpanCount = await page.evaluate(
        () => document.querySelectorAll('#container span span').length,
      );
      expect(nestedSpanCount).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Scenario (c) — idempotent re-scan (AC-63/64)
//
// A page auto-scanned once via the normal load-time path (browser-smoke
// fixture), then hit with 5 sequential manual `{action:'scan'}` messages.
// scanPage's classification/annotation pass over already-annotated spans
// must add nothing and remove nothing.
// ---------------------------------------------------------------------------

test.describe.serial('idempotent re-scan stress harness (issue #44 AC-63/64)', () => {
  const FIXTURE_URL = 'http://test-stress-rescan.local/';
  const M = 5;

  let page;
  let baselineSpanCount;
  let baselineNodeCount;
  /** @type {number[]} */
  let manualScanSpanCounts = [];
  /** @type {number[]} */
  let manualScanNodeCounts = [];
  /** @type {number[]} */
  let manualScanDurations = [];

  test.beforeAll(async () => {
    test.setTimeout(120_000); // auto-scan + 5 real manual-scan AnkiConnect round trips

    page = await browserContext.newPage();
    await page.route(FIXTURE_URL, (route) =>
      route.fulfill({ contentType: 'text/html', body: generateBrowserSmokeHTML() }),
    );
    await page.goto(FIXTURE_URL);

    // The auto-scan on load. Wait for the first anki-* class, then a settle
    // buffer so all three sentences (not just the fastest) finish annotating
    // before we snapshot the baseline.
    await page.locator('[class*="anki-"]').first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1000);

    baselineSpanCount = await page.evaluate(() => document.querySelectorAll('span').length);
    baselineNodeCount = await liveNodeCount(page);

    const scanPopup = await openPopup(browserContext, extensionId);

    for (let i = 0; i < M; i++) {
      await sendManualScan(scanPopup, FIXTURE_URL);

      // Read immediately after the manual-scan call resolves, before the
      // next repeat's scanPage call overwrites the same-named measure.
      const duration = await readMeasureDuration(page, PERF_NAMES.TOTAL);
      manualScanDurations.push(duration);

      manualScanSpanCounts.push(await page.evaluate(() => document.querySelectorAll('span').length));
      manualScanNodeCounts.push(await liveNodeCount(page));
    }

    await scanPopup.close();

    stressRescanDurations.push(...manualScanDurations);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('T-44-069 5 repeated manual scans produce zero new spans and zero DOM node growth versus baseline (AC-63)', async () => {
    expect(manualScanSpanCounts.length).toBe(M);
    expect(manualScanNodeCounts.length).toBe(M);
    for (let i = 0; i < M; i++) {
      expect(manualScanSpanCounts[i]).toBe(baselineSpanCount);
      expect(manualScanNodeCounts[i]).toBe(baselineNodeCount);
    }
  });

  test('T-44-070 5 repeated manual scans each yield a finite, strictly positive ankikan:t_total duration with bounded variance (AC-64)', async () => {
    const s = stats(manualScanDurations);
    expect(s.n).toBe(M);
    for (const duration of manualScanDurations) {
      expect(Number.isFinite(duration)).toBe(true);
      expect(duration).toBeGreaterThan(0);
    }
    // A repeat scan against an already-annotated page should be a cheap,
    // stable operation — no single repeat should be 10x any other.
    expect(s.max).toBeLessThanOrEqual(s.min * 10);
  });
});

// ---------------------------------------------------------------------------
// Scenario (b) — SPA re-navigation heap stability (AC-65/66)
//
// P=8 remove/inject cycles simulating client-side route changes. Both tests
// below share ONE capture loop (run once in this describe's beforeAll) since
// they read different facets of the exact same 8 cycles, not independent runs.
// ---------------------------------------------------------------------------

test.describe.serial('SPA re-navigation stress harness (issue #44 AC-65/66)', () => {
  const P = 8;

  let page;
  let session;
  /** @type {number[]} */
  let nodeCountsAfterRemoval = [];
  /** @type {Array<{i:number, spanCount:number}>} */
  let spanCountsPerCycle = [];
  /** @type {number[]} */
  let heapSamples = [];

  test.beforeAll(async () => {
    test.setTimeout(150_000); // 8 real AnkiConnect round trips + GC + defensive buffers

    page = await browserContext.newPage();
    const url = 'http://test-stress-spa.local/';
    await page.route(url, (route) =>
      route.fulfill({ contentType: 'text/html', body: EMPTY_FIXTURE_HTML }),
    );
    await page.goto(url);

    // Let the content script finish its async start-up before the first
    // mutation cycle (same rationale as scenario (a)).
    await page.waitForTimeout(5000);

    session = await browserContext.newCDPSession(page);
    await session.send('HeapProfiler.enable');
    await session.send('Performance.enable');

    for (let i = 0; i < P; i++) {
      // (i) Remove prior cycle's content.
      await page.evaluate(() => document.getElementById('container').replaceChildren());

      // (ii) Sample live node count immediately, before injecting new content.
      const nodeCount = await liveNodeCount(page);
      nodeCountsAfterRemoval.push(nodeCount);

      // (iii) Inject a fresh container for this cycle.
      await injectSentence(page, i);

      // (iv) Wait for this cycle's flush to settle.
      await waitForContainerAnnotated(page, i, 20_000);

      // (v) Sample this cycle's span count.
      const spanCount = await containerSpanCount(page, i);
      spanCountsPerCycle.push({ i, spanCount });

      // (vi) Sample heap via the shared CDP session.
      const heapUsed = await sampleHeap(session, page);
      heapSamples.push(heapUsed);

      // Defensive buffer after the settle-poll before the next mutation.
      await page.waitForTimeout(150);
    }

    stressHeapSamples.push(...heapSamples);
  });

  test.afterAll(async () => {
    await session?.detach().catch(() => {});
    await page?.close();
  });

  test('T-44-071 8 SPA route-change cycles produce identical post-removal node counts and identical per-remainder span counts (AC-65)', async () => {
    expect(nodeCountsAfterRemoval.length).toBe(P);
    const [firstNodeCount, ...restNodeCounts] = nodeCountsAfterRemoval;
    for (const nodeCount of restNodeCounts) expect(nodeCount).toBe(firstNodeCount);

    // Cycles sharing the same i % 3 inject the same SENTENCES[] entry into an
    // otherwise-identical empty container — the resulting span count must be
    // identical, exact equality, no tolerance.
    const byRemainder = new Map();
    for (const { i, spanCount } of spanCountsPerCycle) {
      const remainder = i % 3;
      if (!byRemainder.has(remainder)) byRemainder.set(remainder, []);
      byRemainder.get(remainder).push(spanCount);
    }
    expect(byRemainder.size).toBe(3);
    for (const counts of byRemainder.values()) {
      const [first, ...rest] = counts;
      for (const count of rest) expect(count).toBe(first);
    }
  });

  test('T-44-072 8 SPA route-change cycles show no runaway heap growth between the first and last three heap samples (AC-66)', async () => {
    expect(heapSamples.length).toBe(P);
    for (const heapUsed of heapSamples) expect(Number.isFinite(heapUsed)).toBe(true);

    // Prefer stats().mean over reimplementing a mean() helper, per the
    // imports-over-inline rule.
    const firstMean = stats(heapSamples.slice(0, 3)).mean;
    const lastMean = stats(heapSamples.slice(-3)).mean;
    const deltaBytes = lastMean - firstMean;
    const deltaPct = deltaBytes / firstMean;

    // Fail only if BOTH gates trip: a large relative AND a large absolute
    // increase. Either alone is expected noise (a small heap can double
    // percentage-wise on a few KB; a large heap can drift several MB on
    // sub-percent noise) — only the conjunction indicates a real leak.
    const bothGatesTripped = deltaPct > 0.5 && deltaBytes > 5 * 1024 * 1024;
    expect(bothGatesTripped).toBe(false);
  });
});
