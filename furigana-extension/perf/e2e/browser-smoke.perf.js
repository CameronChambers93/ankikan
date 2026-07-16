/**
 * Tier-2 Playwright perf harness — browser-smoke scenario (issue #44, Slice 4).
 *
 * Closes out AC-54, corrected: the five `ankikan:t_*` `performance.measure()`
 * entries recorded by `content.timing.js` inside the content script's isolated
 * world are observable directly from the page's MAIN world via a plain
 * `page.evaluate(() => performance.getEntriesByType('measure'))` — no CDP
 * session or isolated-world bridge is required.
 *
 * WHY (corrects the Slice-3 plan's premise): a content-script isolated world
 * has its own JS globals but shares the frame's single Document / LocalDOMWindow.
 * The User Timing buffer lives on that shared WindowPerformance, so marks/measures
 * emitted by the content script land in the very same timeline the page reads.
 * (This is a documented extension-observability/fingerprinting property of
 * Chromium, empirically confirmed against this build — the earlier assumption
 * that the entries were invisible to the page was wrong.) The practical upshot
 * for the whole Tier-2 harness: reading per-phase timings needs nothing more
 * than `page.evaluate` — the CDP isolated-world reader is unnecessary and has
 * been removed.
 *
 * `segmentAndWrap` (source of `ankikan:t_segment`) only runs in a real
 * browser when `lemmaMode === 'local'` AND a kuromoji dictionary has been
 * seeded AND no `span[data-lemma]` pre-exists (`content.js`) — so this suite
 * reuses the exact `lemmaMode: 'local'` + IndexedDB dict-seeding pattern from
 * `e2e/local-lemma.e2e.js` (factored into `perf/e2e/lib/dict-seed.js`) to
 * make all five measures fire, not just four.
 *
 * PREREQUISITES (unlike the mock-based functional suite, which needs port
 * 8765 FREE):
 *   - Anki must be running with AnkiConnect on localhost:8765 (port OCCUPIED
 *     by real Anki — the inverse requirement of e2e/*.e2e.js).
 *   - The "AnkiKan-E2E" deck must exist (node e2e/setup-anki-e2e.js), with
 *     けが (unlearned), アニメ (learning), 日本語 (learned).
 *   - The extension must be built (`pnpm run build`) — Chromium loads
 *     dist/, not source.
 *
 * Run with: pnpm exec playwright test --config=perf/playwright.perf.config.js
 *
 * PERFORMANCE NOTE: all five tests below share ONE expensive `beforeAll`
 * (extension launch + service worker wait + ~19 MB dict seed) and ONE shared
 * page navigation + scan, captured ONCE into module-scope variables. Each
 * `test()` then asserts a single facet of that shared capture, so the ~15-20s
 * dict-seed + scan cost is paid once for the whole file, not once per test —
 * this is deliberate per the issue #44 Slice-4 plan's "prefer split test IDs,
 * shared setup" resolution.
 */

import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

import { PERF_NAMES } from '../../content.timing.js';
import { generateBrowserSmokeHTML } from '../fixtures/browser-smoke.js';
import { readKuromojiDictFilesBase64, seedKuromojiDict } from './lib/dict-seed.js';
import { assembleBrowserSmokeResult } from './lib/perf-results.js';
import { writeResults, defaultIo } from '../lib/write-results.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// perf/e2e/ -> furigana-extension root (two levels up).
const EXTENSION_PATH = path.resolve(__dirname, '../..');
const FIXTURE_URL = 'http://test-browser-smoke.local/';

// ---------------------------------------------------------------------------
// Small popup/storage helpers, copied verbatim from the pattern used by
// e2e/local-lemma.e2e.js and e2e/ankican.e2e.js (each functional e2e file
// defines these locally rather than sharing a module — matching that
// existing repo convention rather than inventing a new one).
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
// Shared state: one browser context, one page, one scan, captured once.
// ---------------------------------------------------------------------------

let browserContext;
let page;

/**
 * The `ankikan:`-namespaced measures read from the page's MAIN world.
 * @type {Array<{name: string, duration: number, startTime: number}>}
 */
let ankikanMeasures = [];
/** Every measure name on the shared main-world timeline (extension + page-authored). */
let allMeasureNames = [];
/** @type {number} */
let lemmaSpanCount = 0;
/** @type {{ hasUnlearned: boolean, hasLearning: boolean, hasLearned: boolean }} */
let ankiStatus = { hasUnlearned: false, hasLearning: false, hasLearned: false };

