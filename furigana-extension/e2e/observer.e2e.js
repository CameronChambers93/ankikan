/**
 * E2E tests for issue #18: Re-segment dynamically loaded / SPA content via MutationObserver.
 *
 * WHY a real browser is required:
 *   - The MutationObserver fires in the live document context of the content script.
 *     A jsdom environment cannot load or run a packed MV3 content script, and it cannot
 *     exercise the chrome.storage.local → isAllowed guard that gates observer start-up.
 *   - The debounce (300 ms) and the disconnect/reconnect loop-prevention are timing
 *     behaviours that only manifest with real browser event loops.
 *   - IndexedDB dict seeding, kuromoji tokenisation, and the AnkiConnect round-trip all
 *     require the real extension service worker running in Chromium.
 *
 * Acceptance criteria exercised:
 *   AC-1  — dynamically injected Japanese text is segmented + annotated without a reload
 *   AC-2  — rapid burst of DOM mutations produces one correct annotation pass (no dup nesting)
 *   AC-3  — injected subtree does not accumulate runaway nested spans after debounce settles
 *   AC-7  — observer is NOT started on a blocked URL; injected content stays un-annotated
 *
 * Prerequisites:
 *   Anki must be running with the AnkiConnect add-on active on localhost:8765.
 *   Run `node e2e/setup-anki-e2e.js` to provision the required deck/cards if needed.
 *   The injected word 日本語 is provisioned there as type 2 (learned) → anki-learned.
 */

import { test, expect, chromium } from '@playwright/test';
import http from 'http';
import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '..');
const ANKI_PORT = 8765;

// ---------------------------------------------------------------------------
// Read real kuromoji IPAdic dictionary files — serialised as base64 strings so
// they cross Playwright's evaluate() boundary quickly (same pattern as
// segmentation.e2e.js and local-lemma.e2e.js).
// ---------------------------------------------------------------------------

const DICT_DIR = path.resolve(__dirname, '../node_modules/kuromoji/dict');
const DICT_FILE_NAMES = [
  'base.dat.gz', 'cc.dat.gz', 'check.dat.gz', 'tid.dat.gz',
  'tid_map.dat.gz', 'tid_pos.dat.gz', 'unk.dat.gz', 'unk_char.dat.gz',
  'unk_compat.dat.gz', 'unk_invoke.dat.gz', 'unk_map.dat.gz', 'unk_pos.dat.gz',
];

const SERIALIZED_DICT_FILES = DICT_FILE_NAMES.map((name) => ({
  name,
  base64: readFileSync(path.join(DICT_DIR, name)).toString('base64'),
}));

// ---------------------------------------------------------------------------
// Shared browser context
// ---------------------------------------------------------------------------

let browserContext;

test.beforeAll(async () => {
  // Fail fast if AnkiConnect is not reachable — avoids a full Chromium launch
  // only to have every test time out waiting for Anki card data.
  // Pattern copied verbatim from segmentation.e2e.js (real AnkiConnect, no mock).
  await new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: ANKI_PORT, method: 'POST', path: '/' },
      (res) => { res.resume(); resolve(); }
    );
    req.on('error', () =>
      reject(new Error(
        `AnkiConnect unreachable on localhost:${ANKI_PORT}. ` +
        'Start Anki with the AnkiConnect add-on (and run `node e2e/setup-anki-e2e.js`) ' +
        'before running observer E2E tests.'
      ))
    );
    req.end(JSON.stringify({ action: 'version', version: 6 }));
  });

  browserContext = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  if (!browserContext.serviceWorkers().length) {
    await browserContext.waitForEvent('serviceworker');
  }
});

test.afterAll(async () => {
  await browserContext?.close();
});

// ---------------------------------------------------------------------------
// Helpers — mirrored from segmentation.e2e.js / local-lemma.e2e.js
// ---------------------------------------------------------------------------

/** Opens popup.html for the loaded extension and returns the page. */
async function openPopup() {
  let [background] = browserContext.serviceWorkers();
  if (!background) background = await browserContext.waitForEvent('serviceworker');
  const extensionId = background.url().split('/')[2];
  const popup = await browserContext.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  return popup;
}

/** Seeds chrome.storage.local via an extension page so values take effect for content scripts. */
async function seedStorage(popup, values) {
  await popup.evaluate(
    (vals) => new Promise((resolve) => chrome.storage.local.set(vals, resolve)),
    values,
  );
}

