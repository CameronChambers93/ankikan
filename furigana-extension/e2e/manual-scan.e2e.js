/**
 * E2E test for issue #22: Manual "Scan page" trigger path.
 *
 * The `#scanBtn` in the popup sends `{ action: 'scan' }` to the content script,
 * which invokes `scanPage()` and returns `{ found, matched }`. This path was
 * previously untested — only the automatic on-load scan was exercised by existing
 * specs.
 *
 * AC-15 — Manual `scan` message on an already-loaded page rebuilds #anki-overlay,
 * distinct from the auto-scan.
 *
 * Test strategy (overlay model, issue #26):
 *   1. Load a page with Japanese text (`けが`, mock returns card type 0 → anki-unlearned).
 *   2. Wait for the auto-scan to create #anki-overlay with at least one anki-unlearned rect
 *      (proves the page is ready and content script is injected).
 *   3. Remove #anki-overlay from the DOM entirely via page.evaluate — clean baseline.
 *   4. Confirm #anki-overlay is gone.
 *   5. From an extension-origin popup page, send `{ action: 'scan' }` to the test tab via
 *      `chrome.tabs.sendMessage(tabId, { action: 'scan' })` — the same message the popup
 *      #scanBtn delivers.
 *   6. Assert that #anki-overlay is recreated with at least one anki-unlearned rect.
 *   7. Assert that #target span never received an anki-* class (overlay model contract).
 *
 * A passing test can only be explained by the manual trigger working: if the scan
 * message were never delivered, the removed overlay would never be recreated.
 */

import { test, expect, chromium } from '@playwright/test';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '..');
const ANKI_PORT = 8765;

// ---------------------------------------------------------------------------
// Mock AnkiConnect card data
//   けが  → card 3001, type 0 (unlearned)  — hiragana kana-only word
// ---------------------------------------------------------------------------
const MOCK_SCAN_CARDS = {
  'けが': { id: 3001, type: 0 },
};

// ---------------------------------------------------------------------------
// Mock AnkiConnect HTTP server — copied verbatim from local-lemma.e2e.js pattern
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
            const card = MOCK_SCAN_CARDS[word];
            return card ? [card.id] : [];
          }
          return [];
        });
      } else if (payload.action === 'cardsInfo') {
        const idToCard = Object.fromEntries(
          Object.values(MOCK_SCAN_CARDS).map((c) => [c.id, c])
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
 * `maxWaitMs` milliseconds. Resolves true on success, false if the port stays occupied.
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

// ---------------------------------------------------------------------------
// AC-15 — Manual scan rebuilds #anki-overlay after it is cleared
// ---------------------------------------------------------------------------

test('manual scan via chrome.tabs.sendMessage rebuilds #anki-overlay after it is cleared; #target span never gets an anki-* class', async () => {
  // AC-15 (overlay model): The manual scan path (content script `scan` message handler →
  // scanPage → renderOverlay) must recreate #anki-overlay with the correct status rects.
  // We prove this by removing the overlay from the DOM first so only the manual path
  // can explain its reappearance.
  //
  // The #target span must never gain an anki-* class — this is the hard contract of the
  // overlay model (issue #26): page content nodes are never mutated.

  // --- Seed storage so lemmaMode is off (surface-form lookup only) ---
  const seedPopup = await openPopup();
  await clearStorage(seedPopup);
  await seedStorage(seedPopup, { lemmaMode: 'off' });
  await seedPopup.close();

  // --- Open the test page and wait for auto-scan to create the overlay ---
  const TEST_URL = 'http://test-manual-scan.local/';
  const TEST_HTML = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>AnkiKan Manual Scan E2E</title></head>
<body>
  <span id="target">けが</span>
</body>
</html>`;

  const page = await browserContext.newPage();
  await page.route(TEST_URL, (route) =>
    route.fulfill({ contentType: 'text/html', body: TEST_HTML }),
  );
  await page.goto(TEST_URL);

  // Wait for #anki-overlay to appear and contain at least one unlearned rect —
  // this confirms the content script is injected and the Anki mock is reachable.
  await page
    .locator('#anki-overlay')
    .waitFor({ state: 'attached', timeout: 10000 });
  await page
    .locator('#anki-overlay .anki-unlearned')
    .first()
    .waitFor({ state: 'attached', timeout: 5000 });

  // Sanity check: the span itself must not carry any anki-* class.
  await expect(page.locator('#target')).not.toHaveClass(/anki-/);

  // --- Remove #anki-overlay from the DOM to create a clean baseline ---
  // After this, only the manual scan can restore the overlay.
  await page.evaluate(() => {
    const overlay = document.getElementById('anki-overlay');
    if (overlay) overlay.remove();
  });

  // Confirm the overlay is gone.
  await expect(page.locator('#anki-overlay')).not.toBeAttached();

  // --- Fire the manual scan from a popup-page extension context ---
  const popup = await openPopup();

  const result = await popup.evaluate(async (testUrl) => {
    const tabs = await chrome.tabs.query({ url: testUrl });
    if (!tabs.length) return { error: 'tab not found' };
    const tabId = tabs[0].id;
    try {
      return await chrome.tabs.sendMessage(tabId, { action: 'scan' });
    } catch (e) {
      return { error: String(e) };
    }
  }, TEST_URL);

  // The scan handler in content.js returns { ok: true } — verify no error was returned.
  expect(result).not.toHaveProperty('error');

  // --- Assert that the manual scan rebuilt #anki-overlay with the correct rect ---
  // The overlay can only reappear if the manual path ran renderOverlay() on the live DOM.
  await page
    .locator('#anki-overlay')
    .waitFor({ state: 'attached', timeout: 5000 });

  const unlernedRects = await page.locator('#anki-overlay .anki-unlearned').count();
  expect(unlernedRects).toBeGreaterThanOrEqual(1);

  // The span must still have no anki-* class — the overlay model never mutates page content.
  await expect(page.locator('#target')).not.toHaveClass(/anki-/);

  await popup.close();
  await page.close();
});
