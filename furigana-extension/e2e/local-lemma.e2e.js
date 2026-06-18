/**
 * E2E tests for issue #3: In-browser Japanese tokenization with local dictionary import.
 *
 * A new `lemmaMode` setting replaces the old `useLemma` boolean.
 * When `lemmaMode === "local"`, the content script tokenizes Japanese text in-browser
 * via kuromoji.js, using dictionary (base) forms for Anki lookups.
 * The dictionary is stored in IndexedDB via Dexie under the DB name `ankikanDict`.
 *
 * These tests are written BEFORE the implementation and must FAIL until the feature lands.
 *
 * Acceptance criteria tested:
 *   AC1  — popup has a #lemmaMode <select> with options off / server / local
 *   AC2  — #importRow is visible when lemmaMode=local, hidden when lemmaMode=off
 *   AC7  — #dictStatus shows "Not loaded" when lemmaMode=local and dict is absent
 *   AC9  — server mode regression: popup reflects lemmaMode=server and scanning still works
 *   AC10 — local mode inflected form (伝え) resolves to lemma (伝える) and gets annotated
 *   AC11 — local mode with no dict falls back gracefully; popup reflects lemmaMode=local
 *   AC13 — lemma lookup is used for annotating (inflected form matches lemma in Anki)
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
// Mock AnkiConnect card data for lemma tests
//   伝える → card 2001, type 0 (unlearned)  — lemma form only; 伝え has no card
//   食べる → card 2002, type 2 (learned)    — surface form (server-mode / fallback tests)
// ---------------------------------------------------------------------------
const MOCK_LEMMA_CARDS = {
  '伝える': { id: 2001, type: 0 },
  '食べる': { id: 2002, type: 2 },
};

// ---------------------------------------------------------------------------
// Mock AnkiConnect HTTP server
// Same structure as ankican.e2e.js to stay consistent with the test suite.
// ---------------------------------------------------------------------------

function createMockAnkiServer() {
  return http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ result: null, error: 'bad json' }));
        return;
      }

      let result = null;

      if (payload.action === 'multi') {
        result = payload.params.actions.map((action) => {
          if (action.action === 'findCards') {
            const match = action.params.query.match(/"([^"]+)"/);
            const word = match ? match[1] : '';
            const card = MOCK_LEMMA_CARDS[word];
            return card ? [card.id] : [];
          }
          return [];
        });
      } else if (payload.action === 'cardsInfo') {
        const idToCard = Object.fromEntries(
          Object.values(MOCK_LEMMA_CARDS).map((c) => [c.id, c])
        );
        result = payload.params.cards
          .filter((id) => idToCard[id])
          .map((id) => ({ cardId: id, type: idToCard[id].type }));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result, error: null }));
    });
  });
}

/**
 * Attempts to start an HTTP server on the given port, retrying every 300 ms for up to
 * `maxWaitMs` milliseconds. Returns true if the server started successfully, false if
 * the port remained occupied for the whole retry window.
 *
 * This is needed because:
 *   1. Playwright runs test files sequentially (workers: 1); the previous file's afterAll
 *      may not have released the port by the time this file's beforeAll fires.
 *   2. The real Anki application may be running on port 8765. In that case we cannot
 *      start the mock server and proceed without it — UI-only tests (AC1, AC2, AC7) do
 *      not depend on the mock and will still fail at the correct assertion.
 */
function listenWithRetry(server, port, host, maxWaitMs = 3000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + maxWaitMs;

    function attempt() {
      const onError = (err) => {
        server.removeListener('listening', onListen);
        if (err.code === 'EADDRINUSE' && Date.now() < deadline) {
          setTimeout(attempt, 300);
        } else {
          // Port is permanently occupied. Resolve false so beforeAll can proceed.
          resolve(false);
        }
      };

      const onListen = () => {
        server.removeListener('error', onError);
        resolve(true);
      };

      server.once('error', onError);
      server.once('listening', onListen);
      server.listen(port, host);
    }

    attempt();
  });
}

