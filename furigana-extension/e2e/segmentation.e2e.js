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
 *   AC-19 — local-mode: unmatched plain kanji (食べる) gets <ruby>/<rt> injected; visible
 *   AC-20 — local-mode: matched kanji (日本語, learned) with furiganaLearned:false gets
 *            ruby injected but hidden via anki-hide-furigana
 *   AC-21 — server mode / off mode: no extension-injected <ruby> elements appear
 *
 * Prerequisites:
 *   Anki must be running with the AnkiConnect add-on active on localhost:8765.
 *   Run `node e2e/setup-anki-e2e.js` to provision the required deck/cards if needed.
 *   The AnkiKan-E2E deck must contain:
 *     日本語 → type 2 (learned)
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

// ---------------------------------------------------------------------------
// AC-19 — Local mode: plain kanji with no pre-existing ruby gets furigana injected
//
// The page contains the raw text 食べる inside a <p> with no <ruby>/<rt>.
// With lemmaMode=local and the kuromoji dict seeded, the full pipeline must:
//   1. segmentAndWrap: tokenize 食べる → one span with data-reading set to the
//      katakana reading returned by kuromoji.
//   2. scanPage: query AnkiConnect (食べる is not in the AnkiKan-E2E deck, so it
//      gets anki-unknown).
//   3. injectFurigana: see that the span has dataset.reading and no pre-existing
//      <ruby> child → build <ruby>食<rt>た</rt></ruby>べる and set it as innerHTML.
//
// The key assertions are that <ruby> and <rt> are NOW PRESENT in the DOM, and that
// the <rt> text is non-empty hiragana (the reading). We do not assert anki-hide-
// furigana because furiganaUnknown defaults to true (issue #33 AC behaviour).
// ---------------------------------------------------------------------------

