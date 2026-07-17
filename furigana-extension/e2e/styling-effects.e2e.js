/**
 * E2E tests for Issue #49 — Highlight styling: glow/shadow + spacing properties.
 *
 * The Vitest units (style-util.glow.test.js T-49-001..010, options.glow.test.js
 * T-49-011..015) already lock buildStyleSheet's new "box-shadow" / "padding" /
 * "letter-spacing" emission and the schema-driven control generation in jsdom.
 * What they cannot cover is the fully end-to-end, real-browser path this issue
 * promises: options page controls -> chrome.storage.local -> content script's
 * injectStyles()/buildStyleSheet() -> actual getComputedStyle()/getClientRects()
 * on a rendered .anki-<cat> element -- and, critically, that a dense paragraph's
 * REAL LAYOUT is unaffected when every new property sits at its 0/absent default
 * (jsdom never computes layout, so only a real browser can prove "no jump").
 *
 * Test IDs continue the issue #49 sequence after the Vitest specs (T-49-001..015).
 *
 * Prerequisites (same as ankican.e2e.js / styling-text.e2e.js):
 *   - Anki running with AnkiConnect on localhost:8765.
 *   - The "AnkiKan-E2E" deck exists with:
 *       けが    — Expression field, type 0 (new/unlearned)
 *       アニメ  — Expression field, type 1 (learning)
 *       日本語  — Expression field, type 2 (review/learned)
 *
 * Acceptance criteria tested:
 *   T-49-016 — a per-category (unlearned) glowColor + glowOpacity + glowBlur +
 *     glowSpread override set via the options page round-trips through storage
 *     and renders as a real composed `box-shadow` computed style on a live
 *     .anki-unlearned element, scoped to only that category.
 *   T-49-017 — a dense, narrow-width Japanese paragraph at DEFAULT style
 *     settings (glow/padding/letterSpacing all 0/absent) renders with the exact
 *     same layout (line count, trailing-marker position) as an identical page
 *     with the extension NOT loaded at all — guards "no layout jump at
 *     defaults", something only a real browser's layout engine can prove.
 *   T-49-018 — a non-zero paddingX/paddingY override, forced to wrap a single
 *     highlighted span across multiple lines by a narrow container, renders
 *     with `box-decoration-break: clone` in real computed style (so each
 *     wrapped line fragment gets its own padding, rather than only the first
 *     and last fragments).
 *   T-49-019 — a glow override set via the options page survives closing and
 *     reopening the options page (storage persistence), mirroring the
 *     established T-45-021 pattern for the new keys.
 */

import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { STYLE_SCHEMA, hexToRgb } from '../style-util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '..');

// A shared, fixed viewport keeps real-browser layout measurements
// (T-49-017/T-49-018) deterministic regardless of the host machine's screen.
const VIEWPORT = { width: 800, height: 600 };

let browserContext;
let extensionId;

test.beforeAll(async () => {
  browserContext = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: VIEWPORT,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });
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
// Helpers (mirrors options-schema-styles.e2e.js / styling-text.e2e.js — each
// e2e file keeps its own small copies of these rather than sharing a module,
// matching the existing convention in this suite).
// ---------------------------------------------------------------------------

/**
 * Issue #47 moved the schema-generated style controls behind a collapsed
 * <details id="style-advanced">; expand it so Playwright can interact with
 * the controls inside.
 */
async function expandStyleAdvanced(page) {
  await page.evaluate(() => {
    const d = document.getElementById('style-advanced');
    if (d) d.open = true;
  });
}

/** Selects a category's tab so its (otherwise hidden) override panel is interactable. */
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

/** Returns the full chrome.storage.local contents evaluated from inside a given page. */
async function getStorage(page) {
  return page.evaluate(() => new Promise((res) => chrome.storage.local.get(null, res)));
}

/** Clears chrome.storage.local from inside a given page. */
async function clearStorage(page) {
  await page.evaluate(() => new Promise((res) => chrome.storage.local.clear(res)));
}

/** Formats a hex colour as the `r, g, b` fragment a real browser's rgba(...) computed style contains. */
function rgbFragment(hex) {
  const { r, g, b } = hexToRgb(hex);
  return `${r}, ${g}, ${b}`;
}

