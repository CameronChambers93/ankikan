/**
 * E2E tests for Issue #47 — Style presets + progressive disclosure.
 *
 * Before this issue, options.html rendered every schema-driven control
 * (#style-controls) flat and always visible, with no shortcut for the common
 * "just pick a look" case. This issue adds a `#style-preset` dropdown backed
 * by `STYLE_PRESETS` (see style-util.presets.test.js) and collapses the
 * generated controls behind a `<details id="style-advanced">` disclosure,
 * grouped into `[data-style-group="fill|shape|border"]` sections (see
 * options.presets.test.js for the JSDOM-level contract).
 *
 * These tests exercise the parts JSDOM cannot prove: the initial collapsed
 * state of a real <details> element in a real browser, and the UI -> real
 * chrome.storage.local -> close/reopen round-trip for a preset selection.
 * They are written BEFORE options.html / options.js gain the preset picker
 * and progressive-disclosure markup and MUST FAIL until it lands — none of
 * `#style-preset`, `#style-advanced`, or `[data-style-group]` exist yet.
 *
 * Test IDs continue the issue #47 sequence after the Vitest specs
 * (T-47-001..005, T-47-010..014); E2E starts at T-47-020.
 *
 * Acceptance criteria tested:
 *   AC-2 (progressive disclosure) — T-47-020: the Advanced <details> panel is
 *                                     collapsed on page open and expands on
 *                                     summary click, revealing the schema
 *                                     controls.
 *   AC-1 + AC-3 (preset round-trip) — T-47-021: choosing "outline-box"
 *                                     persists the merged bundle to
 *                                     chrome.storage.local, and re-selects
 *                                     itself after a close/reopen.
 *   AC-4 (grouped sections)        — T-47-022: fill/shape/border group
 *                                     containers exist inside the advanced
 *                                     panel and each holds its own controls.
 *
 * AC-4's Vitest-level assertions (which STYLE_SCHEMA entries land in which
 * group) are covered by options.presets.test.js T-47-012; this file only
 * proves the containers are reachable in a real rendered DOM.
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
// AC-2 (progressive disclosure) — T-47-020: Advanced panel starts collapsed
// and expands to reveal the schema-driven controls.
// ---------------------------------------------------------------------------

test('T-47-020 the Advanced style-controls details panel is collapsed on options-page open and reveals #style-controls when expanded', async () => {
  // Before issue #47, #style-controls was always visible with no wrapper.
  // The progressive-disclosure requirement (AC-2) is that a first-time user
  // sees only the preset picker, not a 60-input wall, until they explicitly
  // opt into "Advanced". A real <details> element's open/closed state and
  // the resulting visibility of its content can't be proven in JSDOM alone
  // (jsdom does implement <details> toggling, but the actual layout-driven
  // "is it visible" semantics are best proven in a real browser).
  const page = await openOptionsPage();
  await clearStorage(page);

  const advanced = page.locator('#style-advanced');
  await expect(advanced).toBeAttached({ timeout: 5000 });

  // Collapsed on open: the <details> must not have the `open` attribute, and
  // its content (a known global-* input) must not be visible yet.
  await expect(advanced).not.toHaveAttribute('open');
  const controls = page.locator('#style-controls');
  await expect(controls).toBeAttached({ timeout: 5000 });
  await expect(controls).toBeHidden();

  // Expanding the <summary> must reveal the schema controls.
  await advanced.locator('summary').click();
  await expect(advanced).toHaveAttribute('open', '');
  await expect(controls).toBeVisible();

  await page.close();
});

// ---------------------------------------------------------------------------
// AC-1 + AC-3 (preset round-trip) — T-47-021: selecting a preset persists the
// merged bundle to storage and the picker re-selects it after reopening.
// ---------------------------------------------------------------------------

test('T-47-021 selecting the outline-box preset persists the merged bundle to chrome.storage.local and re-selects itself after closing and reopening the options page', async () => {
  // This is the one round-trip JSDOM cannot prove: a real native <select>
  // firing a real `change` event, a real chrome.storage.local write, and the
  // picker correctly reflecting that stored state on a fresh page load —
  // exercising loadStyleSettings' matchPreset-driven re-sync (AC-3) end to end.
  const page = await openOptionsPage();
  await clearStorage(page);

  const preset = page.locator('#style-preset');
  await expect(preset).toBeAttached({ timeout: 5000 });

  await preset.selectOption('outline-box');
  await page.waitForTimeout(300);

  const storage = await getStorage(page);
  expect(storage.styleSettings?.default?.outlineWidth).toBe(2);
  expect(storage.styleSettings?.default?.backgroundOpacity).toBe(0);

  await page.close();

  const page2 = await openOptionsPage();
  await expect(page2.locator('#style-preset')).toHaveValue('outline-box', { timeout: 5000 });

  await page2.close();
});

// ---------------------------------------------------------------------------
// AC-4 (grouped sections) — T-47-022: fill/shape/border group containers
// exist inside the advanced panel and each holds its own controls.
// ---------------------------------------------------------------------------

test('T-47-022 the advanced panel groups controls into fill/shape/border sections, each containing its own global-* inputs', async () => {
  // Proves the "no 60-input single scroll" restructuring (AC-4) is real in a
  // rendered browser DOM, not just an artifact of the JSDOM-level assertions
  // in options.presets.test.js T-47-012.
  const page = await openOptionsPage();
  await clearStorage(page);

  const advanced = page.locator('#style-advanced');
  await expect(advanced).toBeAttached({ timeout: 5000 });
  // Expand so the group containers (and their inputs) are actually attached
  // and interactable, matching how a real user would reach them.
  await advanced.locator('summary').click();

  const fillGroup = page.locator('[data-style-group="fill"]');
  const shapeGroup = page.locator('[data-style-group="shape"]');
  const borderGroup = page.locator('[data-style-group="border"]');

  await expect(fillGroup).toBeAttached({ timeout: 5000 });
  await expect(shapeGroup).toBeAttached({ timeout: 5000 });
  await expect(borderGroup).toBeAttached({ timeout: 5000 });

  // Fill: background color + opacity.
  await expect(fillGroup.locator('#global-bg-color')).toBeAttached({ timeout: 5000 });
  await expect(fillGroup.locator('#global-bg-opacity')).toBeAttached({ timeout: 5000 });

  // Shape: border radius.
  await expect(shapeGroup.locator('#global-border-radius')).toBeAttached({ timeout: 5000 });

  // Border: outline color, opacity, width.
  await expect(borderGroup.locator('#global-outline-color')).toBeAttached({ timeout: 5000 });
  await expect(borderGroup.locator('#global-outline-opacity')).toBeAttached({ timeout: 5000 });
  await expect(borderGroup.locator('#global-outline-width')).toBeAttached({ timeout: 5000 });

  await page.close();
});
