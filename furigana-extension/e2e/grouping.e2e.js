/**
 * E2E tests for Issue #10 — Scan full sentences/paragraphs across split HTML elements.
 *
 * Test coverage:
 *   AC1 — Multiple spans inside a single <p> each produce individual overlay rects
 *   AC2 — Spans in separate <p> blocks each get independent overlay rects
 *   AC3 — NHK-style <div> containing multiple spans: each span produces its own overlay rect,
 *          including when spans are nested inside inline wrappers inside the <div>
 *   AC4 — The page content span itself never receives an anki-* class (overlay model contract)
 *
 * Uses a mock AnkiConnect server (same card data as before):
 *   けが    → card 1001, type 0 (unlearned)  → anki-unlearned
 *   アニメ  → card 1002, type 1 (learning)   → anki-learning
 *   日本語  → card 1003, type 2 (learned)    → anki-learned
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
// Shared browser context
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
// Test HTML fixtures
// ---------------------------------------------------------------------------

/**
 * AC1 / AC4: Both けが (unlearned) and アニメ (learning) as direct children of a <p>.
 */
const SINGLE_PARAGRAPH_HTML = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>Grouping E2E — Single Paragraph</title></head>
<body>
  <p id="block">
    <span id="kega">けが</span>
    <span id="anime">アニメ</span>
  </p>
</body>
</html>`;

/**
 * AC2: けが and 日本語 in separate <p> blocks.
 * data-lemma on the ruby span so collectFromSpans uses "日本語" not the full textContent.
 */
const TWO_PARAGRAPHS_HTML = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>Grouping E2E — Two Paragraphs</title></head>
<body>
  <p id="block-a">
    <span id="kega">けが</span>
  </p>
  <p id="block-b">
    <span id="nihongo" data-lemma="日本語"><ruby>日本語<rt>にほんご</rt></ruby></span>
  </p>
</body>
</html>`;

/**
 * AC3a: NHK-style <div> with spans as direct children.
 */
const NHK_DIV_DIRECT_HTML = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>Grouping E2E — NHK div direct</title></head>
<body>
  <div id="block">
    <span id="kega">けが</span>
    <span id="anime">アニメ</span>
  </div>
</body>
</html>`;

/**
 * AC3b: NHK-style <div> where each span is wrapped in an inline element (<em>).
 */
const NHK_DIV_NESTED_HTML = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>Grouping E2E — NHK div nested</title></head>
<body>
  <div id="block">
    <em><span id="kega">けが</span></em>
    <em><span id="anime">アニメ</span></em>
  </div>
</body>
</html>`;

/**
 * AC3c: NHK-style <div> whose spans are wrapped in <a> (hyperlinked vocabulary, common on NHK).
 * data-lemma on the ruby span so collectFromSpans uses "日本語" not the full textContent.
 */
const NHK_DIV_ANCHOR_HTML = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>Grouping E2E — NHK div anchor</title></head>
<body>
  <div id="block">
    <a href="#"><span id="kega">けが</span></a>
    <a href="#"><span id="nihongo" data-lemma="日本語"><ruby>日本語<rt>にほんご</rt></ruby></span></a>
  </div>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Opens a new page, intercepts the given URL to serve the supplied HTML, and
 * waits until #anki-overlay appears and contains at least one rect div.
 * Uses a unique URL per call so each test gets a fresh extension state.
 */
async function openFixture(url, html) {
  const page = await browserContext.newPage();

  await page.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body: html })
  );

  await page.goto(url);

  // Wait for the overlay container to appear (async dict init + Anki round trips).
  await page
    .locator('#anki-overlay')
    .waitFor({ state: 'attached', timeout: 10000 })
    .catch(() => {});

  // Wait for at least one rect div so the Anki response has been processed.
  await page
    .locator('#anki-overlay .anki-overlay-rect')
    .first()
    .waitFor({ state: 'attached', timeout: 5000 })
    .catch(() => { /* no matches is acceptable for negative assertions */ });

  return page;
}

