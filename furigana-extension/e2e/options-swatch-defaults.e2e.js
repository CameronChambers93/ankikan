/**
 * E2E tests for Issue #28 — Per-category colour swatches show correct built-in defaults.
 *
 * Bug: options.js falls back to '#808080' (generic grey) for the disabled per-category
 * swatch when no override is stored, but the actual highlight renders the per-category
 * BUILT_IN_STYLE_FALLBACK colour from style-util.js:
 *   unlearned #dc4646 / learning #e6aa1e / learned #32aa50
 *
 * After Reset to defaults, colorEl.value is set to '' rather than the fallback colour,
 * leaving the swatch as black (browser default for an empty colour input).
 *
 * Acceptance criteria tested:
 *   AC1 — On load (fresh storage), each inheriting category's disabled swatch shows
 *          its built-in default colour, not grey #808080.
 *   AC2 — After clicking "Reset to defaults", each per-category swatch shows its
 *          built-in default colour.
 *   AC3 — Enabling a category override and editing the colour persists across
 *          a close/reopen of the options page.
 *
 * These tests are written BEFORE the fix so AC1 and AC2 are EXPECTED to fail (red phase).
 * AC3 exercises existing persistence behaviour and should pass.
 */

import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '..');

/** Per-category built-in default colours from style-util.js BUILT_IN_STYLE_FALLBACK. */
const BUILT_IN = {
  unlearned: '#dc4646',
  learning:  '#e6aa1e',
  learned:   '#32aa50',
};

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
  // Wait for the background service worker to register before any test runs.
  if (!browserContext.serviceWorkers().length) {
    await browserContext.waitForEvent('serviceworker');
  }
  const [background] = browserContext.serviceWorkers();
  extensionId = background.url().split('/')[2];
});

test.afterAll(async () => {
  await browserContext?.close();
});

/**
 * Issue #47 moved the schema-generated style controls behind a collapsed
 * <details id="style-advanced">. Pre-#47 tests interact with those controls
 * directly, so expand the panel after load to make them visible/actionable.
 * No-op when the panel is absent (older markup / non-options pages).
 */
async function expandStyleAdvanced(page) {
  await page.evaluate(() => {
    const d = document.getElementById('style-advanced');
    if (d) d.open = true;
  });
}

/**
 * Issue #47 also moved the per-category override controls behind a tabbed UI
 * (only one category's panel is visible at a time). Pre-#47 tests interact
 * with unlearned/learning/learned controls directly, so select that
 * category's tab first to make its panel visible/actionable.
 */
async function selectCategoryTab(page, cat) {
  await page.locator(`#style-tab-${cat}`).click();
}

/** Opens options.html as a new page in the shared browser context. */
async function openOptionsPage() {
  const page = await browserContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expandStyleAdvanced(page);
  return page;
}

/** Clears chrome.storage.local from inside the given page. */
async function clearStorage(page) {
  await page.evaluate(() =>
    new Promise((res) => chrome.storage.local.clear(res))
  );
}

/** Returns the full chrome.storage.local contents from inside the given page. */
async function getStorage(page) {
  return page.evaluate(() =>
    new Promise((res) => chrome.storage.local.get(null, res))
  );
}

// ---------------------------------------------------------------------------
// AC1 — On load with fresh storage, inheriting swatches show built-in default colours
// ---------------------------------------------------------------------------

test('AC1: unlearned swatch shows #dc4646 on load when no backgroundColor override is stored', async () => {
  // The swatch value must match what the actual highlight renders, so the user
  // sees an accurate preview even when the checkbox is unchecked (inheriting).
  const page = await openOptionsPage();
  await clearStorage(page);
  // Reload so the page reads from the now-empty storage.
  await page.reload();

  // Auto-retrying assertion: loadStyleSettings runs asynchronously after reload,
  // so a one-shot inputValue read can fire before the swatch is populated.
  await expect(page.locator('#unlearned-bg-color')).toHaveValue(BUILT_IN.unlearned);

  await page.close();
});

