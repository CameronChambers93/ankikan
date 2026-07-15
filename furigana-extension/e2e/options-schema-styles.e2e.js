/**
 * E2E tests for Issue #45 — Schema-driven Highlight Style engine.
 *
 * Before this issue, options.html hand-wrote one <input> per property/category
 * pair, and only backgroundColor + backgroundOpacity had per-category override
 * controls (with paired `-enabled` checkboxes). The refactor generates the
 * options UI from `STYLE_SCHEMA` (see options.schema.test.js / style-util.schema.test.js
 * for the Vitest/JSDOM-level specs), so every one of the 6 style properties —
 * backgroundColor, backgroundOpacity, borderRadius, outlineColor, outlineOpacity,
 * outlineWidth — becomes per-category overridable, not just the original two.
 *
 * These tests exercise the one genuinely NEW user-facing capability in a real
 * Chrome browser: a non-background property (outlineWidth) gaining a per-category
 * override control, and that override flowing UI -> chrome.storage.local ->
 * content-script rendered CSS. They are written BEFORE the options.html /
 * options.js schema-driven generation lands and MUST FAIL until it does — the
 * DOM ids under test (`learned-outline-width`, `learned-outline-width-enabled`)
 * do not exist in the pre-refactor static markup.
 *
 * Test IDs continue the issue #45 sequence after the Vitest specs (T-45-001..014).
 *
 * Acceptance criteria tested:
 *   AC-2 (new capability)  — T-45-020: options page writes a per-category override
 *                              for a non-background property (learned/outlineWidth)
 *                              to storage, scoped to only that key.
 *   AC-2 (persistence)     — T-45-021: the override round-trips (checkbox + value)
 *                              across an options-page close/reopen.
 *   AC-2 (render path)     — T-45-022: the saved override flows through
 *                              buildStyleSheet into real rendered CSS on a page
 *                              running the content script, verified via
 *                              getComputedStyle on a `.anki-learned` element.
 *
 * AC-4 (existing suites must stay green) is NOT re-asserted here — it is
 * covered by re-running options-styles.e2e.js, page-load-styles.e2e.js,
 * popup-styles.e2e.js, unknown-category.e2e.js and options-swatch-defaults.e2e.js
 * unmodified, per the issue plan.
 */

import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '..');

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
  // Wait for the background service worker to be available before any test runs.
  if (!browserContext.serviceWorkers().length) {
    await browserContext.waitForEvent('serviceworker');
  }
  const [background] = browserContext.serviceWorkers();
  extensionId = background.url().split('/')[2];
});

test.afterAll(async () => {
  await browserContext?.close();
});

/** Opens options.html as a new page in the shared browser context. */
async function openOptionsPage() {
  const page = await browserContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  return page;
}

/** Returns the full chrome.storage.local contents evaluated from inside a given page. */
async function getStorage(page) {
  return page.evaluate(() =>
    new Promise((res) => chrome.storage.local.get(null, res))
  );
}

/** Clears chrome.storage.local from inside a given page. */
async function clearStorage(page) {
  await page.evaluate(() =>
    new Promise((res) => chrome.storage.local.clear(res))
  );
}

// ---------------------------------------------------------------------------
// AC-2 (new capability) — T-45-020: a non-background property (outlineWidth)
// becomes per-category overridable, and the write is scoped to only that key.
// ---------------------------------------------------------------------------

test('T-45-020 enabling learned-outline-width-enabled and setting learned-outline-width writes ONLY outlineWidth to styleSettings.learned', async () => {
  // Before issue #45, outlineWidth had no per-category enable checkbox at all —
  // only backgroundColor did. This proves the schema-driven generator produces
  // a working override control for a property that never had one, and that
  // currentStyleSettings() scopes the write to exactly that key (no leakage of
  // unrelated properties like backgroundColor into styleSettings.learned).
  const page = await openOptionsPage();
  await clearStorage(page);

  // Fail fast (5s) with a clear "not attached" message rather than the
  // default 30s action-timeout, which Playwright reports as a confusing
  // "Target page, context or browser has been closed" once the enclosing
  // test itself times out.
  await expect(page.locator('#learned-outline-width-enabled')).toBeAttached({ timeout: 5000 });
  await expect(page.locator('#learned-outline-width')).toBeAttached({ timeout: 5000 });

  await page.locator('#learned-outline-width-enabled').check();
  await page.locator('#learned-outline-width').fill('9');
  // outlineWidth is a numeric input; the pre-refactor global/number inputs save
  // on 'change' (see numberInputIds in options.js), so mirror that here.
  await page.locator('#learned-outline-width').dispatchEvent('change');
  await page.waitForTimeout(300);

  const storage = await getStorage(page);
  expect(storage.styleSettings?.learned).toEqual({ outlineWidth: 9 });
  expect(storage.styleSettings?.learned).not.toHaveProperty('backgroundColor');
  expect(storage.styleSettings?.learned).not.toHaveProperty('outlineColor');
  expect(storage.styleSettings?.learned).not.toHaveProperty('borderRadius');

  await page.close();
});

