/**
 * E2E test for Issue #65 — Options page init race.
 *
 * Problem: `options.js` attaches the per-category enable-checkbox `change` listener
 * (which clears the paired colour input's `disabled` flag) only AFTER a top-level
 * `await loadStyleSettings(document, storageGet)`. A `change` event fired in the gap
 * between "DOM built" and "listeners attached" hits no listener, so the paired colour
 * input stays `disabled` forever and any subsequent `.fill()` on it fails with
 * "element is not enabled".
 *
 * This is the AC-6 real-browser regression oracle: after the fix (listener wiring
 * moved before the await), checking an enable checkbox on a freshly-loaded options
 * page must always enable its paired colour input and persist the change to
 * chrome.storage.local, regardless of how fast/slow the initial storage read is.
 *
 * Unlike the pre-existing flaky oracle in options-styles.e2e.js ("unchecking
 * unlearned-bg-color-enabled removes backgroundColor from storage", ~L248), this test
 * is scoped narrowly to the exact interaction that times out under the bug: check →
 * immediately fill the paired colour input.
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

/**
 * Reveals the granular style controls. Issue #47 restructured the options page so
 * every schema-generated control lives inside a collapsed <details id="style-advanced">
 * (progressive disclosure), and per-category controls sit inside hidden tab panels.
 * Both must be opened before Playwright can interact with those inputs. Pass a
 * `category` to also activate its per-category tab panel.
 */
async function revealStyleControls(page, category) {
  await page.locator('#style-advanced').locator('summary').click();
  if (category) await page.locator(`#style-tab-${category}`).click();
}

// ---------------------------------------------------------------------------
// AC-6 — Enable checkbox always toggles its paired colour input, regardless of
// initial storage-read timing, and the change persists to chrome.storage.local.
// ---------------------------------------------------------------------------

test('T-65-008 checking unlearned-bg-color-enabled on a freshly-loaded options page always enables and persists the paired colour input', async () => {
  const page = await openOptionsPage();
  await clearStorage(page);

  // Reload after clearing storage so this run starts from a clean, freshly-loaded
  // options page — the exact scenario in which the init race can occur (a fresh
  // top-level module evaluation racing the checkbox interaction below).
  await page.reload();
  // #47 hides the granular controls behind a collapsed <details> + per-category
  // tabs; reveal the unlearned panel before driving its enable checkbox. The init
  // race being probed is unaffected — the disclosure/tab wiring is synchronous and
  // separate from the awaited storage read whose timing this test exercises.
  await revealStyleControls(page, 'unlearned');

  // This is the exact interaction that times out with "element is not enabled"
  // under the bug: check the enable checkbox, then immediately fill its paired
  // colour input. If the change listener wasn't attached yet when the checkbox
  // event fired, `disabled` never clears and `.fill()` below throws.
  await page.locator('#unlearned-bg-color-enabled').check();
  await expect(page.locator('#unlearned-bg-color')).toBeEnabled();
  await page.locator('#unlearned-bg-color').fill('#aabbcc');
  await page.locator('#unlearned-bg-color').dispatchEvent('input');
  await page.waitForTimeout(300);

  const storage = await getStorage(page);
  expect(storage.styleSettings?.unlearned?.backgroundColor).toBe('#aabbcc');

  // Confirm the value survives a page close/reopen too, i.e. it was actually
  // persisted and not just reflected transiently in the live DOM.
  await page.close();
  const page2 = await openOptionsPage();
  await expect(page2.locator('#unlearned-bg-color-enabled')).toBeChecked();
  await expect(page2.locator('#unlearned-bg-color')).toHaveValue('#aabbcc');
  const storage2 = await getStorage(page2);
  expect(storage2.styleSettings?.unlearned?.backgroundColor).toBe('#aabbcc');

  await page2.close();
});