// ---------------------------------------------------------------------------
// Read real kuromoji IPAdic dictionary files from node_modules for seeding.
// These are read once at module load time — serialized as plain arrays so they
// can be passed through Playwright's evaluate() serialization boundary.
// ---------------------------------------------------------------------------

const DICT_DIR = path.resolve(__dirname, '../node_modules/kuromoji/dict');
const DICT_FILE_NAMES = [
  'base.dat.gz', 'cc.dat.gz', 'check.dat.gz', 'tid.dat.gz',
  'tid_map.dat.gz', 'tid_pos.dat.gz', 'unk.dat.gz', 'unk_char.dat.gz',
  'unk_compat.dat.gz', 'unk_invoke.dat.gz', 'unk_map.dat.gz', 'unk_pos.dat.gz',
];

// Serialize each file as base64 rather than a number[] — base64 strings cross Playwright's
// evaluate() boundary an order of magnitude faster than a multi-million-element array, which
// otherwise blows past the per-test timeout for the ~19 MB IPAdic dictionary.
const SERIALIZED_DICT_FILES = DICT_FILE_NAMES.map((name) => ({
  name,
  base64: readFileSync(path.join(DICT_DIR, name)).toString('base64'),
}));

// ---------------------------------------------------------------------------
// Fixtures: shared browser context + mock server
// ---------------------------------------------------------------------------

let mockServer;
let mockServerStarted = false;
let browserContext;

test.beforeAll(async () => {
  // Attempt to start mock AnkiConnect on port 8765.
  // If the port is occupied (e.g. real Anki is running), proceed without the mock.
  // UI-only tests (AC1, AC2, AC7) do not depend on the mock and will still fail correctly.
  mockServer = createMockAnkiServer();
  mockServerStarted = await listenWithRetry(mockServer, ANKI_PORT, '127.0.0.1');

  browserContext = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  // Ensure the service worker is up before tests run.
  if (!browserContext.serviceWorkers().length) {
    await browserContext.waitForEvent('serviceworker');
  }
});

