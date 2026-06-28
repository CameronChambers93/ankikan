/**
 * E2E test for Issue #8 — styleSettings not fetched from storage on page load.
 *
 * Root cause: DEFAULTS in content.js does not include a `styleSettings` key, so
 * `ext.storage.local.get(DEFAULTS)` never retrieves the user's saved style overrides.
 * On every page load the extension falls through to BUILT_IN_STYLE_FALLBACK colours.
 *
 * Fix: add `styleSettings: null` to DEFAULTS so the storage fetch includes that key.
 *
 * Acceptance criterion (AC6):
 *   Given a styleSettings object already in storage (saved by the Options page),
 *   when the user navigates to a page,
 *   then #anki-dynamic-styles contains CSS derived from the stored overrides —
 *   NOT the built-in BUILT_IN_STYLE_FALLBACK colours.
 *
 * Built-in unlearned fallback: #dc4646 → rgba(220, 70, 70, ...)
 * Custom override used in this test: #0000ff → rgba(0, 0, 255, ...)
 *
 * This test FAILS before the fix (DEFAULTS lacks styleSettings so storage returns
 * undefined for it, and the built-in red fallback is applied instead of the blue).
 * It PASSES after adding `styleSettings: null` to DEFAULTS.
 */

import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Custom styleSettings written to storage before each navigation.
// The distinctive blue (#0000ff) for unlearned makes the assertion unambiguous.
// ---------------------------------------------------------------------------
const CUSTOM_STYLE_SETTINGS = {
  default: {
    backgroundColor: '#808080',
    backgroundOpacity: 0.22,
    borderRadius: 3,
    outlineColor: '#808080',
    outlineOpacity: 0.35,
    outlineWidth: 1,
  },
  unlearned: { backgroundColor: '#0000ff' },
  learning: {},
  learned: {},
};

// Built-in fallback colour for anki-unlearned — must NOT appear after the fix.
const BUILT_IN_RED = 'rgba(220, 70, 70';
// Custom override colour for anki-unlearned — must appear after the fix.
const CUSTOM_BLUE = 'rgba(0, 0, 255';

// ---------------------------------------------------------------------------
// Minimal test page — content.js injects #anki-dynamic-styles regardless of
// whether any span is actually classified, because injectStyles() is called
// unconditionally during initialisation before scanPage().
// ---------------------------------------------------------------------------
const TEST_PAGE_HTML = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>Page Load Styles E2E Test</title></head>
<body>
  <p><span id="word">日本語</span></p>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Shared browser context (one extension instance for the whole file)
// ---------------------------------------------------------------------------
let browserContext;
let extensionId;

test.beforeAll(async () => {
  browserContext = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  // Obtain the extension ID from the background service worker URL.
  if (!browserContext.serviceWorkers().length) {
    await browserContext.waitForEvent('serviceworker');
  }
  const [background] = browserContext.serviceWorkers();
  extensionId = background.url().split('/')[2];
});

test.afterAll(async () => {
  await browserContext?.close();
});

// ---------------------------------------------------------------------------
// AC6 — stored styleSettings must be applied to #anki-dynamic-styles on load
// ---------------------------------------------------------------------------

test('T-8-001 page load applies stored styleSettings overrides, not built-in fallback colours', async () => {
  // content.js calls injectStyles() unconditionally on page load. The CSS it
  // injects must reflect whatever is in chrome.storage — not the hard-coded
  // BUILT_IN_STYLE_FALLBACK values — once the DEFAULTS fix is in place.
  const page = await browserContext.newPage();

  // Step 1: Write the custom styleSettings into extension storage.
  // We open a chrome-extension page first so chrome.storage.local is accessible.
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.evaluate(
    (settings) =>
      new Promise((resolve) =>
        chrome.storage.local.set({ styleSettings: settings }, resolve)
      ),
    CUSTOM_STYLE_SETTINGS
  );

  // Step 2: Navigate to the test page (served via route interception so no
  // real server is required). content.js will run and call injectStyles().
  await page.route('http://test.local/page-load-styles', (route) =>
    route.fulfill({ contentType: 'text/html', body: TEST_PAGE_HTML })
  );
  await page.goto('http://test.local/page-load-styles');

  // Step 3: Wait for content.js to inject #anki-dynamic-styles.
  // state:'attached' is required — <style> elements are never "visible" to Playwright.
  await page.locator('#anki-dynamic-styles').waitFor({ state: 'attached', timeout: 5000 });

  // Step 4: Read the injected CSS.
  const css = await page.locator('#anki-dynamic-styles').textContent();

  // Step 5: Assert the stored blue override is present …
  expect(css).toContain(CUSTOM_BLUE);

  // … and the built-in red fallback is absent.
  expect(css).not.toContain(BUILT_IN_RED);

  await page.close();
});