/** Clears chrome.storage.local via an extension page. */
async function clearStorage(popup) {
  await popup.evaluate(
    () => new Promise((resolve) => chrome.storage.local.clear(resolve)),
  );
}

/**
 * Seeds the ankikanDict IndexedDB database with real kuromoji IPAdic dict files.
 * Must be called on an EXTENSION-origin page (e.g. the popup) — pattern copied
 * verbatim from segmentation.e2e.js.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Array<{name: string, base64: string}>} serializedDictFiles
 */
async function seedDictInIndexedDB(page, serializedDictFiles) {
  await page.evaluate(async (dictFiles) => {
    const decode = (b64) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    };

    const openDb = () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('ankikanDict');
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => reject(req.error);
      });

    let db = await openDb();
    if (!db.objectStoreNames.contains('files')) {
      const nextVersion = db.version + 1;
      db.close();
      db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('ankikanDict', nextVersion);
        req.onupgradeneeded = (e) => {
          e.target.result.createObjectStore('files', { keyPath: 'name' });
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => reject(req.error);
      });
    }

    await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      const store = tx.objectStore('files');
      for (const { name, base64 } of dictFiles) {
        store.put({ name, blob: new Blob([decode(base64)]) });
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, serializedDictFiles);
}

/**
 * Clears all entries from the `files` object store in ankikanDict IndexedDB.
 * Must be called on an EXTENSION-origin page (e.g. popup).
 * Pattern copied verbatim from segmentation.e2e.js.
 *
 * @param {import('@playwright/test').Page} page  An extension-origin page (popup).
 */
async function clearDictInIndexedDB(page) {
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('ankikanDict');
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => reject(req.error);
    });

    if (!db.objectStoreNames.contains('files')) {
      db.close();
      return;
    }

    await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
}

// ---------------------------------------------------------------------------
// Shared fixture HTML — a minimal page with NO initial Japanese text, so the
// initial segmentation + scanPage pass finds nothing.  Subsequent DOM mutations
// injected via page.evaluate() are what the observer must react to.
// ---------------------------------------------------------------------------

const EMPTY_FIXTURE_HTML = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>AnkiKan Observer E2E</title></head>
<body>
  <div id="container"></div>
