/**
 * E2E tests for issue #16: Runtime segmentation — wrapping raw text-node Japanese text in
 * <span> elements before Anki lookup so arbitrary pages (e.g. 5ch.io) get highlighted.
 *
 * WHY a real browser is required:
 *   - kuromoji loads binary IPAdic dictionary files from IndexedDB via the background
 *     service worker using `chrome.runtime.sendMessage({ action: 'getDictFile', ... })`.
 *     That message channel only exists in a live MV3 extension context; jsdom cannot
 *     exercise it.
 *   - The pre-annotation heuristic (`document.querySelector('span[data-lemma]')`) and the
 *     async `buildKuromoji` / `_tokenizerPromise` timing are only observable in a real
 *     extension context where the content script runs in the page and the service worker
 *     handles messages concurrently.
 *
 * Acceptance criteria exercised:
 *   AC-7  — segmentAndWrap output spans are found by scanPage's querySelectorAll('span')
 *   AC-8  — runtime segmentation fires before scanPage when lemmaMode=local + dict loaded
 *   AC-9  — pre-annotated NHK-style pages bypass segmentation; existing spans are highlighted
 *   AC-13 — lemmaMode=off (or no dict) suppresses segmentation; no anki-* classes produced
 *
 * Prerequisites:
 *   Anki must be running with the AnkiConnect add-on active on localhost:8765.
 *   Run `node e2e/setup-anki-e2e.js` to provision the required deck/cards if needed.
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
// Read real kuromoji IPAdic dictionary files from node_modules for seeding.
// Serialized as base64 (not number[]) to cross Playwright's evaluate() boundary
// quickly — a multi-million-element array blows the per-test timeout.
// Pattern copied verbatim from local-lemma.e2e.js.
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
// Fixtures: shared browser context
// ---------------------------------------------------------------------------

let browserContext;

test.beforeAll(async () => {
  // Fail fast if AnkiConnect is not reachable — avoids a full Chromium launch
  // only to have every test time out waiting for Anki card data.
  await new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: ANKI_PORT, method: 'POST', path: '/' },
      (res) => { res.resume(); resolve(); }
    );
    req.on('error', () =>
      reject(new Error(
        `AnkiConnect unreachable on localhost:${ANKI_PORT}. ` +
        'Start Anki with the AnkiConnect add-on before running segmentation E2E tests.'
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
// Helpers — mirrored from local-lemma.e2e.js
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
 * Seeds the ankikanDict IndexedDB database with real kuromoji IPAdic dict files using raw
 * IndexedDB APIs (no Dexie dependency in the page context). Must be called on an
 * EXTENSION-origin page (e.g. the popup) because the background service worker owns the
 * Dexie database at the extension origin — not the content-page origin.
 *
 * Pattern copied verbatim from local-lemma.e2e.js.
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
 * Clears all entries from the `files` object store in the `ankikanDict` IndexedDB database.
 * Must be called on an EXTENSION-origin page (e.g. the popup) for the same reason as
 * seedDictInIndexedDB — the DB lives at the extension origin, not the content-page origin.
 *
 * If the database or the `files` object store does not exist yet, this is a no-op.
 * Used before tests that assert the "no dictionary seeded" precondition so that dict
 * data persisted by an earlier test in the shared browser context does not bleed through.
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
// AC-7 + AC-8 (PRIMARY red test)
//
// A page whose Japanese text lives in a raw text node — no pre-existing <span> elements.
// With lemmaMode=local and the kuromoji dict seeded, the content script must:
//   1. Detect there are no span[data-lemma] on the page (not pre-annotated).
//   2. Call segmentAndWrap, which tokenizes the text and wraps words in <span>.
//   3. Call scanPage, which finds those new spans and queries AnkiConnect.
//   4. Apply an anki-* class to the word that has a card in Anki.
//
// This test FAILS (red) before the feature because segmentAndWrap does not exist yet,
// so no spans are created and AnkiConnect is never queried for this page.
// ---------------------------------------------------------------------------

test('AC-7+AC-8: raw text-node Japanese page gets anki-* class after runtime segmentation', async () => {
  // Runtime segmentation is the only path that produces word-level spans on pages
  // that do not pre-wrap their text. Without it, scanPage finds no spans and zero
  // Anki lookups occur. This test verifies the full pipeline: segment → lookup → annotate.
  const popup = await openPopup();
  await clearStorage(popup);
  await seedStorage(popup, { lemmaMode: 'local' });

  // Seed the full IPAdic dictionary so kuromoji can tokenize 日本語は難しい.
  // The dict is seeded via the popup page (extension origin) because the background
  // service worker's Dexie database lives at that origin.
  await seedDictInIndexedDB(popup, SERIALIZED_DICT_FILES);
  await popup.close();

  // Collect console errors and page errors to diagnose failures without silently swallowing.
  const consoleErrors = [];
  const pageErrors = [];

  const page = await browserContext.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  // Raw-text page: the Japanese text is directly inside <p>, not in <span> elements.
  // This simulates a 5ch.io-style page where no per-word spans exist.
  const rawHtml = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>AnkiKan Segmentation E2E</title></head>
<body>
  <p id="raw-para">日本語は難しい</p>
</body>
</html>`;

  await page.route('http://test-segmentation.local/', (route) =>
    route.fulfill({ contentType: 'text/html', body: rawHtml }),
  );
  await page.goto('http://test-segmentation.local/');

  // Wait up to 20 s for an anki-* class to appear somewhere in the paragraph.
  // kuromoji dict build + segmentation + Anki round-trips may take several seconds.
  await page
    .locator('#raw-para [class*="anki-"]')
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {/* will fail at assertion below if nothing appears */});

  // The paragraph must now contain at least one span with an anki-* status class.
  // This is only possible if segmentAndWrap ran (creating the spans) AND scanPage
  // then found them and matched them against AnkiConnect cards.
  await expect(
    page.locator('#raw-para [class*="anki-"]').first(),
  ).toBeVisible();

  // Specifically: 日本語 is in Anki as type 2 (learned), so its span should carry
  // anki-learned (or whichever the pipeline assigns via cardTypeToStatus).
  await expect(
    page.locator('#raw-para span').filter({ hasText: '日本語' }),
  ).toHaveClass(/anki-learned/);

  await page.close();
});

