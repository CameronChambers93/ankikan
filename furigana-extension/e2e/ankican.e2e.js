/**
 * E2E tests for the AnkiKan extension against a live AnkiConnect instance.
 *
 * Prerequisites:
 *   - Anki must be running with the AnkiConnect add-on active (localhost:8765).
 *   - The "AnkiKan-E2E" deck must exist with the following cards:
 *       けが    — Expression field, type 0 (new/unlearned)
 *       アニメ  — Expression field, type 1 (learning)
 *       日本語  — Expression field, type 2 (review/learned)
 *   Run the setup script to create/restore this deck:
 *       node e2e/setup-anki-e2e.js
 *
 * Test coverage:
 *   - Kana-only spans (hiragana けが, katakana アニメ) are highlighted          [issue #1]
 *   - Ruby-bearing kanji spans (日本語) are still highlighted                   [regression]
 *   - ASCII, punctuation, and whitespace spans are NOT highlighted              [issue #1]
 *   - Card type maps to the correct status class (unlearned/learning/learned)
 */

import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '..');

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
// Fixtures: shared browser context with extension loaded
// ---------------------------------------------------------------------------

let browserContext;

test.beforeAll(async () => {
  browserContext = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });
});

test.afterAll(async () => {
  await browserContext?.close();
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