test.describe.serial('browser-smoke perf harness (issue #44 AC-54/56/57/58)', () => {
  test.beforeAll(async () => {
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

    // Seed the real kuromoji IPAdic dictionary into IndexedDB at the EXTENSION
    // origin (via the popup page) — the content script reads dict files
    // through the background service worker, which owns the Dexie database
    // at the extension origin.
    const dictFiles = readKuromojiDictFilesBase64();
    await seedKuromojiDict(popup, dictFiles);
    await popup.close();

    page = await browserContext.newPage();

    await page.route(FIXTURE_URL, (route) =>
      route.fulfill({ contentType: 'text/html', body: generateBrowserSmokeHTML() }),
    );
    await page.goto(FIXTURE_URL);

    // Scan complete once the first anki-* class lands on the page.
    await page.locator('[class*="anki-"]').first().waitFor({ timeout: 20_000 });

    // Capture everything ONCE from the page's MAIN world — every test below
    // asserts against these module-scope snapshots rather than re-running the
    // scan. The content script's `performance.measure()` entries are visible
    // here because the User Timing buffer is shared per-frame across the
    // isolated and main worlds (see file header).
    allMeasureNames = await page.evaluate(() =>
      performance.getEntriesByType('measure').map((m) => m.name),
    );
    ankikanMeasures = await page.evaluate(() =>
      performance
        .getEntriesByType('measure')
        .filter((m) => m.name.startsWith('ankikan:'))
        .map((m) => ({ name: m.name, duration: m.duration, startTime: m.startTime })),
    );
    lemmaSpanCount = await page.evaluate(() => document.querySelectorAll('span[data-lemma]').length);
    ankiStatus = await page.evaluate(() => ({
      hasUnlearned: document.querySelectorAll('.anki-unlearned').length > 0,
      hasLearning: document.querySelectorAll('.anki-learning').length > 0,
      hasLearned: document.querySelectorAll('.anki-learned').length > 0,
    }));

    await writeResults(assembleBrowserSmokeResult(ankikanMeasures), {
      resultsDir: path.join(__dirname, '..', 'results'),
      prefix: 'browser-smoke',
      io: defaultIo,
    });
  });

  test.afterAll(async () => {
    await browserContext?.close();
  });

  test('T-44-059 all five ankikan:t_* measures are observable from the page main world via page.evaluate (AC-54)', async () => {
    // The corrected AC-54: a plain main-world read sees every measure the
    // content script recorded — no CDP / isolated-world bridge needed.
    for (const expectedName of Object.values(PERF_NAMES)) {
      expect(allMeasureNames).toContain(expectedName);
    }
  });

  test('T-44-060 filtering the main-world measures by the ankikan: prefix yields exactly the five expected entries (AC-54)', async () => {
    // The `ankikan:` namespace keeps the extension's entries cleanly separable
    // from any page-authored `performance.measure()` calls on the shared
    // timeline: on this fixture (which authors none) the prefix filter returns
    // exactly the five canonical names, no more, no fewer.
    const ankikanNames = allMeasureNames.filter((name) => name.startsWith('ankikan:'));
    expect(ankikanNames.slice().sort()).toEqual(Object.values(PERF_NAMES).slice().sort());
  });

  test('T-44-061 at least one span[data-lemma] exists on the page (AC-56, segmentAndWrap actually ran)', async () => {
    // Proves segmentAndWrap did real tokenization work, not just that
    // t_segment was emitted as a zero-cost no-op around a skipped branch.
    expect(lemmaSpanCount).toBeGreaterThan(0);
  });

  test('T-44-062 at least one span carries anki-unlearned, anki-learning, or anki-learned (AC-57, live findCards/cardsInfo did real work)', async () => {
    // Written as "at least one of the three" (not "all three") to tolerate
    // an unexpected kuromoji split of one of the three fixture sentences.
    const anyStatusPresent = ankiStatus.hasUnlearned || ankiStatus.hasLearning || ankiStatus.hasLearned;
    expect(anyStatusPresent).toBe(true);
  });

  test('T-44-063 every captured measure has a finite duration >= 0, and ankikan:t_total duration is strictly > 0 (AC-58)', async () => {
    // Exactly the five namespaced measures were captured (guarded by T-44-060);
    // assert their timing values are well-formed.
    expect(ankikanMeasures.length).toBe(Object.values(PERF_NAMES).length);

    for (const measure of ankikanMeasures) {
      expect(Number.isFinite(measure.duration)).toBe(true);
      expect(measure.duration).toBeGreaterThanOrEqual(0);
    }

    const total = ankikanMeasures.find((m) => m.name === PERF_NAMES.TOTAL);
    expect(total).toBeTruthy();
    expect(total.duration).toBeGreaterThan(0);
  });
});