test('AC1: learning swatch shows #e6aa1e on load when no backgroundColor override is stored', async () => {
  // The swatch for the learning category must show its canonical default colour
  // (#e6aa1e) rather than the generic grey fallback (#808080) used before the fix.
  const page = await openOptionsPage();
  await clearStorage(page);
  await page.reload();

  // Auto-retrying assertion: loadStyleSettings runs asynchronously after reload,
  // so a one-shot inputValue read can fire before the swatch is populated.
  await expect(page.locator('#learning-bg-color')).toHaveValue(BUILT_IN.learning);

  await page.close();
});

test('AC1: learned swatch shows #32aa50 on load when no backgroundColor override is stored', async () => {
  // Same requirement for the learned category: the swatch must reflect the
  // actual highlight colour the user will see on the page.
  const page = await openOptionsPage();
  await clearStorage(page);
  await page.reload();

  // Auto-retrying assertion: loadStyleSettings runs asynchronously after reload,
  // so a one-shot inputValue read can fire before the swatch is populated.
  await expect(page.locator('#learned-bg-color')).toHaveValue(BUILT_IN.learned);

  await page.close();
});

test('AC1: per-category enable checkboxes remain unchecked when no override is stored', async () => {
  // Showing the built-in colour in the swatch must not mistakenly activate the
  // enable checkbox; the checkbox must stay unchecked so no override is written
  // to storage on the next save.
  const page = await openOptionsPage();
  await clearStorage(page);
  await page.reload();

  await expect(page.locator('#unlearned-bg-color-enabled')).not.toBeChecked();
  await expect(page.locator('#learning-bg-color-enabled')).not.toBeChecked();
  await expect(page.locator('#learned-bg-color-enabled')).not.toBeChecked();

  await page.close();
});

// ---------------------------------------------------------------------------
// AC2 — After "Reset to defaults", swatches show built-in default colours
// ---------------------------------------------------------------------------

test('AC2: unlearned swatch shows #dc4646 after Reset to defaults', async () => {
  // Clicking Reset must restore the visible swatch to the category's canonical
  // default, not leave it as black (the browser default for an empty colour input).
  const page = await openOptionsPage();
  await clearStorage(page);

  // Enable the override and set a custom colour so there is something to reset.
  await selectCategoryTab(page, 'unlearned');
  await page.locator('#unlearned-bg-color-enabled').check();
  await page.locator('#unlearned-bg-color').fill('#aabbcc');
  await page.locator('#unlearned-bg-color').dispatchEvent('input');
  await page.waitForTimeout(300);

  await page.locator('#resetStylesBtn').click();
  await page.waitForTimeout(300);

  const value = await page.inputValue('#unlearned-bg-color');
  expect(value).toBe(BUILT_IN.unlearned);

  await page.close();
});

test('AC2: learning swatch shows #e6aa1e after Reset to defaults', async () => {
  // The reset handler sets colorEl.value = '' before the fix; this must become
  // BUILT_IN_STYLE_FALLBACK[cat].backgroundColor so the swatch is meaningful.
  const page = await openOptionsPage();
  await clearStorage(page);

  await selectCategoryTab(page, 'learning');
  await page.locator('#learning-bg-color-enabled').check();
  await page.locator('#learning-bg-color').fill('#001122');
  await page.locator('#learning-bg-color').dispatchEvent('input');
  await page.waitForTimeout(300);

  await page.locator('#resetStylesBtn').click();
  await page.waitForTimeout(300);

  const value = await page.inputValue('#learning-bg-color');
  expect(value).toBe(BUILT_IN.learning);

  await page.close();
});

test('AC2: learned swatch shows #32aa50 after Reset to defaults', async () => {
  // All three categories must be covered; a partial reset would leave one swatch
  // showing black while the highlight uses the canonical built-in colour.
  const page = await openOptionsPage();
  await clearStorage(page);

  await selectCategoryTab(page, 'learned');
  await page.locator('#learned-bg-color-enabled').check();
  await page.locator('#learned-bg-color').fill('#998877');
  await page.locator('#learned-bg-color').dispatchEvent('input');
  await page.waitForTimeout(300);

  await page.locator('#resetStylesBtn').click();
  await page.waitForTimeout(300);

  const value = await page.inputValue('#learned-bg-color');
  expect(value).toBe(BUILT_IN.learned);

  await page.close();
});