// ---------------------------------------------------------------------------
// AC1 — Multiple spans inside a single <p> each produce individual overlay rects
// ---------------------------------------------------------------------------

test('spans inside a single <p> each receive an individual anki-* overlay rect', async () => {
  // The overlay must contain rects for both words; neither span gets a class on itself.
  const page = await openFixture('http://grouping.test/single-p/', SINGLE_PARAGRAPH_HTML);

  await expect(page.locator('#kega')).not.toHaveClass(/anki-/);
  await expect(page.locator('#anime')).not.toHaveClass(/anki-/);
  const unlernedRects = await page.locator('#anki-overlay .anki-unlearned').count();
  expect(unlernedRects).toBeGreaterThanOrEqual(1);
  const learningRects = await page.locator('#anki-overlay .anki-learning').count();
  expect(learningRects).toBeGreaterThanOrEqual(1);

  await page.close();
});

test('<p> with two spans produces distinct overlay rect classes when the two cards have different types', async () => {
  // A faulty implementation that emits one class for the whole block would produce only one
  // status class in the overlay. This confirms two separate rect classes are present.
  const page = await openFixture('http://grouping.test/single-p-distinct/', SINGLE_PARAGRAPH_HTML);

  await expect(page.locator('#kega')).not.toHaveClass(/anki-/);
  await expect(page.locator('#anime')).not.toHaveClass(/anki-/);
  const unlearned = await page.locator('#anki-overlay .anki-unlearned').count();
  const learning = await page.locator('#anki-overlay .anki-learning').count();
  expect(unlearned).toBeGreaterThanOrEqual(1);
  expect(learning).toBeGreaterThanOrEqual(1);

  await page.close();
});

// ---------------------------------------------------------------------------
// AC2 — Spans in separate <p> blocks each get independent overlay rects
// ---------------------------------------------------------------------------

test('span in first <p> (けが) gets anki-unlearned overlay rect independently of other blocks', async () => {
  // Separate block ancestors must produce independent tokenization units.
  const page = await openFixture('http://grouping.test/two-p-first/', TWO_PARAGRAPHS_HTML);

  await expect(page.locator('#kega')).not.toHaveClass(/anki-/);
  const unlernedRects = await page.locator('#anki-overlay .anki-unlearned').count();
  expect(unlernedRects).toBeGreaterThanOrEqual(1);

  await page.close();
});

test('span in second <p> (日本語) gets anki-learned overlay rect independently of other blocks', async () => {
  // The second block must not be dropped when the page has multiple blocks.
  const page = await openFixture('http://grouping.test/two-p-second/', TWO_PARAGRAPHS_HTML);

  await expect(page.locator('#nihongo')).not.toHaveClass(/anki-/);
  const learnedRects = await page.locator('#anki-overlay .anki-learned').count();
  expect(learnedRects).toBeGreaterThanOrEqual(1);

  await page.close();
});

// ---------------------------------------------------------------------------
// AC3a — NHK-style <div> with direct child spans: each span gets its own overlay rect
// ---------------------------------------------------------------------------

test('direct child spans inside a <div> each produce an individual anki-* overlay rect', async () => {
  // NHK Web Easy wraps article text in <div> rather than <p>. The grouper must
  // recognise <div> as a block boundary so spans are annotated correctly.
  const page = await openFixture('http://grouping.test/nhk-direct/', NHK_DIV_DIRECT_HTML);

  await expect(page.locator('#kega')).not.toHaveClass(/anki-/);
  await expect(page.locator('#anime')).not.toHaveClass(/anki-/);
  const unlernedRects = await page.locator('#anki-overlay .anki-unlearned').count();
  expect(unlernedRects).toBeGreaterThanOrEqual(1);
  const learningRects = await page.locator('#anki-overlay .anki-learning').count();
  expect(learningRects).toBeGreaterThanOrEqual(1);

  await page.close();
});

// ---------------------------------------------------------------------------
// AC3b — NHK-style <div> with spans nested inside inline wrappers (<em>)
// ---------------------------------------------------------------------------

