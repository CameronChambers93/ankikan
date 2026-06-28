/**
 * E2E tests for Issue #6 — Move Highlight Style settings to a dedicated options page.
 *
 * Problem: <input type="color"> in popup.html closes the popup on Windows when the OS
 * colour picker opens. Fix: extract the Highlight Style section to options.html (a full
 * browser tab) opened via chrome.runtime.openOptionsPage().
 *
 * These tests are written BEFORE the fix is implemented and must FAIL until it lands.
 *
 * Acceptance criteria tested:
 *   AC1 — manifest.json declares options_ui → options.html with open_in_tab: true
 *   AC2 — options.html contains #global-bg-color, #resetStylesBtn and all colour controls
 *   AC3 — popup.html has no <input type="color">, retains #scanBtn, has #openOptionsBtn
 *   AC4 — Clicking #openOptionsBtn in popup opens a new tab to the options page URL
 *   AC5 — Setting #global-bg-color on options page persists across page close/reopen
 *   AC6 — Checking #unlearned-bg-color-enabled and setting #unlearned-bg-color persists
 *   AC7 — Unchecking #unlearned-bg-color-enabled removes backgroundColor from storage
 *   AC8 — #resetStylesBtn restores defaults and unchecks per-category checkboxes
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
  // Wait for the background service worker to be available before any test runs
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

/** Opens popup.html as a new page in the shared browser context. */
async function openPopup() {
  const page = await browserContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
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
// AC1 — manifest.json declares options_ui pointing at options.html with open_in_tab
// ---------------------------------------------------------------------------

test('T-6-001 manifest.json declares options_ui with options.html and open_in_tab: true', async () => {
  // The options_ui manifest key is required so Chrome knows to open options.html
  // as a tab rather than an inline popup, which prevents the OS colour picker from
  // dismissing the popup window. chrome.runtime.getManifest() is available from any
  // extension page and returns the parsed manifest object without a network request.
  const popup = await openPopup();
  const manifest = await popup.evaluate(() => chrome.runtime.getManifest());
  await popup.close();

  expect(manifest).toHaveProperty('options_ui');
  expect(manifest.options_ui.page).toBe('options.html');
  expect(manifest.options_ui.open_in_tab).toBe(true);
});

// ---------------------------------------------------------------------------
// AC2 — options.html contains all global colour/opacity controls and #resetStylesBtn
// ---------------------------------------------------------------------------

test('T-6-002 options.html contains #global-bg-color', async () => {
  // The options page must host the global background colour input that was formerly
  // in popup.html so users can change it without the popup being dismissed.
  const page = await openOptionsPage();
  await expect(page.locator('#global-bg-color')).toBeVisible();
  await page.close();
});

test('T-6-003 options.html contains #global-outline-color', async () => {
  // All colour inputs that trigger the OS picker must live on the full-tab options page.
  const page = await openOptionsPage();
  await expect(page.locator('#global-outline-color')).toBeVisible();
  await page.close();
});

test('T-6-004 options.html contains per-category colour inputs', async () => {
  // Per-category colour overrides must also be on the options page so none of the
  // colour inputs remain in the popup.
  const page = await openOptionsPage();
  await expect(page.locator('#unlearned-bg-color')).toBeVisible();
  await expect(page.locator('#learning-bg-color')).toBeVisible();
  await expect(page.locator('#learned-bg-color')).toBeVisible();
  await page.close();
});

test('T-6-005 options.html contains #resetStylesBtn', async () => {
  // The reset button must be co-located with the style controls it resets.
  const page = await openOptionsPage();
  await expect(page.locator('#resetStylesBtn')).toBeVisible();
  await page.close();
});

test('T-6-006 options.html contains per-category enable checkboxes', async () => {
  // The enable checkboxes gate whether per-category backgroundColor is saved; they
  // must be accessible on the options page alongside their paired colour inputs.
  const page = await openOptionsPage();
  await expect(page.locator('#unlearned-bg-color-enabled')).toBeAttached();
  await expect(page.locator('#learning-bg-color-enabled')).toBeAttached();
  await expect(page.locator('#learned-bg-color-enabled')).toBeAttached();
  await page.close();
});

// ---------------------------------------------------------------------------
// AC3 — popup.html has no colour inputs, retains #scanBtn, and gains #openOptionsBtn
// ---------------------------------------------------------------------------

test('T-6-007 popup.html has no <input type="color"> elements', async () => {
  // Removing all colour inputs from the popup prevents the OS colour picker from
  // stealing focus and closing the popup window on Windows.
  const popup = await openPopup();
  await expect(popup.locator('input[type="color"]')).toHaveCount(0);
  await popup.close();
});

test('T-6-008 popup.html still contains #scanBtn', async () => {
  // The scan button is a core popup action and must not be moved to the options page.
  const popup = await openPopup();
  await expect(popup.locator('#scanBtn')).toBeVisible();
  await popup.close();
});

test('T-6-009 popup.html contains #openOptionsBtn', async () => {
  // A dedicated button lets users reach the options page from the popup without
  // needing to know about the extensions management page.
  const popup = await openPopup();
  await expect(popup.locator('#openOptionsBtn')).toBeVisible();
  await popup.close();
});

// ---------------------------------------------------------------------------
// AC4 — Clicking #openOptionsBtn opens a new tab to the options page URL
// ---------------------------------------------------------------------------

test('T-6-010 clicking #openOptionsBtn opens a new tab pointing at options.html', async () => {
  // chrome.runtime.openOptionsPage() must be called when the button is clicked;
  // the result is a new tab navigating to the declared options_ui page.
  const popup = await openPopup();

  const [newPage] = await Promise.all([
    browserContext.waitForEvent('page'),
    popup.locator('#openOptionsBtn').click(),
  ]);

  await newPage.waitForLoadState('domcontentloaded');
  expect(newPage.url()).toContain(`chrome-extension://${extensionId}/options.html`);

  await popup.close();
  await newPage.close();
});

// ---------------------------------------------------------------------------
// AC5 — Setting #global-bg-color on the options page persists to storage
// ---------------------------------------------------------------------------

test('T-6-011 global-bg-color value persists after closing and reopening options page', async () => {
  // Storage persistence is the primary correctness guarantee for the options page:
  // a user-chosen colour must survive a tab close and be restored on the next visit.
  const page = await openOptionsPage();
  await clearStorage(page);

  await page.locator('#global-bg-color').fill('#cc3300');
  await page.locator('#global-bg-color').dispatchEvent('input');
  await page.waitForTimeout(300);

  await page.close();

  const page2 = await openOptionsPage();
  await expect(page2.locator('#global-bg-color')).toHaveValue('#cc3300');

  const storage = await getStorage(page2);
  expect(storage.styleSettings?.default?.backgroundColor).toBe('#cc3300');

  await page2.close();
});

// ---------------------------------------------------------------------------
// AC6 — Checking #unlearned-bg-color-enabled and setting colour persists
// ---------------------------------------------------------------------------

test('T-6-012 unlearned-bg-color persists when its enable checkbox is checked', async () => {
  // The checkbox guards whether the colour is included in the saved payload.
  // Both the checkbox state and the colour value must survive a page reload.
  const page = await openOptionsPage();
  await clearStorage(page);

  await page.locator('#unlearned-bg-color-enabled').check();
  await page.locator('#unlearned-bg-color').fill('#112233');
  await page.locator('#unlearned-bg-color').dispatchEvent('input');
  await page.waitForTimeout(300);

  await page.close();

  const page2 = await openOptionsPage();
  await expect(page2.locator('#unlearned-bg-color-enabled')).toBeChecked();
  await expect(page2.locator('#unlearned-bg-color')).toHaveValue('#112233');

  const storage = await getStorage(page2);
  expect(storage.styleSettings?.unlearned?.backgroundColor).toBe('#112233');

  await page2.close();
});

// ---------------------------------------------------------------------------
// AC7 — Unchecking #unlearned-bg-color-enabled removes backgroundColor from storage
// ---------------------------------------------------------------------------

test('T-6-013 unchecking unlearned-bg-color-enabled removes backgroundColor from storage', async () => {
  // When a user removes a per-category colour override, the storage entry must be
  // cleaned up so the global default is used instead of a stale value.
  const page = await openOptionsPage();
  await clearStorage(page);

  // First establish a saved colour override
  await page.locator('#unlearned-bg-color-enabled').check();
  await page.locator('#unlearned-bg-color').fill('#aabbcc');
  await page.locator('#unlearned-bg-color').dispatchEvent('input');
  await page.waitForTimeout(300);

  // Now remove the override by unchecking the enable checkbox
  await page.locator('#unlearned-bg-color-enabled').uncheck();
  await page.waitForTimeout(300);

  const storage = await getStorage(page);
  // The unlearned entry must not contain a backgroundColor key after the checkbox
  // is unchecked — an empty object is the correct representation of "no override".
  expect(storage.styleSettings?.unlearned).not.toHaveProperty('backgroundColor');

  await page.close();
});

// ---------------------------------------------------------------------------
// AC8 — Reset button restores defaults and unchecks per-category checkboxes
// ---------------------------------------------------------------------------

test('T-6-014 resetStylesBtn unchecks all per-category enable checkboxes and restores storage defaults', async () => {
  // After a reset, the options page must represent "no category overrides" so that
  // subsequent style saves do not write spurious per-category backgroundColor values.
  const page = await openOptionsPage();
  await clearStorage(page);

  // Put the page in an overridden state
  await page.locator('#unlearned-bg-color-enabled').check();
  await page.locator('#unlearned-bg-color').fill('#ff0000');
  await page.locator('#unlearned-bg-color').dispatchEvent('input');
  await page.locator('#learning-bg-color-enabled').check();
  await page.locator('#learning-bg-color').fill('#00ff00');
  await page.locator('#learning-bg-color').dispatchEvent('input');
  await page.waitForTimeout(300);

  // Click reset
  await page.locator('#resetStylesBtn').click();
  await page.waitForTimeout(300);

  // All three per-category enable checkboxes must be unchecked after reset
  await expect(page.locator('#unlearned-bg-color-enabled')).not.toBeChecked();
  await expect(page.locator('#learning-bg-color-enabled')).not.toBeChecked();
  await expect(page.locator('#learned-bg-color-enabled')).not.toBeChecked();

  // Storage must reflect no per-category backgroundColor overrides
  const storage = await getStorage(page);
  expect(storage.styleSettings?.unlearned).not.toHaveProperty('backgroundColor');
  expect(storage.styleSettings?.learning).not.toHaveProperty('backgroundColor');
  expect(storage.styleSettings?.learned).not.toHaveProperty('backgroundColor');

  await page.close();
});
