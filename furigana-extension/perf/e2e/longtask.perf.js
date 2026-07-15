/**
 * Tier-2 Playwright perf harness — Long Tasks observer scenario (issue #44,
 * Slice 7).
 *
 * Closes out AC-85/86/87: proves that a real `PerformanceObserver({entryTypes:
 * ['longtask']})` registered in the page's main world (see
 * `./lib/longtask-observer.js`) actually observes synchronous main-thread
 * blocking caused by the extension's local-mode kuromoji tokenize +
 * `segmentAndWrap` pass, and that the pure aggregator `summarizeLongTasks`
 * (`perf/lib/longtask.js`) correctly reduces those real captured entries.
 *
 * Reuses the exact `lemmaMode: 'local'` + IndexedDB dict-seeding pattern from
 * `browser-smoke.perf.js` / `perf/e2e/lib/dict-seed.js` so the content
 * script's tokenization actually runs synchronously on the main thread
 * (rather than short-circuiting to a no-op), and drives it against a dense
 * "L" (10,000-token) generated fixture — the largest page size cheap enough
 * to run in the default CI/dev perf lane — to make a >=50ms long task likely.
 *
 * If T-44-088 proves empirically flaky at this size, the plan's documented
 * escalation is to bump the fixture to `SIZES.XL` (50,000 tokens); this file
 * intentionally starts at `SIZES.L` per the Slice 7 plan.
 *
 * PREREQUISITES (same as browser-smoke.perf.js):
 *   - Anki must be running with AnkiConnect on localhost:8765.
 *   - The "AnkiKan-E2E" deck must exist (node e2e/setup-anki-e2e.js).
 *   - The extension must be built (`pnpm run build`) — Chromium loads
 *     dist/, not source.
 *
 * Run with: pnpm exec playwright test --config=perf/playwright.perf.config.js
 *           perf/e2e/longtask.perf.js
 *
 * PERFORMANCE NOTE: all three tests below share ONE expensive `beforeAll`
 * (extension launch + service worker wait + ~19 MB dict seed + dense-L page
 * tokenize/scan) and ONE shared long-task capture, taken ONCE into
 * module-scope variables. Each `test()` then asserts a single facet of that
 * shared capture — the same "prefer split test IDs, shared setup" pattern
 * `browser-smoke.perf.js` established for Slice 4.
 */

import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

import { installLongTaskObserver, readLongTasks } from './lib/longtask-observer.js';
import { readKuromojiDictFilesBase64, seedKuromojiDict } from './lib/dict-seed.js';
import { generateHTML, SIZES } from '../fixtures/generate.js';
import { summarizeLongTasks } from '../lib/longtask.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// perf/e2e/ -> furigana-extension root (two levels up).
const EXTENSION_PATH = path.resolve(__dirname, '../..');
const FIXTURE_URL = 'http://test-longtask.local/';

// ---------------------------------------------------------------------------
// Small popup/storage helpers, copied verbatim from browser-smoke.perf.js
// (itself copied verbatim from e2e/local-lemma.e2e.js / e2e/ankican.e2e.js's
// existing convention of defining these locally per file).
// ---------------------------------------------------------------------------

/** Opens popup.html for the loaded extension and returns the page. */
async function openPopup(browserContext) {
  let [background] = browserContext.serviceWorkers();
  if (!background) background = await browserContext.waitForEvent('serviceworker');
  const extensionId = background.url().split('/')[2];
  const popup = await browserContext.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
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

// ---------------------------------------------------------------------------
// Shared state: one browser context, one page, one long-task capture, taken
// once.
// ---------------------------------------------------------------------------

let browserContext;
let page;

/** @type {Array<{name: string, startTime: number, duration: number}>} */
let capturedLongTasks = [];
/** @type {{hasError: boolean, isArray: boolean}} */
let observerState = { hasError: false, isArray: false };

test.describe.serial('longtask observer perf harness (issue #44 AC-85/86/87)', () => {
  test.beforeAll(async ({}, testInfo) => {
    // The dense-L page tokenize + ~19MB dict seed is slow — give this hook
    // more room than the default 30s hook timeout.
    testInfo.setTimeout(90_000);

    browserContext = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });

    // Ensure the service worker is up before driving the popup.
    if (!browserContext.serviceWorkers().length) {
      await browserContext.waitForEvent('serviceworker');
    }

    const popup = await openPopup(browserContext);
    await clearStorage(popup);
    await seedStorage(popup, { lemmaMode: 'local' });

    // Seed the real kuromoji IPAdic dictionary into IndexedDB at the
    // EXTENSION origin so segmentAndWrap actually tokenizes synchronously on
    // the main thread instead of short-circuiting to a no-op.
    const dictFiles = readKuromojiDictFilesBase64();
    await seedKuromojiDict(popup, dictFiles);
    await popup.close();

    page = await browserContext.newPage();

    // Must be installed BEFORE page.goto() so the observer is live before
    // the content script runs at document_idle.
    await installLongTaskObserver(page);

    await page.route(FIXTURE_URL, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: generateHTML(SIZES.L, { variant: 'dense' }),
      }),
    );
    await page.goto(FIXTURE_URL);

    // Scan complete once the first anki-* class lands on the page. The L
    // page is large, so give it more room than the default wait.
    await page.locator('[class*="anki-"]').first().waitFor({ timeout: 30_000 });

    // Settle buffer: longtask entries can be delivered with a short async
    // lag behind the work that caused them.
    await page.waitForTimeout(500);

    // Capture ONCE — every test below asserts against these module-scope
    // snapshots rather than re-running the scan.
    capturedLongTasks = await readLongTasks(page);
    observerState = await page.evaluate(() => ({
      hasError: !!window.__ankikanLongTaskObserverError,
      isArray: Array.isArray(window.__ankikanLongTasks),
    }));
  });

  test.afterAll(async () => {
    await browserContext?.close();
  });

  test('T-44-088 a real main-thread long task (duration >= 50ms) is captured during the local-mode dense-L scan (AC-85)', async () => {
    // Proves the extension's local-mode tokenize + segmentAndWrap pass over
    // a 10,000-token page actually produces observable main-thread blocking,
    // not just that the observer wiring itself is inert.
    expect(capturedLongTasks.some((t) => t.duration >= 50)).toBe(true);
  });

  test('T-44-089 the long-task observer registered in the main world without error (AC-86)', async () => {
    // Guards the harness itself: if PerformanceObserver({entryTypes:
    // ['longtask']}) threw (e.g. unsupported entry type), the AC-85/87
    // assertions above/below would be trivially and misleadingly true on an
    // empty array rather than proving anything about real captured tasks.
    expect(observerState.hasError).toBe(false);
    expect(observerState.isArray).toBe(true);
  });

  test('T-44-090 summarizeLongTasks reports count/total/longest for the real captured entries (AC-87)', async () => {
    const s = summarizeLongTasks(capturedLongTasks);

    expect(s.count).toBe(capturedLongTasks.length);

    const expectedTotal = capturedLongTasks.reduce((sum, t) => sum + t.duration, 0);
    expect(s.totalDurationMs).toBeCloseTo(expectedTotal);

    // Guarded for the (excluded-by-T-44-088) empty case so this test still
    // expresses correct intent even if zero tasks were somehow captured.
    const expectedLongest = capturedLongTasks.length
      ? Math.max(...capturedLongTasks.map((t) => t.duration))
      : 0;
    expect(s.longestDurationMs).toBe(expectedLongest);
  });
});
