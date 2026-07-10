/**
 * E2E tests for Issue #33 — Add "Unknown" category for words with no matching Anki card.
 *
 * New fourth status `anki-unknown` for Japanese spans that match zero Anki cards.
 * These tests are written BEFORE the feature is implemented and must FAIL until it lands.
 *
 * Acceptance criteria covered:
 *   AC1 — scanPage applies `anki-unknown` to spans that match no Anki card
 *   AC2 — stored `styleSettings.unknown` colour appears in `#anki-dynamic-styles` on page load
 *   AC3 — `#furiganaUnknown` popup toggle persists to storage after close/reopen
 *   AC4 — toggling `#furiganaUnknown` off in the popup adds `anki-hide-furigana` to unknown spans live
 *   AC5 — options-page `#unknown-bg-color-enabled` + `#unknown-bg-color` round-trip to storage
 *
 * Real AnkiConnect strategy (mirrors ankican.e2e.js):
 *   - Anki must be running with AnkiConnect on localhost:8765.
 *   - T-33-031 and T-33-034 use the nonce katakana word `ズィゲフォ` as the test word.
 *     This is a nonsense syllable sequence that will not appear in any real Anki deck.
 *   - Both tests self-validate: they query AnkiConnect directly before asserting
 *     `anki-unknown`, and `test.skip` with a clear message if the nonce word
 *     unexpectedly has a card in this collection (genuine environment guard).
 */

import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// The nonce test word — a katakana string that is isJapanese()-passing but
// almost certainly absent from any real Anki collection.
// ---------------------------------------------------------------------------
const NONCE_WORD = 'ズィゲフォ';

// ---------------------------------------------------------------------------
// Real AnkiConnect helper — mirrors setup-anki-e2e.js
// ---------------------------------------------------------------------------
async function anki(action, params = {}) {
  const res = await fetch('http://127.0.0.1:8765', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`AnkiConnect error for ${action}: ${json.error}`);
  return json.result;
}

// ---------------------------------------------------------------------------
// Fixtures: shared browser context with extension loaded (mirrors ankican.e2e.js)
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

  // Ensure the service worker is up before any test runs.
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
// Helpers
// ---------------------------------------------------------------------------

/** Opens popup.html in the shared browser context and returns the page. */
async function openPopup() {
  const page = await browserContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  return page;
}

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

/** Opens options.html in the shared browser context and returns the page. */
async function openOptionsPage() {
  const page = await browserContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expandStyleAdvanced(page);
  return page;
}

/** Returns the full chrome.storage.local contents from inside the given page. */
async function getStorage(page) {
  return page.evaluate(() =>
    new Promise((res) => chrome.storage.local.get(null, res))
  );
}

/** Clears chrome.storage.local from inside the given page. */
async function clearStorage(page) {
  await page.evaluate(() =>
    new Promise((res) => chrome.storage.local.clear(res))
  );
}

/** Seeds chrome.storage.local via an extension page so values take effect for content scripts. */
async function seedStorage(page, values) {
  await page.evaluate(
    (vals) => new Promise((resolve) => chrome.storage.local.set(vals, resolve)),
    values,
  );
}

// ---------------------------------------------------------------------------
// AC1 — T-33-031: scanPage applies anki-unknown to a span with no matching Anki card
// ---------------------------------------------------------------------------