// ---------------------------------------------------------------------------
// T-49-016 — options page -> storage -> content script -> real composed
// box-shadow computed style, scoped to one category.
// ---------------------------------------------------------------------------

test('T-49-016 setting a per-category glowColor + glowOpacity + glowBlur + glowSpread via the options page renders as a real composed box-shadow computed style on .anki-unlearned, scoped to that category only', async () => {
  // Look these up off STYLE_SCHEMA (not literal ids) — the *keys* are fixed by
  // the issue contract, but the developer chooses the `id` fragment used to
  // build each control's element id (same convention as T-48-020).
  const glowColorEntry = STYLE_SCHEMA.find((e) => e.key === 'glowColor');
  const glowOpacityEntry = STYLE_SCHEMA.find((e) => e.key === 'glowOpacity');
  const glowBlurEntry = STYLE_SCHEMA.find((e) => e.key === 'glowBlur');
  const glowSpreadEntry = STYLE_SCHEMA.find((e) => e.key === 'glowSpread');

  expect(glowColorEntry, 'STYLE_SCHEMA must declare a "glowColor" entry (issue #49)').toBeDefined();
  expect(glowOpacityEntry, 'STYLE_SCHEMA must declare a "glowOpacity" entry (issue #49)').toBeDefined();
  expect(glowBlurEntry, 'STYLE_SCHEMA must declare a "glowBlur" entry (issue #49)').toBeDefined();
  expect(glowSpreadEntry, 'STYLE_SCHEMA must declare a "glowSpread" entry (issue #49)').toBeDefined();

  const GLOW_COLOR = '#123456';
  const GLOW_OPACITY = '0.5';
  const GLOW_BLUR = '10';
  const GLOW_SPREAD = '3';

  // --- Step 1: drive the real options-page UI, scoped to "unlearned" only ---
  const optionsPage = await openOptionsPage();
  await clearStorage(optionsPage);

  // Fail fast (5s) with a clear "control not attached" message instead of the
  // default 30s action-timeout — see options-schema-styles.e2e.js T-45-020.
  for (const entry of [glowColorEntry, glowOpacityEntry, glowBlurEntry, glowSpreadEntry]) {
    await expect(optionsPage.locator(`#unlearned-${entry.id}-enabled`)).toBeAttached({ timeout: 5000 });
    await expect(optionsPage.locator(`#unlearned-${entry.id}`)).toBeAttached({ timeout: 5000 });
  }

  await selectCategoryTab(optionsPage, 'unlearned');

  // Colour control: input[type=color], saved on 'input' (matches colorInputIds).
  await optionsPage.locator(`#unlearned-${glowColorEntry.id}-enabled`).check();
  await optionsPage.locator(`#unlearned-${glowColorEntry.id}`).fill(GLOW_COLOR);
  await optionsPage.locator(`#unlearned-${glowColorEntry.id}`).dispatchEvent('input');

  // Opacity/px controls: input[type=number], saved on 'change' (numberInputIds).
  await optionsPage.locator(`#unlearned-${glowOpacityEntry.id}-enabled`).check();
  await optionsPage.locator(`#unlearned-${glowOpacityEntry.id}`).fill(GLOW_OPACITY);
  await optionsPage.locator(`#unlearned-${glowOpacityEntry.id}`).dispatchEvent('change');

  await optionsPage.locator(`#unlearned-${glowBlurEntry.id}-enabled`).check();
  await optionsPage.locator(`#unlearned-${glowBlurEntry.id}`).fill(GLOW_BLUR);
  await optionsPage.locator(`#unlearned-${glowBlurEntry.id}`).dispatchEvent('change');

  await optionsPage.locator(`#unlearned-${glowSpreadEntry.id}-enabled`).check();
  await optionsPage.locator(`#unlearned-${glowSpreadEntry.id}`).fill(GLOW_SPREAD);
  await optionsPage.locator(`#unlearned-${glowSpreadEntry.id}`).dispatchEvent('change');

  await optionsPage.waitForTimeout(300);

  const storage = await getStorage(optionsPage);
  expect(storage.styleSettings?.unlearned?.glowColor).toBe(GLOW_COLOR);
  expect(storage.styleSettings?.unlearned?.glowOpacity).toBe(0.5);
  expect(storage.styleSettings?.unlearned?.glowBlur).toBe(10);
  expect(storage.styleSettings?.unlearned?.glowSpread).toBe(3);
  // Scoping: the override must not leak onto a sibling category that was
  // never touched (mirrors T-45-020/T-48-020's "no leakage" assertion).
  expect(storage.styleSettings?.learned).not.toHaveProperty('glowColor');
  expect(storage.styleSettings?.learned).not.toHaveProperty('glowOpacity');
  expect(storage.styleSettings?.learned).not.toHaveProperty('glowBlur');
  expect(storage.styleSettings?.learned).not.toHaveProperty('glowSpread');

  await optionsPage.close();

  // --- Step 2: navigate a real content-script page and read the injected CSS ---
  const TEST_URL = 'http://test-glow-render.local/';
  const TEST_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Styling Effects E2E</title></head>
<body><p>No Japanese text on this page.</p></body>
</html>`;

  const page = await browserContext.newPage();
  await page.route(TEST_URL, (route) => route.fulfill({ contentType: 'text/html', body: TEST_HTML }));
  await page.goto(TEST_URL);

  // content.js calls injectStyles() unconditionally on load; this page has no
  // Japanese text so scanPage() never touches any anki-* class (same
  // isolation trick as T-45-022 / T-48-020).
  await page.locator('#anki-dynamic-styles').waitFor({ state: 'attached', timeout: 5000 });
  const css = await page.locator('#anki-dynamic-styles').textContent();

  const unlearnedRule = css.split('\n').find((l) => l.startsWith('.anki-unlearned '));
  expect(unlearnedRule, '.anki-unlearned rule must be present in #anki-dynamic-styles').toBeDefined();
  expect(unlearnedRule).toContain('box-shadow');
  expect(unlearnedRule).toContain('10px'); // blur
  expect(unlearnedRule).toContain('3px'); // spread
  expect(unlearnedRule).toContain(`rgba(${rgbFragment(GLOW_COLOR)}, 0.5)`);

  const learnedRule = css.split('\n').find((l) => l.startsWith('.anki-learned '));
  expect(learnedRule, 'the untouched "learned" category must not gain a box-shadow declaration').not.toContain('box-shadow');

  // --- Step 3: real computed style on a real .anki-unlearned element ---
  const boxShadow = await page.evaluate(() => {
    const span = document.createElement('span');
    span.className = 'anki-unlearned';
    span.textContent = 'rendered element';
    document.body.appendChild(span);
    return getComputedStyle(span).boxShadow;
  });

  expect(boxShadow, `computed box-shadow must reflect the configured glow, got: ${boxShadow}`).toContain('10px');
  expect(boxShadow).toContain('3px');
  expect(boxShadow).toContain(rgbFragment(GLOW_COLOR));

  await page.close();
});

// ---------------------------------------------------------------------------
// T-49-017 — dense, narrow paragraph at DEFAULT settings: no layout jump vs a
// no-extension-styling baseline. Real browser layout only — jsdom cannot
// compute this.
// ---------------------------------------------------------------------------

test('T-49-017 dense narrow-width Japanese paragraph at default style settings (glow/padding/letterSpacing all 0/absent) has identical real-browser layout (line wrap + trailing marker position) to the same page with the extension not loaded at all', async () => {
  const LAYOUT_HTML = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>Layout Jump E2E — Issue #49</title>
<style>
  html, body { margin: 0; padding: 0; }
  #dense { width: 220px; font: 16px/1.5 sans-serif; }
</style>
</head>
<body>
<p id="dense">今日は<span id="w1">けが</span>をしてしまったので、<span id="w2">アニメ</span>を見ながら家で休むことにした。それでもとても天気の良い日には散歩をすることが多いのだが<span id="end-marker">終わり</span></p>
</body>
</html>`;

  // --- Baseline: an entirely separate browser context with NO extension loaded ---
  const plainContext = await chromium.launchPersistentContext('', {
    headless: false,
    viewport: VIEWPORT,
  });
  try {
    const plainPage = await plainContext.newPage();
    await plainPage.route('http://test-layout-jump.local/', (route) =>
      route.fulfill({ contentType: 'text/html', body: LAYOUT_HTML })
    );
    await plainPage.goto('http://test-layout-jump.local/');

    const baselineMarker = await plainPage.locator('#end-marker').boundingBox();
    const baselineDenseHeight = await plainPage.locator('#dense').evaluate((el) => el.getBoundingClientRect().height);

    // --- Extension context, at DEFAULT (cleared) style settings ---
    const extPage = await browserContext.newPage();
    // Clearing storage ensures the resolved styleSettings are exactly
    // STYLE_DEFAULTS/BUILT_IN_STYLE_FALLBACK — i.e. every issue #49 key is
    // absent, per T-49-005's byte-identical-CSS contract.
    await extPage.goto(`chrome-extension://${extensionId}/options.html`);
    await extPage.evaluate(() => new Promise((res) => chrome.storage.local.clear(res)));

    await extPage.route('http://test-layout-jump.local/', (route) =>
      route.fulfill({ contentType: 'text/html', body: LAYOUT_HTML })
    );
    await extPage.goto('http://test-layout-jump.local/');

    // Wait for the real AnkiConnect-driven classification to actually apply —
    // a silent classification failure would make this test pass trivially
    // (unstyled spans look identical to the baseline by definition), so assert
    // the classes explicitly rather than swallowing the wait like the
    // negative-case helper in ankican.e2e.js does.
    await expect(extPage.locator('#w1')).toHaveClass(/anki-unlearned/, { timeout: 8000 });
    await expect(extPage.locator('#w2')).toHaveClass(/anki-learning/, { timeout: 8000 });

    const extMarker = await extPage.locator('#end-marker').boundingBox();
    const extDenseHeight = await extPage.locator('#dense').evaluate((el) => el.getBoundingClientRect().height);

    // outline/background-color/border-radius (the pre-#49 defaults) do not
    // occupy layout space, so the paragraph's total rendered height (line
    // count) must be identical...
    expect(extDenseHeight, 'the dense paragraph must wrap onto the same number of lines with and without the extension').toBe(baselineDenseHeight);
    // ...and the trailing marker (after two classified spans) must land at the
    // exact same pixel position — any non-zero default padding/letter-spacing
    // introduced by issue #49 would shift this.
    expect(extMarker.x, 'the trailing marker\'s x position must be unchanged at default style settings').toBeCloseTo(baselineMarker.x, 1);
    expect(extMarker.y, 'the trailing marker\'s y position must be unchanged at default style settings').toBeCloseTo(baselineMarker.y, 1);

    await extPage.close();
  } finally {
    await plainContext.close();
  }
});

