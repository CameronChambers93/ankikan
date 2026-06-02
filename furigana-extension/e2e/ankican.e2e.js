/**
 * E2E tests for the AnkiKan extension using Playwright + a mock AnkiConnect server.
 *
 * The background service worker calls fetch('http://127.0.0.1:8765', ...) directly,
 * so page.route() cannot intercept it. Instead we spin up a real Node http server
 * on port 8765 that returns pre-canned AnkiConnect responses.
 *
 * Test coverage:
 *   - Kana-only spans (hiragana けが, katakana アニメ) are highlighted          [issue #1]
 *   - Ruby-bearing kanji spans (日本語) are still highlighted                   [regression]
 *   - ASCII, punctuation, and whitespace spans are NOT highlighted              [issue #1]
 *   - Card type maps to the correct status class (unlearned/learning/learned)
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
    // Handle CORS preflight
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
            // Query is like: Expression:"けが"
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
  <p><span id="kanji"><ruby>日本語<rt>にほんご</rt></ruby></span></p>

  <!-- These should NOT be highlighted -->
  <p><span id="ascii">hello</span></p>
  <p><span id="punctuation">。</span></p>
  <p><span id="whitespace">   </span></p>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Fixtures: shared browser context with extension + mock server
// ---------------------------------------------------------------------------

let mockServer;
let browserContext;

test.beforeAll(async () => {
  // Start mock AnkiConnect on port 8765
  mockServer = createMockAnkiServer();
  await new Promise((resolve) => mockServer.listen(ANKI_PORT, '127.0.0.1', resolve));

  // Launch Chrome with the extension loaded
  browserContext = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
    // Suppress "Chrome is being controlled by automated software" banner
    ignoreDefaultArgs: ['--enable-automation'],
  });
});

test.afterAll(async () => {
  await browserContext?.close();
  await new Promise((resolve) => mockServer?.close(resolve));
});

// Helper: open the test page and wait for the content script to annotate it
async function openTestPage() {
  const page = await browserContext.newPage();

  // Intercept http://test.local/ and serve our HTML fixture
  await page.route('http://test.local/', (route) =>
    route.fulfill({ contentType: 'text/html', body: TEST_PAGE_HTML })
  );

  await page.goto('http://test.local/');

  // The content script auto-scans on load. Wait until at least one anki class
  // appears (or a short timeout if nothing matches — handles "no match" cases).
  await page
    .locator('[class*="anki-"]')
    .first()
    .waitFor({ timeout: 5000 })
    .catch(() => {/* no matches is fine for the negative tests */});

  return page;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('hiragana-only span (けが) gets anki-unlearned class', async () => {
  const page = await openTestPage();
  await expect(page.locator('#hiragana')).toHaveClass(/anki-unlearned/);
  await page.close();
});

test('katakana-only span (アニメ) gets anki-learning class', async () => {
  const page = await openTestPage();
  await expect(page.locator('#katakana')).toHaveClass(/anki-learning/);
  await page.close();
});

test('ruby-bearing kanji span (日本語) gets anki-learned class — no regression', async () => {
  const page = await openTestPage();
  await expect(page.locator('#kanji')).toHaveClass(/anki-learned/);
  await page.close();
});

test('ASCII span (hello) is not annotated', async () => {
  const page = await openTestPage();
  const span = page.locator('#ascii');
  await expect(span).not.toHaveClass(/anki-/);
  await page.close();
});

test('CJK punctuation span (。) is not annotated', async () => {
  const page = await openTestPage();
  await expect(page.locator('#punctuation')).not.toHaveClass(/anki-/);
  await page.close();
});

test('whitespace-only span is not annotated', async () => {
  const page = await openTestPage();
  await expect(page.locator('#whitespace')).not.toHaveClass(/anki-/);
  await page.close();
});