</body>
</html>`;

// ---------------------------------------------------------------------------
// AC-1: dynamically injected Japanese text is segmented + annotated (no reload)
//
// After the page is idle (initial scanPage has already run and found nothing),
// injecting a new <div> containing 日本語 into the live DOM must cause the
// MutationObserver to fire, segmentAndWrap to tokenize the subtree, scanPage to
// run again, and an anki-* class to appear on the resulting span — all without
// a page reload.
//
// This test fails (red) before the feature because no MutationObserver exists:
// the injected content stays as a raw text node and receives no anki-* class.
// ---------------------------------------------------------------------------

test('T-18-017 AC-1: dynamically injected Japanese text receives anki-* class without a page reload', async () => {
  // Without the observer, content injected after document_idle is never segmented
  // or scanned.  This test verifies the full pipeline fires on DOM mutation:
  // observer fires → debounce settles → segmentAndWrap wraps new subtree →
  // scanPage annotates the resulting spans.
  const popup = await openPopup();
  await clearStorage(popup);
  await seedStorage(popup, { lemmaMode: 'local' });
  await seedDictInIndexedDB(popup, SERIALIZED_DICT_FILES);
  await popup.close();

  const page = await browserContext.newPage();

  await page.route('http://test-observer-ac1.local/', (route) =>
    route.fulfill({ contentType: 'text/html', body: EMPTY_FIXTURE_HTML }),
  );
  await page.goto('http://test-observer-ac1.local/');

  // Wait for the initial scan to settle (the page has no Japanese, so no anki-*
  // classes appear from the initial pass — we just want the content script to be
  // fully initialised before we inject).
  await page.waitForTimeout(5000);

  // Inject a new <div> containing 日本語 into the live DOM.  The observer must detect
  // this subtree and trigger segmentation + scan on it.
  await page.evaluate(() => {
    const div = document.createElement('div');
    div.id = 'injected';
    div.textContent = '日本語';
    document.getElementById('container').appendChild(div);
  });

  // Wait up to 15 s for an anki-* class to appear inside the injected div.
  // The debounce (300 ms) + kuromoji tokenisation + AnkiConnect round-trip may
  // take several seconds on first run (kuromoji builds lazily on first tokenize call).
  await page
    .locator('#injected [class*="anki-"]')
    .first()
    .waitFor({ timeout: 15000 })
    .catch(() => { /* assertion below will report the failure */ });

  // The injected div must now contain a span with an anki-* status class.
  // This is only possible if the observer fired, segmentAndWrap wrapped the text,
  // and scanPage matched 日本語 against the real AnkiConnect deck (type 2 = learned).
  await expect(
    page.locator('#injected [class*="anki-"]').first(),
  ).toBeVisible();

  await page.close();
});

// ---------------------------------------------------------------------------
// AC-2: rapid burst of DOM mutations produces exactly ONE annotation pass,
// with no duplicated or nested wrapping.
//
// Five separate appendChild calls within ~100 ms must collapse (via the debounce)
// into a single segmentation + scan run.  The end state must have each word wrapped
// in exactly one level of <span> with an anki-* class — no <span><span> nesting.
//
// This test fails (red) before the feature: without an observer, none of the five
// injected divs receive any annotation at all.
// ---------------------------------------------------------------------------

test('T-18-018 AC-2: burst of rapid mutations annotates content exactly once with no nested span wrapping', async () => {
  // Multiple DOM mutations within the debounce window must be batched into one
  // re-segmentation call.  If the observer called segmentAndWrap per mutation instead
  // of debouncing, the first segmentAndWrap would produce <span> nodes, then a second
  // call on the same subtree would try to re-wrap already-wrapped spans — producing
  // <span><span>日本語</span></span> nesting.  The debounce prevents this.
  const popup = await openPopup();
  await clearStorage(popup);
  await seedStorage(popup, { lemmaMode: 'local' });
  await seedDictInIndexedDB(popup, SERIALIZED_DICT_FILES);
  await popup.close();

  const page = await browserContext.newPage();

  await page.route('http://test-observer-ac2.local/', (route) =>
    route.fulfill({ contentType: 'text/html', body: EMPTY_FIXTURE_HTML }),
  );
  await page.goto('http://test-observer-ac2.local/');

  // Wait for the content script to fully initialise before injecting.
  await page.waitForTimeout(5000);

  // Inject five separate divs within a single synchronous JS turn (~0 ms gap between
  // each).  The MutationObserver callback should batch all five into one call, and the
  // debounce should collapse them into one re-segmentation + re-scan pass.
  await page.evaluate(() => {
    const container = document.getElementById('container');
    for (let i = 0; i < 5; i++) {
      const div = document.createElement('div');
      div.className = 'burst-item';
      div.dataset.index = String(i);
      div.textContent = '日本語';
      container.appendChild(div);
    }
  });

  // Wait for annotation to settle — up to 15 s for the full pipeline.
  await page
    .locator('.burst-item [class*="anki-"]')
    .first()
    .waitFor({ timeout: 15000 })
    .catch(() => { /* assertion below reports failure */ });

  // Every injected div must contain exactly one span with an anki-* class.
  const burstItems = page.locator('.burst-item');
  await expect(burstItems).toHaveCount(5);

  for (let i = 0; i < 5; i++) {
    const item = burstItems.nth(i);

    // Each item must have at least one annotated span inside it.
    await expect(
      item.locator('[class*="anki-"]').first(),
    ).toBeVisible({ timeout: 2000 });

    // No <span> must be nested inside another <span> inside this item.
    // A nested span would mean segmentAndWrap ran on an already-wrapped subtree.
    const nestedSpanCount = await item.locator('span span').count();
    expect(nestedSpanCount).toBe(0);
  }

  await page.close();
});

// ---------------------------------------------------------------------------
// AC-3: no infinite loop — span count in the injected subtree is bounded and
// stable after the debounce settles.
//
// If the observer re-triggered on its own mutations (i.e., no disconnect/reconnect
// guard), segmentAndWrap would repeatedly wrap already-wrapped text nodes.  The span
// count inside the injected div would grow unboundedly.  This test asserts the count
// stabilises after a generous settle window.
//
// This test fails (red) before the feature because no observer exists and thus no
// spans appear at all — we assert at least one span IS present (prerequisite for
// an infinite-loop check), which fails when the observer is missing.
// ---------------------------------------------------------------------------

test('T-18-019 AC-3: span count inside injected subtree is bounded and stable after debounce settles', async () => {
  // An infinite self-re-triggering loop would manifest as an ever-growing span count
  // (each observer callback wraps already-wrapped spans into more spans).  We assert
  // the count is non-zero (segmentation ran at all) and does not grow between two
  // sampling points separated by 3 s.
  const popup = await openPopup();
  await clearStorage(popup);
  await seedStorage(popup, { lemmaMode: 'local' });
  await seedDictInIndexedDB(popup, SERIALIZED_DICT_FILES);
  await popup.close();

  const page = await browserContext.newPage();

  await page.route('http://test-observer-ac3.local/', (route) =>
    route.fulfill({ contentType: 'text/html', body: EMPTY_FIXTURE_HTML }),
  );
  await page.goto('http://test-observer-ac3.local/');

  // Wait for content script initialisation.
  await page.waitForTimeout(5000);

  // Inject one div with Japanese text.
  await page.evaluate(() => {
    const div = document.createElement('div');
    div.id = 'stability-check';
    div.textContent = '日本語';
    document.getElementById('container').appendChild(div);
  });

  // Wait for the first segmentation pass to complete (observer fires, debounce settles,
  // segmentAndWrap runs, scanPage annotates).
  await page
    .locator('#stability-check [class*="anki-"]')
    .first()
    .waitFor({ timeout: 15000 })
    .catch(() => { /* assertion below reports failure */ });

  // Snapshot the span count at this point.
  const spanCountAfterFirstPass = await page.locator('#stability-check span').count();

  // At least one span must exist — if none exist, segmentation did not run at all
  // and there is nothing to test for stability.
  expect(spanCountAfterFirstPass).toBeGreaterThan(0);

  // Wait 3 s beyond the debounce window to ensure any hypothetical runaway loop would
  // have had time to produce additional spans.
  await page.waitForTimeout(3000);

  const spanCountAfterSettle = await page.locator('#stability-check span').count();

  // The span count must not have increased.  If the observer is re-triggering on its
  // own mutations (infinite loop), this count will be larger than spanCountAfterFirstPass.
  expect(spanCountAfterSettle).toBe(spanCountAfterFirstPass);

  await page.close();
});

// ---------------------------------------------------------------------------
// AC-7: observer is NOT started on a blocked URL; injected content stays raw.
//
// When `isAllowed(settings)` returns false (host is in blockedUrls), the content
// script must return early and never start the MutationObserver.  Dynamically
// injecting Japanese text on such a page must produce NO anki-* annotations.
//
// NOTE: AC-7 here refers to the observer-specific requirement that the observer is
// gated on isAllowed.  (AC-7 in segmentation.e2e.js refers to a different criterion
// in that file's acceptance list.)
//
// This test may PASS before implementation (no observer = no annotation), which is
// expected and noted in the test report.  After implementation it must continue to
// pass — the gate must remain in place.
// ---------------------------------------------------------------------------

test('T-18-020 AC-7: observer not started on blocked URL; injected Japanese text stays un-annotated', async () => {
  // The MutationObserver must only be started when isAllowed(settings) returns true.
  // A blocked URL must not trigger any annotation even when Japanese content is
  // dynamically injected into the DOM after page load.
  const popup = await openPopup();
  await clearStorage(popup);

  // Seed lemmaMode=local (so the observer WOULD start on an allowed page) and add
  // test-observer-blocked.local to the block list.
  await seedStorage(popup, {
    lemmaMode: 'local',
    blockedUrls: ['test-observer-blocked.local'],
  });
  await seedDictInIndexedDB(popup, SERIALIZED_DICT_FILES);
  await popup.close();

  const page = await browserContext.newPage();

  const blockedHtml = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>AnkiKan Observer E2E - Blocked</title></head>
<body>
  <div id="blocked-container"></div>
</body>
</html>`;

  await page.route('http://test-observer-blocked.local/', (route) =>
    route.fulfill({ contentType: 'text/html', body: blockedHtml }),
  );
  await page.goto('http://test-observer-blocked.local/');

  // Wait for the content script to finish its start-up sequence.
  await page.waitForTimeout(5000);

  // Inject Japanese text — the observer must NOT fire because the page is blocked.
  await page.evaluate(() => {
    const div = document.createElement('div');
    div.id = 'blocked-injected';
    div.textContent = '日本語';
    document.getElementById('blocked-container').appendChild(div);
  });

  // Wait a generous window (longer than the debounce + scan round-trip) to ensure
  // the observer is not running at all.
  await page.waitForTimeout(8000);

  // No anki-* classes must appear anywhere in the injected content.
  const ankiClassCount = await page.locator('#blocked-injected [class*="anki-"]').count();
  expect(ankiClassCount).toBe(0);

  // The text must remain as a raw text node — no spans inserted by segmentAndWrap.
  const spanCount = await page.locator('#blocked-injected span').count();
  expect(spanCount).toBe(0);

  await page.close();
});