// ---------------------------------------------------------------------------
// T-49-018 — a non-zero padding override forces a single highlighted span to
// wrap across multiple lines; box-decoration-break: clone must be in effect.
// ---------------------------------------------------------------------------

test('T-49-018 a non-zero paddingX/paddingY override on a single highlighted span forced to wrap across multiple lines renders with box-decoration-break: clone in real computed style', async () => {
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
    unknown: { paddingX: 8, paddingY: 4 },
  };

  // Written directly to storage (bypassing the options UI, which T-49-016
  // already exercises end-to-end) so this test's failure surface is scoped to
  // the CSS-rendering pipeline and the fixture page itself — matches the
  // page-load-styles.e2e.js / T-45-022 pattern of seeding styleSettings via
  // chrome.storage.local.set from a chrome-extension:// page.
  const page = await browserContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.evaluate(
    (styleSettings) => new Promise((resolve) => chrome.storage.local.set({ styleSettings }, resolve)),
    CUSTOM_STYLE_SETTINGS
  );

  // A narrow container plus a long run of Japanese text (which wraps at any
  // character boundary, unlike Latin text) forces one single .anki-unknown
  // span to break across several visual lines.
  const WRAP_HTML = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>Padded Wrap E2E — Issue #49</title>
<style>
  html, body { margin: 0; padding: 0; }
  #container { width: 150px; font: 16px/1.5 sans-serif; }
</style>
</head>
<body>
<p id="container"><span id="wrapped" class="anki-unknown">今日はとても天気が良くて散歩に出かけたので気分がとても良かったです</span></p>
</body>
</html>`;

  await page.route('http://test-padded-wrap.local/', (route) =>
    route.fulfill({ contentType: 'text/html', body: WRAP_HTML })
  );
  await page.goto('http://test-padded-wrap.local/');

  // content.js injects #anki-dynamic-styles unconditionally on load, deriving
  // CSS from the storage we just wrote. The span's class is hard-coded in the
  // fixture (not scanPage-derived), so no AnkiConnect round trip is needed —
  // this test is scoped purely to the CSS-rendering pipeline.
  await page.locator('#anki-dynamic-styles').waitFor({ state: 'attached', timeout: 5000 });

  const result = await page.locator('#wrapped').evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      lineCount: el.getClientRects().length,
      boxDecorationBreak: cs.boxDecorationBreak || cs.webkitBoxDecorationBreak,
      padding: cs.padding,
    };
  });

  // Guard against a fixture that silently fails to wrap (which would make the
  // box-decoration-break assertion below meaningless).
  expect(result.lineCount, 'the highlighted span must actually wrap across multiple lines for this test to be meaningful').toBeGreaterThan(1);
  expect(result.boxDecorationBreak, `computed box-decoration-break must be "clone", got: ${result.boxDecorationBreak}`).toBe('clone');
  expect(result.padding).toContain('4px');
  expect(result.padding).toContain('8px');

  await page.close();
});

// ---------------------------------------------------------------------------
// T-49-019 — a glow override set via the options page survives closing and
// reopening the options page (storage persistence), mirroring T-45-021.
// ---------------------------------------------------------------------------

test('T-49-019 a learning-category glowBlur override survives closing and reopening the options page', async () => {
  const glowBlurEntry = STYLE_SCHEMA.find((e) => e.key === 'glowBlur');
  const glowColorEntry = STYLE_SCHEMA.find((e) => e.key === 'glowColor');
  expect(glowBlurEntry, 'STYLE_SCHEMA must declare a "glowBlur" entry (issue #49)').toBeDefined();
  expect(glowColorEntry, 'STYLE_SCHEMA must declare a "glowColor" entry (issue #49)').toBeDefined();

  const page = await openOptionsPage();
  await clearStorage(page);

  await expect(page.locator(`#learning-${glowColorEntry.id}-enabled`)).toBeAttached({ timeout: 5000 });
  await expect(page.locator(`#learning-${glowColorEntry.id}`)).toBeAttached({ timeout: 5000 });
  await expect(page.locator(`#learning-${glowBlurEntry.id}-enabled`)).toBeAttached({ timeout: 5000 });
  await expect(page.locator(`#learning-${glowBlurEntry.id}`)).toBeAttached({ timeout: 5000 });

  await selectCategoryTab(page, 'learning');

  await page.locator(`#learning-${glowColorEntry.id}-enabled`).check();
  await page.locator(`#learning-${glowColorEntry.id}`).fill('#00ffcc');
  await page.locator(`#learning-${glowColorEntry.id}`).dispatchEvent('input');

  await page.locator(`#learning-${glowBlurEntry.id}-enabled`).check();
  await page.locator(`#learning-${glowBlurEntry.id}`).fill('7');
  await page.locator(`#learning-${glowBlurEntry.id}`).dispatchEvent('change');

  await page.waitForTimeout(300);
  await page.close();

  const page2 = await openOptionsPage();
  await selectCategoryTab(page2, 'learning');
  await expect(page2.locator(`#learning-${glowColorEntry.id}-enabled`)).toBeChecked();
  await expect(page2.locator(`#learning-${glowColorEntry.id}`)).toHaveValue('#00ffcc');
  await expect(page2.locator(`#learning-${glowBlurEntry.id}-enabled`)).toBeChecked();
  await expect(page2.locator(`#learning-${glowBlurEntry.id}`)).toHaveValue('7');

  const storage = await getStorage(page2);
  expect(storage.styleSettings?.learning?.glowColor).toBe('#00ffcc');
  expect(storage.styleSettings?.learning?.glowBlur).toBe(7);

  await page2.close();
});