// ---------------------------------------------------------------------------
// AC-9 — Pre-annotated NHK-style page regression
//
// The page already has span[data-lemma] elements (NHK-style pre-annotation).
// The content script must detect this and skip segmentAndWrap entirely.
// The existing spans must still receive anki-* classes via the normal scanPage flow.
// No new spans should be inserted inside the existing ones (no double-wrap).
// ---------------------------------------------------------------------------

test('AC-9: pre-annotated NHK-style page highlights existing spans without re-wrapping them', async () => {
  // If segmentAndWrap ran on a pre-annotated page it would try to tokenize text nodes
  // that are already inside <span data-lemma> elements, potentially double-wrapping them.
  // The guard (check for span[data-lemma] before calling segmentAndWrap) must prevent this.
  // The existing spans must still get annotated by scanPage as before.
  const popup = await openPopup();
  await clearStorage(popup);
  await seedStorage(popup, { lemmaMode: 'local' });
  await seedDictInIndexedDB(popup, SERIALIZED_DICT_FILES);
  await popup.close();

  const page = await browserContext.newPage();

  // NHK-style pre-annotated page: each word is already in its own span with data-lemma.
  // 伝える is in Anki as type 0 (unlearned).
  const nhkHtml = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>AnkiKan Segmentation E2E - NHK</title></head>
<body>
  <div id="nhk-article">
    <span id="word-tsutaeru" data-lemma="伝える">伝え</span>
    <span id="word-nihongo" data-lemma="日本語">日本語</span>
  </div>
</body>
</html>`;

  await page.route('http://test-segmentation-nhk.local/', (route) =>
    route.fulfill({ contentType: 'text/html', body: nhkHtml }),
  );
  await page.goto('http://test-segmentation-nhk.local/');

  // Wait for the content script to annotate the pre-annotated spans.
  await page
    .locator('[class*="anki-"]')
    .first()
    .waitFor({ timeout: 15000 })
    .catch(() => {});

  // The span for 伝え (data-lemma=伝える) must receive an anki-* class via normal scanPage flow.
  await expect(page.locator('#word-tsutaeru')).toHaveClass(/anki-unlearned/);

  // The span for 日本語 must also receive an anki-* class.
  await expect(page.locator('#word-nihongo')).toHaveClass(/anki-learned/);

  // Segmentation must NOT have inserted child spans inside the existing word spans.
  // A double-wrapped span would look like <span data-lemma="..."><span>伝え</span></span>.
  const nestedSpanCount = await page.locator('#nhk-article span span').count();
  expect(nestedSpanCount).toBe(0);

  // The total number of direct span children of #nhk-article must remain exactly 2
  // (the two pre-annotated spans — no new spans inserted).
  const directSpanCount = await page.locator('#nhk-article > span').count();
  expect(directSpanCount).toBe(2);

  await page.close();
});

// ---------------------------------------------------------------------------
// AC-13 — lemmaMode: 'off' boundary condition
//
// With lemmaMode=off, segmentAndWrap must not run. Raw text nodes stay as text nodes.
// No anki-* classes should appear because (a) there are no spans to look up, and
// (b) the scan pipeline would not tokenize anyway.
// ---------------------------------------------------------------------------

test('AC-13: lemmaMode off — raw text page gets no anki-* classes (segmentation did not run)', async () => {
  // In off mode the content script must not call segmentAndWrap regardless of whether
  // a dictionary is available. The page should be left completely unannotated.
  const popup = await openPopup();
  await clearStorage(popup);
  await seedStorage(popup, { lemmaMode: 'off' });
  // Clear the IndexedDB dict so this test's precondition is explicit: even if a dict
  // were somehow available, off mode must still produce zero spans. Clearing here also
  // makes the test order-independent with respect to the seeding tests above.
  await clearDictInIndexedDB(popup);
  await popup.close();

  const page = await browserContext.newPage();

  const rawHtml = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>AnkiKan Segmentation E2E - Off Mode</title></head>
<body>
  <p id="raw-para-off">日本語は難しい</p>
</body>
</html>`;

  await page.route('http://test-segmentation-off.local/', (route) =>
    route.fulfill({ contentType: 'text/html', body: rawHtml }),
  );
  await page.goto('http://test-segmentation-off.local/');

  // Give the content script time to complete (or not run). We deliberately do NOT wait
  // for an anki-* class because none should appear. A short wait lets the content script
  // finish its async startup path before we assert absence.
  await page.waitForTimeout(5000);

  // No anki-* classes must appear anywhere on the page.
  const ankiClassCount = await page.locator('[class*="anki-"]').count();
  expect(ankiClassCount).toBe(0);

  // The paragraph text must remain as a raw text node — no child spans inserted.
  const spanInsideParaCount = await page.locator('#raw-para-off span').count();
  expect(spanInsideParaCount).toBe(0);

  await page.close();
});