test('AC-19: local mode — plain 食べる with no pre-existing ruby gets <ruby>/<rt> injected', async () => {
  // Without furigana injection the user sees 食べる with no pronunciation aid.
  // This is the core AC-19 behaviour: injectFurigana must synthesise <ruby><rt>
  // from kuromoji's reading field for every span that lacks pre-existing ruby markup.
  const popup = await openPopup();
  await clearStorage(popup);
  await seedStorage(popup, {
    lemmaMode: 'local',
    furiganaGlobal: true,
    furiganaUnlearned: true,
    furiganaLearning: true,
    furiganaLearned: true,
  });
  await seedDictInIndexedDB(popup, SERIALIZED_DICT_FILES);
  await popup.close();

  const page = await browserContext.newPage();

  // Plain HTML — 食べる sits in a raw text node inside <p>, NO <ruby> or <span> markup.
  // This is the exact scenario described in the issue: arbitrary pages where the author
  // has not added ruby annotations.
  const rawHtml = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>AnkiKan Furigana Injection E2E</title></head>
<body>
  <p id="test-para">食べる</p>
</body>
</html>`;

  await page.route('http://test-furigana-injection.local/', (route) =>
    route.fulfill({ contentType: 'text/html', body: rawHtml }),
  );
  await page.goto('http://test-furigana-injection.local/');

  // Wait up to 25 s for any anki-* class to appear — kuromoji dict init + segmentation
  // + Anki round-trip can each take several seconds in CI.
  await page
    .locator('#test-para [class*="anki-"]')
    .first()
    .waitFor({ timeout: 25000 })
    .catch(() => {/* assertion below will surface the failure */});

  // A <ruby> element must now exist inside the paragraph. Without furigana injection
  // this would be absent because the source HTML contained none.
  const rubyCount = await page.locator('#test-para ruby').count();
  expect(rubyCount).toBeGreaterThan(0);

  // The <rt> element must exist and contain non-empty hiragana text. kuromoji returns
  // the reading as katakana; injectFurigana must convert it to hiragana before placing
  // it in <rt>. An empty or missing <rt> means injection either did not run or
  // produced broken markup.
  const rtLocator = page.locator('#test-para rt').first();
  await expect(rtLocator).toBeAttached();
  const rtText = await rtLocator.textContent();
  expect(rtText).toBeTruthy();
  // Hiragana codepoint range: U+3041–U+3096
  expect(/[ぁ-ゖ]/.test(rtText)).toBe(true);

  // The <rt> must be visible (not hidden by anki-hide-furigana). 食べる is not in the
  // AnkiKan-E2E deck so it will receive anki-unknown; furiganaUnknown defaults to true,
  // so the computed visibility of <rt> must be "visible", not "hidden".
  const rtVisibility = await page.evaluate(() => {
    const rt = document.querySelector('#test-para rt');
    return rt ? window.getComputedStyle(rt).visibility : 'missing';
  });
  expect(rtVisibility).toBe('visible');

  await page.close();
});

// ---------------------------------------------------------------------------
// AC-20 — Local mode: matched kanji (日本語, anki-learned) with furiganaLearned:false
//          — ruby is injected but hidden via anki-hide-furigana
//
// 日本語 IS in the AnkiKan-E2E deck as type 2 (learned). With furiganaLearned:false
// the span must carry both anki-learned (from the Anki lookup) and anki-hide-furigana
// (from the applyFurigana visibility gate). Crucially the <ruby>/<rt> must ALSO be
// present in the DOM — injection must have run even though the reading is then hidden.
// This distinguishes "furigana synthesised and suppressed" from "furigana never built".
// ---------------------------------------------------------------------------

test('AC-20: local mode — 日本語 (anki-learned) with furiganaLearned:false has ruby present but rt visibility hidden', async () => {
  // The user's choice to hide furigana on learned words should suppress the <rt> via
  // CSS (visibility:hidden via .anki-hide-furigana rt rule), not prevent injection.
  // If the <ruby> were absent entirely the user could not toggle furigana back on
  // without a full page rescan + re-injection.
  const popup = await openPopup();
  await clearStorage(popup);
  await seedStorage(popup, {
    lemmaMode: 'local',
    furiganaGlobal: true,
    furiganaUnlearned: true,
    furiganaLearning: true,
    furiganaLearned: false,   // hide furigana on learned words — the key toggle for AC-20
  });
  await seedDictInIndexedDB(popup, SERIALIZED_DICT_FILES);
  await popup.close();

  const page = await browserContext.newPage();

  // Raw text page containing only 日本語. No pre-existing <ruby> or <span> markup.
  // 日本語 is in the AnkiKan-E2E deck as type 2 (learned); kuromoji gives reading ニホンゴ.
  const rawHtml = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>AnkiKan Furigana Hide E2E</title></head>
<body>
  <p id="test-para-hide">日本語</p>
</body>
</html>`;

  await page.route('http://test-furigana-hide.local/', (route) =>
    route.fulfill({ contentType: 'text/html', body: rawHtml }),
  );
  await page.goto('http://test-furigana-hide.local/');

  // Wait for the anki-learned class (proving the Anki lookup completed).
  await page
    .locator('#test-para-hide .anki-learned')
    .first()
    .waitFor({ timeout: 25000 })
    .catch(() => {});

  // The span must carry anki-learned (日本語 is type 2 in AnkiConnect).
  await expect(
    page.locator('#test-para-hide span').filter({ hasText: '日本語' }),
  ).toHaveClass(/anki-learned/);

  // The span must also carry anki-hide-furigana because furiganaLearned is false.
  // This class is what the CSS rule `.anki-hide-furigana rt { visibility: hidden }` targets.
  await expect(
    page.locator('#test-para-hide span').filter({ hasText: '日本語' }),
  ).toHaveClass(/anki-hide-furigana/);

  // A <ruby> element must exist — injection must have run even though the reading is hidden.
  // Without the <ruby> in the DOM there is nothing to reveal if the user later toggles
  // furiganaLearned back to true.
  const rubyCount = await page.locator('#test-para-hide ruby').count();
  expect(rubyCount).toBeGreaterThan(0);

  // The <rt> must be present in the DOM (injection ran) but its computed visibility
  // must be 'hidden' because the .anki-hide-furigana CSS rule suppresses it.
  const rtLocator = page.locator('#test-para-hide rt').first();
  await expect(rtLocator).toBeAttached();

  const rtVisibility = await page.evaluate(() => {
    const rt = document.querySelector('#test-para-hide rt');
    return rt ? window.getComputedStyle(rt).visibility : 'missing';
  });
  expect(rtVisibility).toBe('hidden');

  await page.close();
});