test('T-33-031: span with no matching Anki card gets anki-unknown class after auto-scan', async () => {
  // A Japanese word that AnkiConnect returns zero cards for must receive
  // anki-unknown after the content script scans the page. Without this class,
  // users cannot distinguish words missing from their Anki deck from non-Japanese text.

  // Self-validation guard: confirm the nonce word has no cards in this collection.
  // If it unexpectedly does, skip with a clear message rather than asserting wrong thing.
  const existingCards = await anki('findCards', {
    query: `Expression:"${NONCE_WORD}"`,
  });
  if (existingCards.length > 0) {
    test.skip(
      true,
      `Nonce word "${NONCE_WORD}" unexpectedly has ${existingCards.length} card(s) in this Anki collection — choose a different nonce word`,
    );
    return;
  }

  const TEST_URL = 'http://test-unknown-class.local/';
  const TEST_HTML = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>AnkiKan Unknown Category E2E</title></head>
<body>
  <!-- This word has no Anki card — AnkiConnect returns [] for it -->
  <span id="unknown-word">${NONCE_WORD}</span>
</body>
</html>`;

  // Seed storage so lemmaMode is off (surface-form lookup only)
  const seedPage = await openPopup();
  await clearStorage(seedPage);
  await seedStorage(seedPage, { lemmaMode: 'off' });
  await seedPage.close();

  const page = await browserContext.newPage();
  await page.route(TEST_URL, (route) =>
    route.fulfill({ contentType: 'text/html', body: TEST_HTML })
  );
  await page.goto(TEST_URL);

  // Wait for the content script to annotate the page with any anki-* class,
  // or allow a short timeout so we can assert the anki-unknown class is present.
  await page
    .locator('#unknown-word')
    .waitFor({ timeout: 8000 });

  // After the scan, the span must carry anki-unknown because AnkiConnect returns []
  await expect(page.locator('#unknown-word')).toHaveClass(/anki-unknown/, { timeout: 8000 });

  await page.close();
});

// ---------------------------------------------------------------------------
// AC2 — T-33-032: stored styleSettings.unknown colour appears in #anki-dynamic-styles
// ---------------------------------------------------------------------------

test('T-33-032: stored styleSettings.unknown.backgroundColor appears in #anki-dynamic-styles on page load', async () => {
  // content.js calls injectStyles() unconditionally on page load. Once the
  // styleSettings.unknown override is in storage, the injected CSS must reflect
  // the custom colour — not the grey fallback — so that saved preferences take effect.
  // Mirrors the page-load-styles.e2e.js pattern for AC6 (issue #8).
  const CUSTOM_UNKNOWN_COLOUR = '#5566aa';
  // The stored colour expressed as rgba() to match against the injected CSS text.
  const EXPECTED_COLOUR_FRAGMENT = 'rgba(85, 102, 170';
  // The grey fallback for unknown — must NOT appear when the override is active.
  const FALLBACK_GREY_FRAGMENT = 'rgba(128, 128, 128';

  const CUSTOM_STYLE_SETTINGS = {
    default: {
      backgroundColor: '#808080',
      backgroundOpacity: 0.22,
      borderRadius: 3,
      outlineColor: '#808080',
      outlineOpacity: 0.35,
      outlineWidth: 1,
    },
    unlearned: {},
    learning: {},
    learned: {},
    unknown: { backgroundColor: CUSTOM_UNKNOWN_COLOUR },
  };

  const TEST_URL = 'http://test-unknown-styles.local/';
  const TEST_HTML = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>Unknown Styles E2E Test</title></head>
<body><p><span id="word">日本語</span></p></body>
</html>`;

  const page = await browserContext.newPage();

  // Step 1: Write the custom styleSettings into extension storage from an extension page.
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.evaluate(
    (settings) =>
      new Promise((resolve) =>
        chrome.storage.local.set({ styleSettings: settings }, resolve)
      ),
    CUSTOM_STYLE_SETTINGS
  );

  // Step 2: Navigate to the test page. content.js will run injectStyles() on load.
  await page.route(TEST_URL, (route) =>
    route.fulfill({ contentType: 'text/html', body: TEST_HTML })
  );
  await page.goto(TEST_URL);

  // Step 3: Wait for content.js to inject #anki-dynamic-styles.
  // <style> elements are never "visible" to Playwright; use state:'attached'.
  await page.locator('#anki-dynamic-styles').waitFor({ state: 'attached', timeout: 5000 });

  // Step 4: Read the injected CSS.
  const css = await page.locator('#anki-dynamic-styles').textContent();

  // The injected stylesheet must contain a .anki-unknown rule with the stored colour.
  expect(css).toContain('.anki-unknown');
  expect(css).toContain(EXPECTED_COLOUR_FRAGMENT);

  // The grey fallback must not appear as the .anki-unknown *background* when an override
  // is stored. The check is scoped to the unknown background block specifically: grey
  // legitimately appears elsewhere in this fixture (the global default is grey, so the
  // other categories' backgrounds and the unknown outline all use it), so a blanket
  // not.toContain on the whole stylesheet would be self-defeating regardless of impl.
  expect(css).not.toContain(`.anki-unknown { background-color: ${FALLBACK_GREY_FRAGMENT}`);

  await page.close();
});

// ---------------------------------------------------------------------------
// AC3 — T-33-033: #furiganaUnknown popup toggle persists to storage after close/reopen
// ---------------------------------------------------------------------------

test('T-33-033: toggling #furiganaUnknown off in the popup persists furiganaUnknown:false to storage', async () => {
  // The #furiganaUnknown checkbox must write furiganaUnknown to chrome.storage.local
  // when changed. If the preference is not persisted, the content script will always
  // see the default (true) regardless of what the user selected in the popup.
  const popup = await openPopup();
  await clearStorage(popup);

  // The checkbox should be present and checked by default (furiganaUnknown defaults to true).
  await expect(popup.locator('#furiganaUnknown')).toBeAttached();
  await expect(popup.locator('#furiganaUnknown')).toBeChecked();

  // Uncheck the toggle.
  await popup.locator('#furiganaUnknown').uncheck();
  await popup.waitForTimeout(300);

  await popup.close();

  // Reopen the popup — the checkbox must remain unchecked.
  const popup2 = await openPopup();
  await expect(popup2.locator('#furiganaUnknown')).not.toBeChecked();

  // Storage must explicitly record the preference.
  const storage = await getStorage(popup2);
  expect(storage.furiganaUnknown).toBe(false);

  await popup2.close();
});

