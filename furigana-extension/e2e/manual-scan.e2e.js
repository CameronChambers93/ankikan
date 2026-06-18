/**
 * E2E test for issue #22: Manual "Scan page" trigger path.
 *
 * The `#scanBtn` in the popup sends `{ action: 'scan' }` to the content script,
 * which invokes `scanPage()` and returns `{ found, matched }`. This path was
 * previously untested — only the automatic on-load scan was exercised by existing
 * specs.
 *
 * AC-15 — Manual `scan` message on an already-loaded page re-annotates spans,
 * distinct from the auto-scan.
 *
 * Test strategy:
 *   1. Load a page with a Japanese span (`けが`, mock returns card type 0 → anki-unlearned).
 *   2. Wait for the auto-scan to annotate it (proves the page is ready and content script
 *      is injected).
 *   3. Strip all `anki-*` classes from every span via page.evaluate.
 *   4. From an extension-origin popup page, send `{ action: 'scan' }` to the test tab via
 *      `chrome.tabs.sendMessage(tabId, { action: 'scan' })` — the same message the popup
 *      #scanBtn delivers. This is the manual path being exercised; the popup button click is
 *      not used directly because `chrome.tabs.query({ active: true, currentWindow: true })`
 *      returns the popup page itself once it is focused, not the test page. Sending the
 *      message from the popup-page JS context via a known tab ID is the faithful equivalent
 *      and exercises the same content-script handler.
 *   5. Assert that the span regains `anki-unlearned` — proving the MANUAL path ran.
 *
 * A passing test can only be explained by the manual trigger working: if the scan
 * message were never delivered, the stripped classes would never return.
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
 * Needed because the previous test file's afterAll may not have released port 8765 yet.
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

// ---------------------------------------------------------------------------
// AC-15 — Manual scan re-annotates spans after auto-scan classes are stripped
// ---------------------------------------------------------------------------

test('manual scan via chrome.tabs.sendMessage re-annotates spans after anki-* classes are cleared', async () => {
  // AC-15: The manual scan path (content script `scan` message handler → scanPage) must
  // independently annotate spans. We prove this by stripping auto-scan annotations first
  // so a pass requires the manual path to run.
  //
  // The message is sent via chrome.tabs.sendMessage from the popup-page JS context —
  // the same underlying call the popup #scanBtn makes — using the known test page tab ID.

  // --- Seed storage so lemmaMode is off (surface-form lookup only) ---
  const seedPopup = await openPopup();
  await clearStorage(seedPopup);
  await seedStorage(seedPopup, { lemmaMode: 'off' });
  await seedPopup.close();

  // --- Open the test page and wait for auto-scan to annotate ---
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

  // Wait for the auto-scan to annotate the span — this also confirms the content script
  // is injected and the Anki mock is reachable before we proceed to the manual path.
  await page.locator('#target[class*="anki-"]').waitFor({ timeout: 8000 });

  // Sanity check: auto-scan annotated correctly.
  await expect(page.locator('#target')).toHaveClass(/anki-unlearned/);

  // --- Strip all anki-* classes to create a clean baseline ---
  // After this, only the manual scan can restore the classes.
  await page.evaluate(() => {
    document.querySelectorAll('[class*="anki-"]').forEach((el) => {
      [...el.classList]
        .filter((c) => c.startsWith('anki-'))
        .forEach((c) => el.classList.remove(c));
    });
  });

  // Confirm the strip succeeded — no anki-* class remains.
  await expect(page.locator('#target')).not.toHaveClass(/anki-/);

  // --- Fire the manual scan from a popup-page extension context ---
  // Open a popup page to get access to the extension's chrome.tabs API. We find the
  // test tab by its URL, then call chrome.tabs.sendMessage — identical to what
  // popup.js does when the user clicks #scanBtn.
  const popup = await openPopup();

  const result = await popup.evaluate(async (testUrl) => {
    // Find the tab running the test page.
    const tabs = await chrome.tabs.query({ url: testUrl });
    if (!tabs.length) return { error: 'tab not found' };
    const tabId = tabs[0].id;
    try {
      return await chrome.tabs.sendMessage(tabId, { action: 'scan' });
    } catch (e) {
      return { error: String(e) };
    }
  }, TEST_URL);

  // The scan handler in content.js returns { found, matched } — verify the round-trip
  // succeeded and at least one span was found and matched.
  expect(result).not.toHaveProperty('error');
  expect(result.found).toBeGreaterThanOrEqual(1);
  expect(result.matched).toBeGreaterThanOrEqual(1);

  // --- Assert that the manual scan restored the annotation ---
  // The class can only be present again if the manual path ran scanPage() on the live DOM.
  await expect(page.locator('#target')).toHaveClass(/anki-unlearned/);

  await popup.close();
  await page.close();
});