test('spans nested inside <em> inside a <div> both get overlay rects (NHK nested-wrapper pattern)', async () => {
  // findBlockAncestor walks past <em> to the <div>, grouping both words together.
  // Both must produce overlay rects; a broken grouping path that causes an uncaught
  // error would prevent annotation of some or all words.
  const page = await openFixture('http://grouping.test/nhk-em/', NHK_DIV_NESTED_HTML);

  await expect(page.locator('#kega')).not.toHaveClass(/anki-/);
  await expect(page.locator('#anime')).not.toHaveClass(/anki-/);
  const unlernedRects = await page.locator('#anki-overlay .anki-unlearned').count();
  expect(unlernedRects).toBeGreaterThanOrEqual(1);
  const learningRects = await page.locator('#anki-overlay .anki-learning').count();
  expect(learningRects).toBeGreaterThanOrEqual(1);

  await page.close();
});

test('<div>-grouped spans wrapped in <em> produce distinct overlay rect classes per span', async () => {
  // Mirrors the per-<p> class-separation test for the nested NHK pattern.
  const page = await openFixture('http://grouping.test/nhk-em-distinct/', NHK_DIV_NESTED_HTML);

  await expect(page.locator('#kega')).not.toHaveClass(/anki-/);
  await expect(page.locator('#anime')).not.toHaveClass(/anki-/);
  const unlearned = await page.locator('#anki-overlay .anki-unlearned').count();
  const learning = await page.locator('#anki-overlay .anki-learning').count();
  expect(unlearned).toBeGreaterThanOrEqual(1);
  expect(learning).toBeGreaterThanOrEqual(1);

  await page.close();
});

test('spans nested inside <a> inside a <div> both get overlay rects (hyperlinked vocabulary pattern)', async () => {
  // NHK Web Easy hyperlinks vocabulary words: <div><a href="…"><span>けが</span></a></div>.
  // findBlockAncestor walks past <a> to the <div>, correctly grouping both words.
  const page = await openFixture('http://grouping.test/nhk-anchor/', NHK_DIV_ANCHOR_HTML);

  await expect(page.locator('#kega')).not.toHaveClass(/anki-/);
  await expect(page.locator('#nihongo')).not.toHaveClass(/anki-/);
  const unlernedRects = await page.locator('#anki-overlay .anki-unlearned').count();
  expect(unlernedRects).toBeGreaterThanOrEqual(1);
  const learnedRects = await page.locator('#anki-overlay .anki-learned').count();
  expect(learnedRects).toBeGreaterThanOrEqual(1);

  await page.close();
});

// ---------------------------------------------------------------------------
// AC4 — The anki-* class is on the <span>, not on the parent <p> or <div>
//
// These tests already passed before and continue to pass — the block ancestor
// must never receive a status class.
// ---------------------------------------------------------------------------

test('parent <p> does not receive an anki-* class when its child spans are annotated', async () => {
  // The block ancestor is used only for tokenization context grouping; applying
  // the status class to it would highlight the entire paragraph, not individual words.
  const page = await openFixture('http://grouping.test/per-span-p/', SINGLE_PARAGRAPH_HTML);

  await page.locator('#kega').waitFor({ state: 'attached' });

  const parentBlock = page.locator('#block');
  await expect(parentBlock).not.toHaveClass(/anki-unlearned/);
  await expect(parentBlock).not.toHaveClass(/anki-learning/);
  await expect(parentBlock).not.toHaveClass(/anki-learned/);

  await page.close();
});

test('parent <div> does not receive an anki-* class when its child spans are annotated', async () => {
  // Same constraint as for <p>: the <div> block ancestor must never receive a status class.
  const page = await openFixture('http://grouping.test/per-span-div/', NHK_DIV_DIRECT_HTML);

  await page.locator('#kega').waitFor({ state: 'attached' });

  const parentBlock = page.locator('#block');
  await expect(parentBlock).not.toHaveClass(/anki-unlearned/);
  await expect(parentBlock).not.toHaveClass(/anki-learning/);
  await expect(parentBlock).not.toHaveClass(/anki-learned/);

  await page.close();
});
