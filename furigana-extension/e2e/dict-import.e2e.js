/**
 * E2E tests for issue #11: Dictionary import fails in Firefox because the popup
 * closes when a file dialog opens.
 *
 * The fix redirects #importDictBtn in the popup to call runtime.openOptionsPage()
 * instead of triggering a file dialog. The actual file input (#dictFileInput) and
 * status indicator (#dictStatus) move to options.html, which stays open as a
 * persistent page. onImportDict and refreshDictStatus are exported from options.js.
 *
 * These tests are written BEFORE the implementation and must FAIL until the fix lands.
 *
 * Acceptance criteria tested:
 *   AC1 — clicking #importDictBtn in the popup opens options.html (not a file dialog)
 *   AC2 — options.html has #importDictBtn, #dictFileInput, and #dictStatus elements
 *   AC3 — options.html shows "Not loaded" in #dictStatus when no dict is seeded
 *   AC4 — (scaffolded/skipped) full import via file dialog updates #dictStatus to "Loaded"
 */

import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '..');

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

  // Ensure the service worker is up before tests run.
  if (!browserContext.serviceWorkers().length) {
    await browserContext.waitForEvent('serviceworker');
  }
});

test.afterAll(async () => {
  await browserContext?.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the extension ID from the background service worker URL. */
async function getExtensionId() {
  let [background] = browserContext.serviceWorkers();
  if (!background) background = await browserContext.waitForEvent('serviceworker');
  return background.url().split('/')[2];
}

/** Opens popup.html for the loaded extension and returns the page. */
async function openPopup() {
  const extensionId = await getExtensionId();
  const popup = await browserContext.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  return popup;
}

/** Opens options.html for the loaded extension and returns the page. */
async function openOptions() {
  const extensionId = await getExtensionId();
  const options = await browserContext.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  return options;
}

/** Seeds chrome.storage.local via an extension page so values persist for the session. */
async function seedStorage(page, values) {
  await page.evaluate(
    (vals) => new Promise((resolve) => chrome.storage.local.set(vals, resolve)),
    values,
  );
}

/** Clears chrome.storage.local via an extension page. */
async function clearStorage(page) {
  await page.evaluate(
    () => new Promise((resolve) => chrome.storage.local.clear(resolve)),
  );
}

// ---------------------------------------------------------------------------
// AC1 — clicking #importDictBtn in the popup opens options.html
// ---------------------------------------------------------------------------

test('popup #importDictBtn opens options.html instead of a file dialog', async () => {
  // After the fix, the popup must NOT open a native file picker (which closes the
  // popup in Firefox). Instead it must call runtime.openOptionsPage(), which opens
  // options.html as a new tab and keeps the popup alive.
  // This test fails before the fix because the button triggers $('dictFileInput').click(),
  // which opens a file dialog rather than emitting a new page event for options.html.
  const popup = await openPopup();
  await clearStorage(popup);
  await seedStorage(popup, { lemmaMode: 'local' });

  // Close and reopen so the popup loads with lemmaMode already set to 'local'.
  await popup.close();
  const popup2 = await openPopup();

  // #importDictRow is only visible when lemmaMode is local — guard before clicking.
  await expect(popup2.locator('#importDictRow')).toBeVisible({ timeout: 5000 });

  // Listen for the new page that openOptionsPage() will open.
  const newPagePromise = browserContext.waitForEvent('page', { timeout: 5000 });

  await popup2.locator('#importDictBtn').click();

  // The new page must open and its URL must contain options.html.
  // Before the fix this promise rejects (times out) because no new page is opened.
  const optionsPage = await newPagePromise;
  await optionsPage.waitForLoadState('domcontentloaded');

  expect(optionsPage.url()).toContain('options.html');

  await popup2.close();
  await optionsPage.close();
});

// ---------------------------------------------------------------------------
// AC2 — options.html has #importDictBtn, #dictFileInput, and #dictStatus elements
// ---------------------------------------------------------------------------

test('options.html has #importDictBtn, #dictFileInput, and #dictStatus elements', async () => {
  // The file-dialog elements must live on the persistent options page (not the popup)
  // so that Firefox does not close the UI when the file picker is triggered.
  // This test fails before the fix because options.html does not yet contain these elements.
  const options = await openOptions();

  // All three elements must exist in the DOM.
  await expect(options.locator('#importDictBtn')).toHaveCount(1);
  await expect(options.locator('#dictFileInput')).toHaveCount(1);
  await expect(options.locator('#dictStatus')).toHaveCount(1);

  // The file input must accept .zip files (IPAdic dictionary archives).
  const acceptAttr = await options.locator('#dictFileInput').getAttribute('accept');
  expect(acceptAttr).toContain('.zip');

  await options.close();
});

// ---------------------------------------------------------------------------
// AC3 — options.html shows "Not loaded" when no dictionary is seeded
// ---------------------------------------------------------------------------

test('options.html shows "Not loaded" in #dictStatus when no dictionary is seeded', async () => {
  // On a fresh install the dictionary IndexedDB store is empty. The options page must
  // communicate this clearly so the user knows import is required before local mode works.
  // This test fails before the fix because options.html does not yet have #dictStatus.
  const options = await openOptions();

  // Clear any previously seeded storage or IndexedDB state from earlier tests.
  await clearStorage(options);

  // Reload so options.js runs its refreshDictStatus call on a clean slate.
  await options.reload();

  await expect(options.locator('#dictStatus')).toHaveText(/Not loaded/i, { timeout: 5000 });

  await options.close();
});

// ---------------------------------------------------------------------------
// AC4 — (scaffolded, skipped) full import via file dialog updates #dictStatus
// ---------------------------------------------------------------------------

test.skip('options.html updates #dictStatus to "Loaded" after importing a valid IPAdic zip', async () => {
  // This test requires a pre-built IPAdic .zip fixture at the path below.
  // It is skipped until such a fixture is available in the test assets directory.
  //
  // To enable: place a valid IPAdic zip at e2e/fixtures/ipadic.zip, then remove the
  // test.skip() wrapper and set zipFixturePath accordingly.
  const zipFixturePath = path.resolve(__dirname, 'fixtures', 'ipadic.zip');

  const options = await openOptions();
  await clearStorage(options);
  await options.reload();

  // Trigger the hidden file input directly — bypasses the OS picker.
  await options.locator('#dictFileInput').setInputFiles(zipFixturePath);

  // After a successful import, refreshDictStatus must update the span to "Loaded".
  await expect(options.locator('#dictStatus')).toHaveText(/Loaded/i, { timeout: 30000 });

  await options.close();
});
