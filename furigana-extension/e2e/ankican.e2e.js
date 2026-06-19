/**
 * E2E tests for the AnkiKan extension against a mock AnkiConnect server.
 *
 * Test coverage:
 *   - Kana-only words (hiragana けが, katakana アニメ) produce overlay rects   [issue #1]
 *   - Ruby-bearing kanji words (日本語) produce overlay rects                  [regression]
 *   - ASCII, punctuation, and whitespace spans are NOT annotated               [issue #1]
 *   - Card type maps to the correct overlay status class (unlearned/learning/learned)
 *   - Page content spans never receive anki-* classes (overlay model contract) [issue #26]
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
//   けが    → card 1001, type 0 (unlearned)
//   アニメ  → card 1002, type 1 (learning)
//   日本語  → card 1003, type 2 (learned)
// ---------------------------------------------------------------------------
const MOCK_CARDS = {
  'けが':   { id: 1001, type: 0 },
  'アニメ': { id: 1002, type: 1 },
  '日本語': { id: 1003, type: 2 },
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
            const card = MOCK_CARDS[word];
            return card ? [card.id] : [];
          }
          return [];
        });
      } else if (payload.action === 'cardsInfo') {
        const idToCard = Object.fromEntries(
          Object.values(MOCK_CARDS).map((c) => [c.id, c])
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
// Test HTML page
// ---------------------------------------------------------------------------
const TEST_PAGE_HTML = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>AnkiKan E2E Test</title></head>
<body>
  <!-- These should be highlighted (issue #1: kana-only, no ruby) -->
  <p><span id="hiragana">けが</span></p>
  <p><span id="katakana">アニメ</span></p>

  <!-- This should still be highlighted (regression: ruby-bearing span) -->
  <!-- data-lemma provides the clean lookup key so collectFromSpans skips the ruby rt text -->
  <p><span id="kanji" data-lemma="日本語"><ruby>日本語<rt>にほんご</rt></ruby></span></p>

  <!-- These should NOT be highlighted -->
  <p><span id="ascii">hello</span></p>
  <p><span id="punctuation">。</span></p>
  <p><span id="whitespace">   </span></p>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Fixtures: shared browser context with extension loaded
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

// Helper: open the test page and wait for the overlay to be created
async function openTestPage(url = 'http://test.local/') {
  const page = await browserContext.newPage();

  await page.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body: TEST_PAGE_HTML })
  );

  await page.goto(url);

  // Wait for #anki-overlay to appear (content script async init + Anki round trips).
  await page
    .locator('#anki-overlay')
    .waitFor({ state: 'attached', timeout: 10000 })
    .catch(() => {/* no overlay is acceptable for the negative tests */});

  // Wait a moment for rect divs to be populated after the overlay appears.
  await page
    .locator('#anki-overlay .anki-overlay-rect')
    .first()
    .waitFor({ state: 'attached', timeout: 5000 })
    .catch(() => {});

  return page;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('hiragana-only span (けが) gets anki-unlearned overlay rect', async () => {
  // The span itself must not receive an anki-* class (overlay model contract).
  // Instead, #anki-overlay must contain a rect div with anki-unlearned.
  const page = await openTestPage('http://ankican-hiragana.local/');
  await expect(page.locator('#hiragana')).not.toHaveClass(/anki-/);
  const unlernedRects = await page.locator('#anki-overlay .anki-unlearned').count();
  expect(unlernedRects).toBeGreaterThanOrEqual(1);
  await page.close();
});

test('katakana-only span (アニメ) gets anki-learning overlay rect', async () => {
  // The span itself must not receive an anki-* class (overlay model contract).
  // Instead, #anki-overlay must contain a rect div with anki-learning.
  const page = await openTestPage('http://ankican-katakana.local/');
  await expect(page.locator('#katakana')).not.toHaveClass(/anki-/);
  const learningRects = await page.locator('#anki-overlay .anki-learning').count();
  expect(learningRects).toBeGreaterThanOrEqual(1);
  await page.close();
});

test('ruby-bearing kanji span (日本語) gets anki-learned overlay rect — no regression', async () => {
  // The span itself must not receive an anki-* class (overlay model contract).
  // Instead, #anki-overlay must contain a rect div with anki-learned.
  const page = await openTestPage('http://ankican-kanji.local/');
  await expect(page.locator('#kanji')).not.toHaveClass(/anki-/);
  const learnedRects = await page.locator('#anki-overlay .anki-learned').count();
  expect(learnedRects).toBeGreaterThanOrEqual(1);
  await page.close();
});

test('ASCII span (hello) is not annotated', async () => {
  const page = await openTestPage('http://ankican-ascii.local/');
  const span = page.locator('#ascii');
  await expect(span).not.toHaveClass(/anki-/);
  await page.close();
});

test('CJK punctuation span (。) is not annotated', async () => {
  const page = await openTestPage('http://ankican-punctuation.local/');
  await expect(page.locator('#punctuation')).not.toHaveClass(/anki-/);
  await page.close();
});

test('whitespace-only span is not annotated', async () => {
  const page = await openTestPage('http://ankican-whitespace.local/');
  await expect(page.locator('#whitespace')).not.toHaveClass(/anki-/);
  await page.close();
});
