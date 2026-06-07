/**
 * E2E tests for the Highlight Style section of the popup (issue #4).
 *
 * Bug: <input type="color"> coerces '' to '#000000', so the empty-string guard
 * in currentStyleSettings() never fires.  Every save call therefore writes
 * spurious '#000000' overrides for all per-category colours.
 *
 * Fix (not yet implemented): each per-category colour row gains a paired
 * "enable override" checkbox (e.g. unlearned-bg-color-enabled).
 * currentStyleSettings() only includes backgroundColor for a category when
 * that checkbox is checked.
 *
 * These tests are written BEFORE the fix and must FAIL until the fix lands.
 *
 * Acceptance criteria tested:
 *   AC1 / AC4 — Reset to defaults unchecks all enable-override checkboxes
 *   AC2       — Changing global-bg-color persists; no per-category backgroundColor written
 *   AC3       — Per-category colour persists when its checkbox is explicitly checked
 *   AC5       — Per-category colours are absent from storage when checkbox is not checked
 */

import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '..');

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
  // Wait for the extension service worker to register before any test runs
  if (!browserContext.serviceWorkers().length) {
    await browserContext.waitForEvent('serviceworker');
  }
});

test.afterAll(async () => {
  await browserContext?.close();
});

/** Opens popup.html as a new page in the shared browser context. */
async function openPopup() {
  const [background] = browserContext.serviceWorkers();
  const extensionId = background.url().split('/')[2];
  const popup = await browserContext.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  return popup;
}

/** Returns the full chrome.storage.local contents from inside the popup page. */
async function getStorage(popup) {
  return popup.evaluate(() =>
    new Promise((res) => chrome.storage.local.get(null, res))
  );
}

/** Clears chrome.storage.local from inside the popup page. */
async function clearStorage(popup) {
  await popup.evaluate(() =>
    new Promise((res) => chrome.storage.local.clear(res))
  );
}

// ---------------------------------------------------------------------------
// AC2 — Global colour change persists; no per-category backgroundColor written
// ---------------------------------------------------------------------------

test('global bg-color change is saved and no per-category backgroundColor override is written', async () => {
  // Tests that changing only the global colour does not pollute per-category
  // overrides with '#000000', which is the coerced value for an empty color input.
  const popup = await openPopup();
  await clearStorage(popup);

  // Set the global background colour and trigger the save
  await popup.locator('#global-bg-color').fill('#ff0000');
  await popup.locator('#global-bg-color').dispatchEvent('input');

  // Wait briefly for the async storage write to complete
  await popup.waitForTimeout(300);

  // Close the popup and reopen to verify persistence
  await popup.close();
  const popup2 = await openPopup();

  // Global colour must be persisted
  await expect(popup2.locator('#global-bg-color')).toHaveValue('#ff0000');

  // Per-category entries must NOT contain a backgroundColor key — the fix
  // should prevent spurious '#000000' from being written when no override checkbox is checked
  const storage = await getStorage(popup2);
  expect(storage.styleSettings?.unlearned).not.toHaveProperty('backgroundColor');
  expect(storage.styleSettings?.learning).not.toHaveProperty('backgroundColor');
  expect(storage.styleSettings?.learned).not.toHaveProperty('backgroundColor');

  await popup2.close();
});

// ---------------------------------------------------------------------------
// AC3 — Per-category colour persists when its enable checkbox is explicitly checked
// ---------------------------------------------------------------------------

test('unlearned bg-color is persisted when unlearned-bg-color-enabled checkbox is checked', async () => {
  // Without the enable checkbox the fix cannot know whether the user intentionally
  // picked a colour or whether the input was simply defaulting to '#000000'.
  // This test verifies that the checkbox + colour pair round-trips correctly.
  const popup = await openPopup();
  await clearStorage(popup);

  // Check the enable-override checkbox for the unlearned category
  await popup.locator('#unlearned-bg-color-enabled').check();

  // Set the per-category colour and trigger save
  await popup.locator('#unlearned-bg-color').fill('#aa1122');
  await popup.locator('#unlearned-bg-color').dispatchEvent('input');

  await popup.waitForTimeout(300);

  // Close and reopen to verify persistence
  await popup.close();
  const popup2 = await openPopup();

  // The checkbox must still be checked after reload
  await expect(popup2.locator('#unlearned-bg-color-enabled')).toBeChecked();

  // The colour must be restored
  await expect(popup2.locator('#unlearned-bg-color')).toHaveValue('#aa1122');

  // Storage must contain the override
  const storage = await getStorage(popup2);
  expect(storage.styleSettings?.unlearned?.backgroundColor).toBe('#aa1122');

  await popup2.close();
});

// ---------------------------------------------------------------------------
// AC5 — Per-category colours are absent from storage when checkboxes are not checked
// ---------------------------------------------------------------------------

test('per-category styleSettings entries are empty objects when enable checkboxes are not checked', async () => {
  // Changing any style input (e.g. global opacity) must not cause per-category
  // backgroundColor values to be written when the enable checkboxes are unchecked.
  // Empty objects are the correct representation of "no override".
  const popup = await openPopup();
  await clearStorage(popup);

  // Change only the global opacity (a numeric input, not a colour input) to trigger a save
  await popup.locator('#global-bg-opacity').fill('0.5');
  await popup.locator('#global-bg-opacity').dispatchEvent('change');

  await popup.waitForTimeout(300);

  const storage = await getStorage(popup);

  // Each category must be an empty object — no backgroundColor key present
  expect(storage.styleSettings?.unlearned).toEqual({});
  expect(storage.styleSettings?.learning).toEqual({});
  expect(storage.styleSettings?.learned).toEqual({});

  await popup.close();
});

// ---------------------------------------------------------------------------
// AC1 / AC4 — Reset to defaults unchecks all per-category enable checkboxes
// ---------------------------------------------------------------------------

test('Reset to defaults button unchecks all per-category bg-color enable checkboxes', async () => {
  // After a reset, the popup should represent "no category overrides" — all enable
  // checkboxes must be unchecked so that subsequent saves do not write spurious values.
  const popup = await openPopup();
  await clearStorage(popup);

  // Put the popup into a state where the enable checkbox is checked and a colour is set
  await popup.locator('#unlearned-bg-color-enabled').check();
  await popup.locator('#unlearned-bg-color').fill('#aa1122');
  await popup.locator('#unlearned-bg-color').dispatchEvent('input');

  await popup.waitForTimeout(300);

  // Click the reset button
  await popup.locator('#resetStylesBtn').click();

  await popup.waitForTimeout(300);

  // All three enable checkboxes must be unchecked after reset
  await expect(popup.locator('#unlearned-bg-color-enabled')).not.toBeChecked();
  await expect(popup.locator('#learning-bg-color-enabled')).not.toBeChecked();
  await expect(popup.locator('#learned-bg-color-enabled')).not.toBeChecked();

  await popup.close();
});
