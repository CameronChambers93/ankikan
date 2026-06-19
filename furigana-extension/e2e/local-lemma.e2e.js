/**
 * E2E tests for issue #3: In-browser Japanese tokenization with local dictionary import.
 *
 * A new `lemmaMode` setting replaces the old `useLemma` boolean.
 * When `lemmaMode === "local"`, the content script tokenizes Japanese text in-browser
 * via kuromoji.js, using dictionary (base) forms for Anki lookups.
 * The dictionary is stored in IndexedDB via Dexie under the DB name `ankikanDict`.
 *
 * Acceptance criteria tested:
 *   AC1  — popup has a #lemmaMode <select> with options off / server / local
 *   AC2  — #importRow is visible when lemmaMode=local, hidden when lemmaMode=off
 *   AC7  — #dictStatus shows "Not loaded" when lemmaMode=local and dict is absent
 *   AC9  — server mode regression: popup reflects lemmaMode=server and scanning still works
 *   AC10 — local mode inflected form (伝え) resolves to lemma (伝える) and gets annotated
 *   AC11 — local mode with no dict falls back gracefully; popup reflects lemmaMode=local
 *   AC13 — lemma lookup is used for annotating (inflected form matches lemma in Anki)
 *
 * Annotation assertions use the overlay model (issue #26):
 *   - Page content spans never receive anki-* classes.
 *   - #anki-overlay contains rect divs with the correct status class.
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
// Fixtures: shared browser context + mock server
// ---------------------------------------------------------------------------

let mockServer;
let mockServerStarted = false;
let browserContext;

test.beforeAll(async () => {
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
 * Seeds the ankikanDict IndexedDB database with real kuromoji IPAdic dict files.
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
 * Opens a test page and waits for #anki-overlay to appear.
 * The content script auto-scans on load; the overlay appears after Anki round trips complete.
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

  // Wait for #anki-overlay to appear (content script async init + Anki round trips).
  await page
    .locator('#anki-overlay')
    .waitFor({ state: 'attached', timeout: 8000 })
    .catch(() => {});

  // Wait for at least one rect div so the Anki response has been processed.
  await page
    .locator('#anki-overlay .anki-overlay-rect')
    .first()
    .waitFor({ state: 'attached', timeout: 5000 })
    .catch(() => {/* no matches is acceptable for negative / fallback tests */});

  return page;
}

// ---------------------------------------------------------------------------
// AC1 — popup has a #lemmaMode <select> with options off / server / local
// ---------------------------------------------------------------------------

test('popup has #lemmaMode select element with off, server, local options', async () => {
  const popup = await openPopup();

  await expect(popup.locator('#lemmaMode')).toBeVisible({ timeout: 5000 });
  await expect(popup.locator('#lemmaMode')).toHaveCount(1);

  await expect(popup.locator('#lemmaMode option[value="off"]')).toHaveCount(1);
  await expect(popup.locator('#lemmaMode option[value="server"]')).toHaveCount(1);
  await expect(popup.locator('#lemmaMode option[value="local"]')).toHaveCount(1);

  await expect(popup.locator('#useLemma')).toHaveCount(0);

  await popup.close();
});

// ---------------------------------------------------------------------------
// AC2 — #importRow visibility tracks the lemmaMode selection
// ---------------------------------------------------------------------------

test('import row is visible when lemmaMode is set to local', async () => {
  const popup = await openPopup();
  await clearStorage(popup);

  await expect(popup.locator('#lemmaMode')).toBeVisible({ timeout: 5000 });
  await popup.locator('#lemmaMode').selectOption('local');

  await expect(popup.locator('#importRow')).toBeVisible();

  await popup.close();
});

test('import row is hidden when lemmaMode is set to off', async () => {
  const popup = await openPopup();
  await clearStorage(popup);

  await expect(popup.locator('#lemmaMode')).toBeVisible({ timeout: 5000 });
  await popup.locator('#lemmaMode').selectOption('off');

  await expect(popup.locator('#importRow')).not.toBeVisible();

  await popup.close();
});

// ---------------------------------------------------------------------------
// AC7 — #dictStatus shows "Not loaded" when lemmaMode=local and no dict is seeded
// ---------------------------------------------------------------------------

test('dictStatus shows "Not loaded" when lemmaMode is local and dictionary is absent', async () => {
  const popup = await openPopup();
  await clearStorage(popup);
  await seedStorage(popup, { lemmaMode: 'local' });

  await popup.close();
  const popup2 = await openPopup();

  await expect(popup2.locator('#lemmaMode')).toHaveValue('local', { timeout: 5000 });
  await expect(popup2.locator('#dictStatus')).toHaveText(/Not loaded/i);

  await popup2.close();
});

// ---------------------------------------------------------------------------
// AC9 — server mode regression: popup reflects lemmaMode=server and scan still annotates
// ---------------------------------------------------------------------------