// ---------------------------------------------------------------------------
// AC-21 — Server mode and off mode produce no extension-injected <ruby> elements
//
// Server mode (lemmaMode:'server') defers furigana to issue #32 — kuromoji is
// not initialised, so no reading fields are available and no <ruby> is injected.
// Off mode has no kuromoji at all.
//
// Both modes are tested with a raw text page that has no author-supplied <ruby>.
// Any <ruby> found in the DOM after the content script runs must have been injected
// by the extension; since injection must NOT occur in these modes, zero <ruby>
// elements are expected.
// ---------------------------------------------------------------------------

test('AC-21a: server mode — no extension-injected <ruby> elements on raw-text page', async () => {
  // In server mode the extension queries AnkiConnect for card status but does NOT
  // run the local kuromoji tokeniser. Without kuromoji readings there is no data
  // from which to synthesise furigana, so injectFurigana must not be called and
  // no <ruby> elements should appear.
  const popup = await openPopup();
  await clearStorage(popup);
  await seedStorage(popup, {
    lemmaMode: 'server',
    furiganaGlobal: true,
    furiganaUnlearned: true,
    furiganaLearning: true,
    furiganaLearned: true,
  });
  // No dict seeded — server mode must not use the local kuromoji dict even if one
  // happened to be present from an earlier test in the shared browser context.
  await clearDictInIndexedDB(popup);
  await popup.close();

  const page = await browserContext.newPage();

  // The page contains pre-existing <span> elements so that scanPage can run its
  // normal Anki lookup path (testing that the server-mode scan pipeline itself does
  // not inadvertently trigger furigana injection). 食べる is not in the E2E deck so
  // its span will receive anki-unknown; 日本語 is in the deck as learned.
  const serverHtml = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>AnkiKan Server Mode Furigana E2E</title></head>
<body>
  <p id="server-para">
    <span id="sp-taberu">食べる</span>
    <span id="sp-nihongo" data-lemma="日本語">日本語</span>
  </p>
</body>
</html>`;

  await page.route('http://test-furigana-server.local/', (route) =>
    route.fulfill({ contentType: 'text/html', body: serverHtml }),
  );
  await page.goto('http://test-furigana-server.local/');

  // Wait for the Anki scan to complete (anki-* class should appear on #sp-nihongo).
  // This ensures the content script has fully run before we assert ruby absence.
  await page
    .locator('#server-para [class*="anki-"]')
    .first()
    .waitFor({ timeout: 15000 })
    .catch(() => {});

  // No <ruby> elements may be present — the source HTML had none and server mode
  // must not inject any.
  const rubyCount = await page.locator('#server-para ruby').count();
  expect(rubyCount).toBe(0);

  await page.close();
});

test('AC-21b: off mode — no extension-injected <ruby> elements on raw-text page', async () => {
  // In off mode the content script does not initialise kuromoji, does not run
  // segmentAndWrap, and does not call scanPage. The page must be left completely
  // unmodified: no <span> injected, no <ruby> injected, no anki-* classes.
  const popup = await openPopup();
  await clearStorage(popup);
  await seedStorage(popup, { lemmaMode: 'off' });
  await clearDictInIndexedDB(popup);
  await popup.close();

  const page = await browserContext.newPage();

  // Plain raw-text page with no markup — same structure as AC-19 so that any
  // accidental injection would be clearly visible in the DOM.
  const offHtml = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>AnkiKan Off Mode Furigana E2E</title></head>
<body>
  <p id="off-para">食べる</p>
</body>
</html>`;

  await page.route('http://test-furigana-off.local/', (route) =>
    route.fulfill({ contentType: 'text/html', body: offHtml }),
  );
  await page.goto('http://test-furigana-off.local/');

  // Give the content script enough time to complete its startup sequence.
  // No positive signal to wait on — we are asserting absence.
  await page.waitForTimeout(5000);

  // No <ruby> elements — the source had none and off mode must not inject any.
  const rubyCount = await page.locator('#off-para ruby').count();
  expect(rubyCount).toBe(0);

  // No anki-* classes either — off mode suppresses the entire pipeline.
  const ankiClassCount = await page.locator('#off-para [class*="anki-"]').count();
  expect(ankiClassCount).toBe(0);

  await page.close();
});