// ---------------------------------------------------------------------------
// AC-2 (persistence) — T-45-021: the override round-trips across a close/reopen.
// ---------------------------------------------------------------------------

test('T-45-021 learned-outline-width override survives closing and reopening the options page', async () => {
  // Proves loadStyleSettings regenerates the schema-driven controls AND
  // repopulates them from storage — not just that the initial write succeeds.
  const page = await openOptionsPage();
  await clearStorage(page);

  await expect(page.locator('#learned-outline-width-enabled')).toBeAttached({ timeout: 5000 });
  await expect(page.locator('#learned-outline-width')).toBeAttached({ timeout: 5000 });

  await page.locator('#learned-outline-width-enabled').check();
  await page.locator('#learned-outline-width').fill('9');
  await page.locator('#learned-outline-width').dispatchEvent('change');
  await page.waitForTimeout(300);

  await page.close();

  const page2 = await openOptionsPage();
  await expect(page2.locator('#learned-outline-width-enabled')).toBeChecked();
  await expect(page2.locator('#learned-outline-width')).toHaveValue('9');

  const storage = await getStorage(page2);
  expect(storage.styleSettings?.learned?.outlineWidth).toBe(9);

  await page2.close();
});

// ---------------------------------------------------------------------------
// AC-2 (render path) — T-45-022: the saved override flows through
// buildStyleSheet into real rendered CSS, verified via getComputedStyle.
// ---------------------------------------------------------------------------

test('T-45-022 a saved learned-outline-width override renders as outline-width on a real .anki-learned element', async () => {
  // Drives the full pipeline: options-page control -> chrome.storage.local ->
  // content-script injectStyles()/buildStyleSheet() -> real computed CSS.
  // The test page itself contains no Japanese text, so scanPage() finds no
  // candidates and never touches (or clears) any anki-* class — the
  // .anki-learned element is added directly via page.evaluate() AFTER the
  // content script's one-time initial load pass, avoiding any dependency on
  // a live AnkiConnect connection for this rendering-only assertion.
  const DISTINCT_OUTLINE_WIDTH = 9;

  // Step 1: Set the override via the options page (exercises AC-2 UI -> storage).
  const optionsPage = await openOptionsPage();
  await clearStorage(optionsPage);
  await expect(optionsPage.locator('#learned-outline-width-enabled')).toBeAttached({ timeout: 5000 });
  await expect(optionsPage.locator('#learned-outline-width')).toBeAttached({ timeout: 5000 });
  await optionsPage.locator('#learned-outline-width-enabled').check();
  await optionsPage.locator('#learned-outline-width').fill(String(DISTINCT_OUTLINE_WIDTH));
  await optionsPage.locator('#learned-outline-width').dispatchEvent('change');
  await optionsPage.waitForTimeout(300);

  const storage = await getStorage(optionsPage);
  expect(storage.styleSettings?.learned?.outlineWidth).toBe(DISTINCT_OUTLINE_WIDTH);
  await optionsPage.close();

  // Step 2: Navigate to a plain (non-Japanese) test page. content.js still runs
  // injectStyles() unconditionally on load, deriving CSS from the storage we
  // just wrote — but scanPage() finds zero candidates and never removes/adds
  // any anki-* class, so it cannot interfere with the element we add below.
  const TEST_URL = 'http://test-outline-width-render.local/';
  const TEST_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Schema Styles Render E2E</title></head>
<body><p>No Japanese text on this page.</p></body>
</html>`;

  const page = await browserContext.newPage();
  await page.route(TEST_URL, (route) =>
    route.fulfill({ contentType: 'text/html', body: TEST_HTML })
  );
  await page.goto(TEST_URL);

  // Step 3: Wait for content.js to inject #anki-dynamic-styles from the stored
  // override (proves buildStyleSheet ran with our learned.outlineWidth value).
  await page.locator('#anki-dynamic-styles').waitFor({ state: 'attached', timeout: 5000 });
  const css = await page.locator('#anki-dynamic-styles').textContent();
  expect(css).toContain(`.anki-learned { `);
  expect(css).toContain(`outline: ${DISTINCT_OUTLINE_WIDTH}px solid`);

  // Step 4: Append a real .anki-learned element and read its computed style —
  // this is the assertion that the override reaches actual rendered CSS, not
  // just the text content of the injected <style> element.
  const outlineWidthPx = await page.evaluate(() => {
    const span = document.createElement('span');
    span.className = 'anki-learned';
    span.textContent = 'rendered element';
    document.body.appendChild(span);
    return getComputedStyle(span).outlineWidth;
  });

  expect(outlineWidthPx).toBe(`${DISTINCT_OUTLINE_WIDTH}px`);

  await page.close();
});