// ---------------------------------------------------------------------------
// Graceful degradation — lemmaMode: 'local' but NO dictionary seeded
//
// With no dict, buildKuromoji returns null, so segmentAndWrap is skipped.
// The page must not throw a fatal JS error. The scan still completes (it just
// finds no spans to look up and returns matched=0). The key assertion is the
// absence of an uncaught exception, not the presence of anki-* classes.
// ---------------------------------------------------------------------------

test('graceful degradation: local mode with no dict seeded — no fatal JS error, scan completes', async () => {
  // The content script's try/catch around buildKuromoji must absorb the missing-file
  // error gracefully. An uncaught exception here would break all future message-handler
  // calls on the page (e.g. the popup's manual scan button).
  const popup = await openPopup();
  await clearStorage(popup);
  await seedStorage(popup, { lemmaMode: 'local' });
  // Explicitly wipe the IndexedDB dict so the "no dict seeded" precondition holds
  // even when an earlier test (AC-7+AC-8 or AC-9) has seeded the full dictionary
  // into the shared persistent browser context. Without this, the dict persists
  // across tests and kuromoji builds successfully, causing 3 spans to appear and
  // the spanInsideParaCount assertion to fail.
  await clearDictInIndexedDB(popup);
  await popup.close();

  const uncaughtErrors = [];
  const consoleErrors = [];

  const page = await browserContext.newPage();
  page.on('pageerror', (err) => uncaughtErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const rawHtml = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>AnkiKan Segmentation E2E - No Dict</title></head>
<body>
  <p id="raw-para-nodict">日本語は難しい</p>
</body>
</html>`;

  await page.route('http://test-segmentation-nodict.local/', (route) =>
    route.fulfill({ contentType: 'text/html', body: rawHtml }),
  );
  await page.goto('http://test-segmentation-nodict.local/');

  // Give the content script startup sequence (including the failed dict build) time to run.
  // No anki-* class is expected, so we just wait a fixed window.
  await page.waitForTimeout(8000);

  // The content script must not have thrown an uncaught exception.
  // An empty array here means the page remained stable after the missing-dict path.
  expect(uncaughtErrors).toHaveLength(0);

  // No spans should have been injected (no dict → no segmentation → no lookups).
  const spanInsideParaCount = await page.locator('#raw-para-nodict span').count();
  expect(spanInsideParaCount).toBe(0);

  await page.close();
});