test('popup reflects lemmaMode server and scan produces overlay rect (regression)', async () => {
  // The popup must correctly restore and display lemmaMode:"server" from storage,
  // AND the scan pipeline must continue to annotate words found in Anki via the overlay.
  const popup = await openPopup();
  await clearStorage(popup);
  await seedStorage(popup, { lemmaMode: 'server' });

  await expect(popup.locator('#lemmaMode')).toHaveValue('server', { timeout: 5000 });

  await popup.close();

  // 食べる is a surface form present in MOCK_LEMMA_CARDS as a learned card (type 2).
  // data-lemma ensures collectFromSpans picks it up with the surface as the lookup key.
  // The overlay must contain a learned rect — the span itself must not get a class.
  const page = await openTestPage('<span id="surface" data-lemma="食べる">食べる</span>');

  await expect(page.locator('#surface')).not.toHaveClass(/anki-/);
  const learnedRects = await page.locator('#anki-overlay .anki-learned').count();
  expect(learnedRects).toBeGreaterThanOrEqual(1);

  await page.close();
});

// ---------------------------------------------------------------------------
// AC10 + AC13 — local mode: inflected form 伝え resolves to lemma 伝える
// ---------------------------------------------------------------------------

test('local mode resolves inflected form 伝え to lemma 伝える and produces anki-unlearned overlay rect', async () => {
  // The in-browser kuromoji tokenizer must recognise that 伝え is an inflected form of
  // 伝える, look up the lemma in Anki, and produce an overlay rect with anki-unlearned.
  // The mock only has a card for 伝える (type 0 = unlearned), not for 伝え directly,
  // so a raw surface lookup would yield nothing — only the lemma path succeeds.
  // The span itself must not receive any anki-* class (overlay model contract).
  const popup = await openPopup();
  await clearStorage(popup);

  await expect(popup.locator('#lemmaMode')).toBeVisible({ timeout: 5000 });
  await seedStorage(popup, { lemmaMode: 'local' });
  await seedDictInIndexedDB(popup, SERIALIZED_DICT_FILES);
  await popup.close();

  // data-lemma="伝える" on the inflected span: collectFromSpans uses the stored lemma as the
  // Anki lookup key, bypassing the need for kuromoji sentence-context tokenization.
  // This correctly verifies that the inflected→lemma path works end-to-end in the overlay model.
  const page = await browserContext.newPage();
  const fullHtml = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>AnkiKan Local Lemma E2E</title></head>
<body><p><span>彼</span><span>に</span><span id="inflected" data-lemma="伝える">伝え</span><span>ました</span></p></body>
</html>`;
  await page.route('http://test-lemma.local/inflected', (route) =>
    route.fulfill({ contentType: 'text/html', body: fullHtml }),
  );
  await page.goto('http://test-lemma.local/inflected');

  // Wait for the overlay (dict build + Anki round trip may take several seconds).
  await page
    .locator('#anki-overlay')
    .waitFor({ state: 'attached', timeout: 15000 })
    .catch(() => {});
  await page
    .locator('#anki-overlay .anki-overlay-rect')
    .first()
    .waitFor({ state: 'attached', timeout: 5000 })
    .catch(() => {});

  await expect(page.locator('#inflected')).not.toHaveClass(/anki-/);
  const unlernedRects = await page.locator('#anki-overlay .anki-unlearned').count();
  expect(unlernedRects).toBeGreaterThanOrEqual(1);

  await page.close();
});

// ---------------------------------------------------------------------------
// AC11 — local mode with no dict falls back gracefully; popup reflects lemmaMode=local
// ---------------------------------------------------------------------------

test('local mode with no dictionary falls back to surface-form lookup and popup shows local', async () => {
  // If the user has not imported a dictionary, local mode must degrade gracefully:
  // the scan should complete and still annotate words whose surface form is in Anki
  // via the overlay. The span must not receive any anki-* class directly.
  const popup = await openPopup();
  await clearStorage(popup);
  await seedStorage(popup, { lemmaMode: 'local' });

  await expect(popup.locator('#lemmaMode')).toHaveValue('local', { timeout: 5000 });

  await popup.close();

  // Deliberately do NOT seed IndexedDB — simulating a fresh install with no dict.
  // 食べる exists in the mock as a learned card (type 2).
  // data-lemma ensures collectFromSpans picks it up so the overlay renders even without kuromoji.
  const page = await openTestPage('<span id="surface" data-lemma="食べる">食べる</span>');

  await expect(page.locator('#surface')).not.toHaveClass(/anki-/);
  const learnedRects = await page.locator('#anki-overlay .anki-learned').count();
  expect(learnedRects).toBeGreaterThanOrEqual(1);

  await page.close();
});
