/**
 * E2E tests for Issue #46 — Live preview swatch in options page.
 *
 * Problem: users must Save + reload (or navigate away) to see how a style edit will
 * actually render. Fix: options.html hosts a #style-preview container with one sample
 * <span class="anki-<cat>">…</span> per status category; renderPreview(doc) re-derives
 * a scoped <style id="style-preview-styles"> from the CURRENT (not-yet-persisted) input
 * values on every edit, so the sample spans' real computed styles update live.
 *
 * These tests are written BEFORE renderPreview/#style-preview exist and must FAIL until
 * the feature lands. They exercise the genuinely browser-only contract — real computed
 * CSS on live DOM nodes changing with no page reload/navigation between edit and assert —
 * which the Vitest units (T-46-001..004, in options.test.js) cannot cover since jsdom does
 * not compute style.
 *
 * Acceptance criteria tested:
 *   AC1 — Editing any control updates the matching category swatch immediately, no save/reload (T-46-010)
 *   AC2 — Swatch reflects the resolve order (fallback -> default -> category override) (T-46-011)
 *   AC3 — Enabling/disabling a per-category override flips the swatch between inherited and overridden (T-46-011)
 */

import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { hexToRgb } from '../style-util.js';

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

/** Returns the computed `background-color` of the element matched by `sel`, from inside `page`. */
async function computedBgColor(page, sel) {
  return page.locator(sel).evaluate((el) => getComputedStyle(el).backgroundColor);
}

/** Formats a hex colour's `{r, g, b}` components as the substring expected inside a `rgb(a)(...)` computed style string. */
function rgbFragment(hex) {
  const { r, g, b } = hexToRgb(hex);
  return `${r}, ${g}, ${b}`;
}

// ---------------------------------------------------------------------------
// AC1 — Editing a control updates the matching category swatch immediately,
// with no save/reload/navigation between the edit and the assertion.
// ---------------------------------------------------------------------------

test('T-46-010 editing #global-bg-color updates the #style-preview unknown swatch computed background-color live, without reload', async () => {
  // The whole point of the live preview is that the SAME loaded page reflects an
  // in-memory edit instantly — no Save button click, no page.reload(), no re-navigation.
  const page = await openOptionsPage();
  await clearStorage(page);
  await revealStyleControls(page);

  const previewSpan = page.locator('#style-preview .anki-unknown');
  await expect(previewSpan).toBeVisible();

  const baselineColor = await computedBgColor(page, '#style-preview .anki-unknown');

  const newColor = '#3399ff';
  await page.locator('#global-bg-color').fill(newColor);
  await page.locator('#global-bg-color').dispatchEvent('input');
  await page.waitForTimeout(300);

  const updatedColor = await computedBgColor(page, '#style-preview .anki-unknown');

  // The 'unknown' category inherits from the global default with no override, so its
  // swatch must now render the newly-chosen global colour — while still on the very
  // same page instance (no reload/navigation occurred between edit and assertion).
  expect(updatedColor).not.toBe(baselineColor);
  expect(updatedColor).toContain(rgbFragment(newColor));

  await page.close();
});

// ---------------------------------------------------------------------------
// AC2 / AC3 — Enabling a per-category override flips ONLY that category's swatch
// to the overridden appearance; sibling categories keep rendering the inherited
// (fallback -> default) appearance unchanged.
// ---------------------------------------------------------------------------

test('T-46-011 enabling a per-category override updates only the learning swatch, leaving the learned swatch unchanged, without reload', async () => {
  // AC2: the swatch must reflect the resolve order (fallback -> default -> override).
  // AC3: flipping the per-category enable checkbox must flip that category's swatch
  // between "inherited" and "overridden" appearance, while a sibling category's swatch
  // (never touched) proves the change is scoped to the edited category only.
  const page = await openOptionsPage();
  await clearStorage(page);
  await revealStyleControls(page, 'learning');

  const learningSpan = page.locator('#style-preview .anki-learning');
  const learnedSpan = page.locator('#style-preview .anki-learned');
  await expect(learningSpan).toBeVisible();
  await expect(learnedSpan).toBeVisible();

  const learningBaseline = await computedBgColor(page, '#style-preview .anki-learning');
  const learnedBaseline = await computedBgColor(page, '#style-preview .anki-learned');

  const overrideColor = '#ff2299';
  await page.locator('#learning-bg-color-enabled').check();
  await page.locator('#learning-bg-color').fill(overrideColor);
  await page.locator('#learning-bg-color').dispatchEvent('input');
  await page.waitForTimeout(300);

  const learningUpdated = await computedBgColor(page, '#style-preview .anki-learning');
  const learnedUpdated = await computedBgColor(page, '#style-preview .anki-learned');

  // The overridden category's swatch must flip to the new colour...
  expect(learningUpdated).not.toBe(learningBaseline);
  expect(learningUpdated).toContain(rgbFragment(overrideColor));

  // ...while the untouched sibling category's swatch must remain exactly as it was,
  // proving the edit did not leak outside its own category (resolve-order isolation).
  expect(learnedUpdated).toBe(learnedBaseline);

  await page.close();
});