// ---------------------------------------------------------------------------
// AC4 — T-33-034: toggling #furiganaUnknown off live-applies anki-hide-furigana to unknown spans
// ---------------------------------------------------------------------------

test('T-33-034: toggling #furiganaUnknown off in the popup adds anki-hide-furigana to anki-unknown spans on the active page', async () => {
  // The popup's furiganaUnknown change handler sends a refreshFurigana message to the
  // content script. The content script must add anki-hide-furigana to spans carrying
  // anki-unknown when furiganaUnknown is false. Without this live-apply, the user must
  // reload the page to see their furigana preference take effect.

  // Self-validation guard: confirm the nonce word has no cards in this collection.
  const existingCards = await anki('findCards', {
    query: `Expression:"${NONCE_WORD}"`,
  });
  if (existingCards.length > 0) {
    test.skip(
      true,
      `Nonce word "${NONCE_WORD}" unexpectedly has ${existingCards.length} card(s) in this Anki collection — choose a different nonce word`,
    );
    return;
  }

  const TEST_URL = 'http://test-unknown-furigana.local/';
  const TEST_HTML = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>AnkiKan Unknown Furigana E2E</title></head>
<body>
  <!-- This word has no Anki card — will become anki-unknown after scan -->
  <span id="unknown-span"><ruby>${NONCE_WORD}<rt>ずぃげふぉ</rt></ruby></span>
</body>
</html>`;

  // Seed storage: lemmaMode off, furiganaGlobal true, furiganaUnknown true (default state)
  const seedPage = await openPopup();
  await clearStorage(seedPage);
  await seedStorage(seedPage, {
    lemmaMode: 'off',
    furiganaGlobal: true,
    furiganaUnknown: true,
  });
  await seedPage.close();

  // Open the test page and wait for the auto-scan to annotate the span
  const page = await browserContext.newPage();
  await page.route(TEST_URL, (route) =>
    route.fulfill({ contentType: 'text/html', body: TEST_HTML })
  );
  await page.goto(TEST_URL);

  // Wait until the span has been annotated as anki-unknown
  await page.locator('#unknown-span.anki-unknown').waitFor({ timeout: 8000 });

  // At this point furigana should be visible (no anki-hide-furigana)
  await expect(page.locator('#unknown-span')).not.toHaveClass(/anki-hide-furigana/);

  // Open the popup and toggle furiganaUnknown off, then send the refreshFurigana message
  // to the content script via the known tab ID — mirrors the popup's onFuriganaChange handler.
  const popup = await openPopup();
  await popup.locator('#furiganaUnknown').uncheck();

  await popup.evaluate(async (testUrl) => {
    const tabs = await chrome.tabs.query({ url: testUrl });
    if (!tabs.length) return;
    // Simulate the furiganaUnknown=false state that the popup would send
    await chrome.tabs.sendMessage(tabs[0].id, {
      action: 'refreshFurigana',
      settings: {
        furiganaGlobal: true,
        furiganaUnlearned: true,
        furiganaLearning: true,
        furiganaLearned: false,
        furiganaUnknown: false,
      },
    });
  }, TEST_URL);

  await page.waitForTimeout(500);

  // The anki-unknown span must now have anki-hide-furigana applied
  await expect(page.locator('#unknown-span')).toHaveClass(/anki-hide-furigana/);

  await popup.close();
  await page.close();
});

// ---------------------------------------------------------------------------
// AC5 — T-33-035: options-page unknown colour picker round-trips to storage
// ---------------------------------------------------------------------------

test('T-33-035: enabling #unknown-bg-color-enabled and setting #unknown-bg-color persists to storage', async () => {
  // The options page must expose enable/colour controls for the unknown category
  // that mirror the existing unlearned/learning/learned rows. When the user enables
  // the override and picks a colour, storage must record styleSettings.unknown.backgroundColor.
  // Without this, the custom colour is discarded on save and users cannot customise
  // the unknown highlight beyond the grey default.
  const page = await openOptionsPage();
  await clearStorage(page);

  // The unknown colour controls must exist on the options page
  await expect(page.locator('#unknown-bg-color-enabled')).toBeAttached();
  await expect(page.locator('#unknown-bg-color')).toBeAttached();

  // Enable the override checkbox for the unknown category
  await page.locator('#unknown-bg-color-enabled').check();

  // Set the unknown background colour
  await page.locator('#unknown-bg-color').fill('#334455');
  await page.locator('#unknown-bg-color').dispatchEvent('input');

  await page.waitForTimeout(300);

  // Close and reopen the options page to verify round-trip persistence
  await page.close();
  const page2 = await openOptionsPage();

  await expect(page2.locator('#unknown-bg-color-enabled')).toBeChecked();
  await expect(page2.locator('#unknown-bg-color')).toHaveValue('#334455');

  const storage = await getStorage(page2);
  expect(storage.styleSettings?.unknown?.backgroundColor).toBe('#334455');

  await page2.close();
});