test('AC2: after Reset to defaults, no category has a backgroundColor override in storage', async () => {
  // The cosmetic swatch value after reset must NOT be written to storage as an
  // override; if it were, resolveCategory() would never reach BUILT_IN_STYLE_FALLBACK
  // and the actual highlight colour would be permanently locked to the swatch value.
  const page = await openOptionsPage();
  await clearStorage(page);

  // Establish overrides for all three categories.
  for (const cat of ['unlearned', 'learning', 'learned']) {
    await selectCategoryTab(page, cat);
    await page.locator(`#${cat}-bg-color-enabled`).check();
    await page.locator(`#${cat}-bg-color`).fill('#ff0000');
    await page.locator(`#${cat}-bg-color`).dispatchEvent('input');
  }
  await page.waitForTimeout(300);

  await page.locator('#resetStylesBtn').click();
  await page.waitForTimeout(300);

  const storage = await getStorage(page);
  expect(storage.styleSettings?.unlearned).not.toHaveProperty('backgroundColor');
  expect(storage.styleSettings?.learning).not.toHaveProperty('backgroundColor');
  expect(storage.styleSettings?.learned).not.toHaveProperty('backgroundColor');

  await page.close();
});

// ---------------------------------------------------------------------------
// AC3 — Enabling an override and editing the colour persists across close/reopen
// ---------------------------------------------------------------------------

test('AC3: enabling unlearned override and setting colour persists after options page is reopened', async () => {
  // Persistence is the primary guarantee: a user-chosen colour must survive
  // the page being closed and reopened, and must not be clobbered by the fallback.
  const page = await openOptionsPage();
  await clearStorage(page);

  await selectCategoryTab(page, 'unlearned');
  await page.locator('#unlearned-bg-color-enabled').check();
  await page.locator('#unlearned-bg-color').fill('#112233');
  await page.locator('#unlearned-bg-color').dispatchEvent('input');
  await page.waitForTimeout(300);

  await page.close();

  const page2 = await openOptionsPage();

  // The checkbox must still be checked.
  await expect(page2.locator('#unlearned-bg-color-enabled')).toBeChecked();
  // The colour must be the one the user set, not the fallback.
  const value = await page2.inputValue('#unlearned-bg-color');
  expect(value).toBe('#112233');
  // The input must be enabled because the checkbox is checked.
  await expect(page2.locator('#unlearned-bg-color')).not.toBeDisabled();

  // Storage must contain the override.
  const storage = await getStorage(page2);
  expect(storage.styleSettings?.unlearned?.backgroundColor).toBe('#112233');

  await page2.close();
});

test('AC3: enabling learning override persists and is not overwritten by the built-in fallback', async () => {
  // The fallback must only fire when NO override exists; a real user colour must
  // be preserved verbatim and never replaced with the category default.
  const page = await openOptionsPage();
  await clearStorage(page);

  await selectCategoryTab(page, 'learning');
  await page.locator('#learning-bg-color-enabled').check();
  await page.locator('#learning-bg-color').fill('#aabbcc');
  await page.locator('#learning-bg-color').dispatchEvent('input');
  await page.waitForTimeout(300);

  await page.close();

  const page2 = await openOptionsPage();

  const value = await page2.inputValue('#learning-bg-color');
  expect(value).toBe('#aabbcc');

  const storage = await getStorage(page2);
  expect(storage.styleSettings?.learning?.backgroundColor).toBe('#aabbcc');

  await page2.close();
});

test('AC3: enabling learned override persists and swatch is enabled on reopen', async () => {
  // All three categories must individually support the persist-and-reopen contract;
  // a single passing category would not prove the fix works for the full set.
  const page = await openOptionsPage();
  await clearStorage(page);

  await selectCategoryTab(page, 'learned');
  await page.locator('#learned-bg-color-enabled').check();
  await page.locator('#learned-bg-color').fill('#334455');
  await page.locator('#learned-bg-color').dispatchEvent('input');
  await page.waitForTimeout(300);

  await page.close();

  const page2 = await openOptionsPage();

  await expect(page2.locator('#learned-bg-color-enabled')).toBeChecked();
  await expect(page2.locator('#learned-bg-color')).not.toBeDisabled();
  const value = await page2.inputValue('#learned-bg-color');
  expect(value).toBe('#334455');

  await page2.close();
});