test.afterAll(async () => {
  await browserContext?.close();
  if (mockServerStarted) {
    await new Promise((resolve) => mockServer?.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// Helpers
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
 * Seeds the ankikanDict IndexedDB database with real kuromoji IPAdic dict files
 * using raw IndexedDB APIs so there is no dependency on Dexie being globally available
 * in the page context.
 *
 * The store must be seeded at the EXTENSION origin (e.g. via the popup page), because the
 * content script reads dictionary files through the background service worker, which holds
 * the Dexie database at the extension origin — not the page's origin.
 *
 * @param {import('@playwright/test').Page} page - Extension-origin page whose origin will own the DB.
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

    // Open at whatever version currently exists (the popup's Dexie may have already created
    // the DB). If the `files` store is missing, bump the version once to create it. This
    // avoids a VersionError when racing Dexie's own open at the extension origin.
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
 * Opens a test page served at the given URL, containing the given HTML body.
 * The content script auto-scans on load; this helper waits up to 8 s for the first
 * anki-* class to appear (or lets the timeout expire gracefully for negative tests).
 *
 * @param {string} bodyHtml - Inner HTML to place inside <body>.
 * @param {string} [url='http://test-lemma.local/'] - Intercept URL for the test page.
 * @returns {Promise<import('@playwright/test').Page>}
 */
async function openTestPage(bodyHtml, url = 'http://test-lemma.local/') {
  const page = await browserContext.newPage();

  const fullHtml = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>AnkiKan Local Lemma E2E</title></head>
<body>${bodyHtml}</body>
</html>`;

  await page.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body: fullHtml }),
  );

  await page.goto(url);

  // The content script auto-scans on DOMContentLoaded. Wait for annotations.
  await page
    .locator('[class*="anki-"]')
    .first()
    .waitFor({ timeout: 8000 })
    .catch(() => {/* no matches is acceptable for negative / fallback tests */});

  return page;
}

// ---------------------------------------------------------------------------
// AC1 — popup has a #lemmaMode <select> with options off / server / local
// ---------------------------------------------------------------------------

test('popup has #lemmaMode select element with off, server, local options', async () => {
  // The old popup uses a #useLemma checkbox; the new design requires a three-way
  // select so that users can choose between disabled, server-side, and in-browser modes.
  const popup = await openPopup();

  // Assert the select exists — fails immediately if #lemmaMode is absent.
  await expect(popup.locator('#lemmaMode')).toBeVisible({ timeout: 5000 });
  await expect(popup.locator('#lemmaMode')).toHaveCount(1);

  // All three option values must be present in the select.
  await expect(popup.locator('#lemmaMode option[value="off"]')).toHaveCount(1);
  await expect(popup.locator('#lemmaMode option[value="server"]')).toHaveCount(1);
  await expect(popup.locator('#lemmaMode option[value="local"]')).toHaveCount(1);

  // The old #useLemma checkbox must not exist — it is replaced by #lemmaMode.
  await expect(popup.locator('#useLemma')).toHaveCount(0);

  await popup.close();
});

// ---------------------------------------------------------------------------
// AC2 — #importRow visibility tracks the lemmaMode selection
// ---------------------------------------------------------------------------

test('import row is visible when lemmaMode is set to local', async () => {
  // The import row contains the dict-file import button and status indicator.
  // It must only be shown when the user selects local tokenization mode.
  const popup = await openPopup();
  await clearStorage(popup);

  // This assertion fails immediately if #lemmaMode doesn't exist, giving a fast red signal
  // without waiting for the full test timeout on the selectOption call.
  await expect(popup.locator('#lemmaMode')).toBeVisible({ timeout: 5000 });
  await popup.locator('#lemmaMode').selectOption('local');

  await expect(popup.locator('#importRow')).toBeVisible();

  await popup.close();
});

test('import row is hidden when lemmaMode is set to off', async () => {
  // When the user disables lemma lookup entirely, the import row should disappear
  // so the popup does not show irrelevant controls.
  const popup = await openPopup();
  await clearStorage(popup);

  // Same fast-failure guard as the sibling test above.
  await expect(popup.locator('#lemmaMode')).toBeVisible({ timeout: 5000 });
  await popup.locator('#lemmaMode').selectOption('off');

  await expect(popup.locator('#importRow')).not.toBeVisible();

  await popup.close();
});

// ---------------------------------------------------------------------------
// AC7 — #dictStatus shows "Not loaded" when lemmaMode=local and no dict is seeded
// ---------------------------------------------------------------------------

test('dictStatus shows "Not loaded" when lemmaMode is local and dictionary is absent', async () => {
  // The status indicator must reflect that no dictionary data has been imported,
  // so the user knows they need to import before local tokenization will work.
  const popup = await openPopup();
  await clearStorage(popup);
  await seedStorage(popup, { lemmaMode: 'local' });

  // Close and reopen so the popup reads fresh storage on load.
  await popup.close();
  const popup2 = await openPopup();

  // The select must be set to "local" after seeding.
  await expect(popup2.locator('#lemmaMode')).toHaveValue('local', { timeout: 5000 });

  // The status indicator must say "Not loaded".
  await expect(popup2.locator('#dictStatus')).toHaveText(/Not loaded/i);

  await popup2.close();
});

// ---------------------------------------------------------------------------
// AC9 — server mode regression: popup reflects lemmaMode=server and scan still annotates
// ---------------------------------------------------------------------------

test('popup reflects lemmaMode server and scan annotates spans (regression)', async () => {
  // The popup must correctly restore and display lemmaMode:"server" from storage,
  // AND the scan pipeline must continue to annotate words found in Anki.
  // Both assertions are required: the popup UI test (fails before implementation because
  // #lemmaMode does not yet exist) AND the scan behaviour (regression guard).
  const popup = await openPopup();
  await clearStorage(popup);
  await seedStorage(popup, { lemmaMode: 'server' });

  // The popup must show the saved lemmaMode value in the new select element.
  // This fails until #lemmaMode select is implemented.
  await expect(popup.locator('#lemmaMode')).toHaveValue('server', { timeout: 5000 });

  await popup.close();

  // 食べる is a surface form present in MOCK_LEMMA_CARDS as a learned card (type 2).
  const page = await openTestPage('<span id="surface">食べる</span>');

  // The span must receive an anki-* class, proving the scan pipeline still works.
  await expect(page.locator('#surface')).toHaveClass(/anki-/);

  await page.close();
});

// ---------------------------------------------------------------------------
// AC10 + AC13 — local mode: inflected form 伝え resolves to lemma 伝える
// ---------------------------------------------------------------------------

test('local mode resolves inflected form 伝え to lemma 伝える and applies anki-unlearned', async () => {
  // This is the core AC10/AC13 behaviour: the in-browser kuromoji tokenizer must
  // recognise that 伝え is an inflected form of 伝える, look up the lemma in Anki,
  // and annotate the span with the correct status class.
  // The mock only has a card for 伝える (type 0 = unlearned), not for 伝え directly,
  // so a raw surface lookup would yield nothing — only the lemma path succeeds.
  //
  // 伝え in isolation is ambiguous: kuromoji's Viterbi path resolves the bare word to
  // the NOUN 伝え (basic_form === surface, no lemma). It only resolves to the verb
  // 伝える (連用形) given sentence context. Since groupCandidates builds the block text
  // by joining the <span> surfaces within a block (content.grouping.js), the surrounding
  // 彼に…ました context words are wrapped in their own spans so kuromoji sees 彼に伝えました
  // and tags 伝え as 動詞・連用形 → basic_form 伝える.
  const popup = await openPopup();
  await clearStorage(popup);

  // Fail fast if the new popup element doesn't exist yet.
  await expect(popup.locator('#lemmaMode')).toBeVisible({ timeout: 5000 });
  await seedStorage(popup, { lemmaMode: 'local' });

  // Seed the real kuromoji IPAdic dictionary into IndexedDB at the EXTENSION origin
  // (via the popup page) — the content script reads dict files through the background
  // service worker, which owns the Dexie database at the extension origin.
  await seedDictInIndexedDB(popup, SERIALIZED_DICT_FILES);
  await popup.close();

  const page = await browserContext.newPage();
  const fullHtml = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>AnkiKan Local Lemma E2E</title></head>
<body><p><span>彼</span><span>に</span><span id="inflected">伝え</span><span>ました</span></p></body>
</html>`;
  await page.route('http://test-lemma.local/inflected', (route) =>
    route.fulfill({ contentType: 'text/html', body: fullHtml }),
  );
  await page.goto('http://test-lemma.local/inflected');

  await page
    .locator('[class*="anki-"]')
    .first()
    .waitFor({ timeout: 15000 })
    .catch(() => {});

  await expect(page.locator('#inflected')).toHaveClass(/anki-unlearned/);

  await page.close();
});

// ---------------------------------------------------------------------------
// AC11 — local mode with no dict falls back gracefully; popup reflects lemmaMode=local
// ---------------------------------------------------------------------------

test('local mode with no dictionary falls back to surface-form lookup and popup shows local', async () => {
  // If the user has not imported a dictionary, local mode must degrade gracefully:
  // the scan should complete and still annotate words whose surface form is in Anki.
  // The popup must also correctly restore and display lemmaMode:"local" — this assertion
  // fails until #lemmaMode select is implemented, keeping the test in the red phase.
  const popup = await openPopup();
  await clearStorage(popup);
  await seedStorage(popup, { lemmaMode: 'local' });

  // The popup must show the saved lemmaMode value in the new select element.
  // This fails until #lemmaMode select is implemented.
  await expect(popup.locator('#lemmaMode')).toHaveValue('local', { timeout: 5000 });

  await popup.close();

  // Deliberately do NOT seed IndexedDB — simulating a fresh install with no dict.
  // 食べる exists in the mock as a learned card (type 2); its surface form IS the base form,
  // so even without a dict the surface lookup should succeed.
  const page = await openTestPage('<span id="surface">食べる</span>');

  // The span must receive an anki-* class via the surface-form fallback path.
  await expect(page.locator('#surface')).toHaveClass(/anki-/);

  await page.close();
});
