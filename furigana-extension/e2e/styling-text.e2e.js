/**
 * E2E tests for Issue #48 — Highlight styling: text styling + underline properties.
 *
 * The Vitest units (style-util.text.test.js T-48-001..008, options.text.test.js
 * T-48-010..012) already lock buildStyleSheet's CSS-emission contract and the
 * schema-driven "bool"/"enum" control generation in jsdom. What they cannot
 * cover is the fully end-to-end, real-browser path this issue promises:
 * options page controls -> chrome.storage.local -> content script's
 * injectStyles()/buildStyleSheet() -> actual getComputedStyle() on a rendered
 * .anki-<cat> element -- and, separately, that the new text properties render
 * correctly ALONGSIDE pre-existing ruby (furigana) markup and background fill
 * on a realistic dense paragraph.
 *
 * Both tests are written BEFORE STYLE_SCHEMA gains textColor/fontWeight/
 * textDecorationStyle/textDecorationColor entries (and before options.js
 * gains "bool"/"enum" control generation), so they MUST FAIL until the
 * developer implements this issue. Per the existing e2e convention (see
 * options-schema-styles.e2e.js T-45-020), each control lookup is guarded by
 * an explicit `toBeAttached({ timeout: 5000 })` (or an explicit STYLE_SCHEMA
 * `toBeDefined()` check) so the failure is a fast, readable "control/schema
 * entry not found" rather than the default 30s action-timeout.
 *
 * Following options.text.test.js's convention, T-48-020 looks up control ids
 * via STYLE_SCHEMA (`entry.id`) rather than hard-coding literal id fragments
 * for the new properties -- only the STYLE_SCHEMA *keys* (textColor,
 * textDecorationStyle, textDecorationColor -- fixed by the issue's contract)
 * and the *type* contract (color/enum) are assumed.
 *
 * Prerequisites (same as ankican.e2e.js / grouping.e2e.js):
 *   - Anki running with AnkiConnect on localhost:8765.
 *   - The "AnkiKan-E2E" deck exists with:
 *       けが    — Expression field, type 0 (new/unlearned)
 *       アニメ  — Expression field, type 1 (learning)
 *       日本語  — Expression field, type 2 (review/learned)
 *
 * Acceptance criteria tested:
 *   T-48-020 — a per-category (unlearned) override of textColor,
 *     textDecorationStyle ("wavy") and textDecorationColor set via the
 *     options page round-trips through storage and renders as real computed
 *     CSS (color / text-decoration-line / text-decoration-style /
 *     text-decoration-color) on a live .anki-unlearned element, scoped to
 *     only that category.
 *   T-48-021 — a dense Japanese paragraph combining pre-existing ruby
 *     (furigana) markup, an underline (textDecorationStyle), and the
 *     existing background fill renders without error and is captured as a
 *     screenshot artifact for manual visual review, plus programmatic checks
 *     of what can be automated (spans classified, ruby markup intact AND
 *     actually visible, computed styles, no console errors).
 */

import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { STYLE_SCHEMA, hexToRgb } from '../style-util.js';

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
// Helpers (mirrors options-schema-styles.e2e.js / popup-styles.e2e.js —
// each e2e file keeps its own small copies of these rather than sharing a
// module, matching the existing convention in this suite).
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

/** Formats a hex colour as the `rgb(r, g, b)` string a real browser reports for getComputedStyle. */
function rgbString(hex) {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${r}, ${g}, ${b})`;
}

// ---------------------------------------------------------------------------
// T-48-020 — options page -> storage -> content script -> real computed style
// ---------------------------------------------------------------------------

test('T-48-020 setting a per-category textColor + wavy textDecorationStyle + textDecorationColor via the options page renders as real color/text-decoration-* computed style on .anki-unlearned, scoped to that category only', async () => {
  // Look these up off STYLE_SCHEMA (not literal ids) — the *keys* are fixed by
  // the issue contract, but the developer chooses the `id` fragment used to
  // build each control's element id.
  const textColorEntry = STYLE_SCHEMA.find((e) => e.key === 'textColor');
  const decorationStyleEntry = STYLE_SCHEMA.find((e) => e.key === 'textDecorationStyle');
  const decorationColorEntry = STYLE_SCHEMA.find((e) => e.key === 'textDecorationColor');

  expect(textColorEntry, 'STYLE_SCHEMA must declare a "textColor" entry (issue #48)').toBeDefined();
  expect(decorationStyleEntry, 'STYLE_SCHEMA must declare a "textDecorationStyle" entry (issue #48)').toBeDefined();
  expect(decorationColorEntry, 'STYLE_SCHEMA must declare a "textDecorationColor" entry (issue #48)').toBeDefined();
  expect(
    decorationStyleEntry.options,
    '"textDecorationStyle" entry.options must include "wavy" (per the issue #48 enum: none/solid/dotted/dashed/wavy)'
  ).toContain('wavy');

  const DISTINCT_TEXT_COLOR = '#123456';
  const DISTINCT_DECORATION_COLOR = '#654321';

  // --- Step 1: drive the real options-page UI, scoped to "unlearned" only ---
  const optionsPage = await openOptionsPage();
  await clearStorage(optionsPage);

  // Fail fast (5s) with a clear "control not attached" message instead of the
  // default 30s action-timeout — see options-schema-styles.e2e.js T-45-020.
  await expect(optionsPage.locator(`#unlearned-${textColorEntry.id}-enabled`)).toBeAttached({ timeout: 5000 });
  await expect(optionsPage.locator(`#unlearned-${textColorEntry.id}`)).toBeAttached({ timeout: 5000 });
  await expect(optionsPage.locator(`#unlearned-${decorationStyleEntry.id}-enabled`)).toBeAttached({ timeout: 5000 });
  await expect(optionsPage.locator(`#unlearned-${decorationStyleEntry.id}`)).toBeAttached({ timeout: 5000 });
  await expect(optionsPage.locator(`#unlearned-${decorationColorEntry.id}-enabled`)).toBeAttached({ timeout: 5000 });
  await expect(optionsPage.locator(`#unlearned-${decorationColorEntry.id}`)).toBeAttached({ timeout: 5000 });

  await selectCategoryTab(optionsPage, 'unlearned');

  await optionsPage.locator(`#unlearned-${textColorEntry.id}-enabled`).check();
  await optionsPage.locator(`#unlearned-${textColorEntry.id}`).fill(DISTINCT_TEXT_COLOR);
  await optionsPage.locator(`#unlearned-${textColorEntry.id}`).dispatchEvent('input');

  await optionsPage.locator(`#unlearned-${decorationStyleEntry.id}-enabled`).check();
  // Enum control is expected to render as a <select> per options.text.test.js
  // T-48-010; selectOption() dispatches its own 'change' event.
  await optionsPage.locator(`#unlearned-${decorationStyleEntry.id}`).selectOption('wavy');

  await optionsPage.locator(`#unlearned-${decorationColorEntry.id}-enabled`).check();
  await optionsPage.locator(`#unlearned-${decorationColorEntry.id}`).fill(DISTINCT_DECORATION_COLOR);
  await optionsPage.locator(`#unlearned-${decorationColorEntry.id}`).dispatchEvent('input');

  await optionsPage.waitForTimeout(300);

  const storage = await getStorage(optionsPage);
  expect(storage.styleSettings?.unlearned?.textColor).toBe(DISTINCT_TEXT_COLOR);
  expect(storage.styleSettings?.unlearned?.textDecorationStyle).toBe('wavy');
  expect(storage.styleSettings?.unlearned?.textDecorationColor).toBe(DISTINCT_DECORATION_COLOR);
  // Scoping: the override must not leak onto a sibling category that was
  // never touched (mirrors T-45-020's "no leakage" assertion).
  expect(storage.styleSettings?.learned).not.toHaveProperty('textColor');
  expect(storage.styleSettings?.learned).not.toHaveProperty('textDecorationStyle');
  expect(storage.styleSettings?.learned).not.toHaveProperty('textDecorationColor');

  await optionsPage.close();

  // --- Step 2: navigate a real content-script page and read the injected CSS ---
  const TEST_URL = 'http://test-text-styling-render.local/';
  const TEST_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Styling Text E2E</title></head>
<body><p>No Japanese text on this page.</p></body>
</html>`;

  const page = await browserContext.newPage();
  await page.route(TEST_URL, (route) => route.fulfill({ contentType: 'text/html', body: TEST_HTML }));
  await page.goto(TEST_URL);

  // content.js calls injectStyles() unconditionally on load; this page has no
  // Japanese text so scanPage() never touches any anki-* class (same
  // isolation trick as T-45-022 / page-load-styles.e2e.js).
  await page.locator('#anki-dynamic-styles').waitFor({ state: 'attached', timeout: 5000 });
  const css = await page.locator('#anki-dynamic-styles').textContent();

  const unlearnedRule = css.split('\n').find((l) => l.startsWith('.anki-unlearned '));
  expect(unlearnedRule, '.anki-unlearned rule must be present in #anki-dynamic-styles').toBeDefined();
  expect(unlearnedRule).toContain(`color: ${DISTINCT_TEXT_COLOR}`);
  expect(unlearnedRule).toContain('text-decoration-line: underline');
  expect(unlearnedRule).toContain('text-decoration-style: wavy');
  expect(unlearnedRule).toContain(`text-decoration-color: ${DISTINCT_DECORATION_COLOR}`);

  const learnedRule = css.split('\n').find((l) => l.startsWith('.anki-learned '));
  expect(learnedRule, 'the untouched "learned" category must not gain a text-decoration declaration').not.toContain('text-decoration');

  // --- Step 3: real computed style on a real .anki-unlearned element ---
  const computed = await page.evaluate(() => {
    const span = document.createElement('span');
    span.className = 'anki-unlearned';
    span.textContent = 'rendered element';
    document.body.appendChild(span);
    const cs = getComputedStyle(span);
    return {
      color: cs.color,
      textDecorationLine: cs.textDecorationLine,
      textDecorationStyle: cs.textDecorationStyle,
      textDecorationColor: cs.textDecorationColor,
    };
  });

  expect(computed.color).toBe(rgbString(DISTINCT_TEXT_COLOR));
  expect(computed.textDecorationLine).toContain('underline');
  expect(computed.textDecorationStyle).toBe('wavy');
  expect(computed.textDecorationColor).toBe(rgbString(DISTINCT_DECORATION_COLOR));

  await page.close();
});

// ---------------------------------------------------------------------------
// T-48-021 — dense paragraph: ruby + underline + fill together, screenshot artifact
// ---------------------------------------------------------------------------

test('T-48-021 dense Japanese paragraph combining pre-existing ruby furigana, a wavy underline, and background fill renders without console errors, keeps the ruby markup intact AND visible, and captures a screenshot artifact for manual visual review', async () => {
  // Screenshot artifact path — test-results/ is gitignored (see .gitignore),
  // so this is safe to write on every run without polluting the repo.
  const SCREENSHOT_PATH = path.resolve(__dirname, '..', 'test-results', 'issue-48-dense-paragraph.png');
  fs.mkdirSync(path.dirname(SCREENSHOT_PATH), { recursive: true });

  const DISTINCT_TEXT_COLOR = '#1a1a2e';

  // Written directly to storage (bypassing the options UI, which T-48-020
  // already exercises end-to-end) so this test's failure surface is scoped to
  // the CSS-rendering pipeline and the fixture page itself — matches the
  // page-load-styles.e2e.js / T-45-022 pattern of seeding styleSettings via
  // chrome.storage.local.set from a chrome-extension:// page.
  const CUSTOM_STYLE_SETTINGS = {
    default: {
      backgroundColor: '#808080',
      backgroundOpacity: 0.22,
      borderRadius: 3,
      outlineColor: '#808080',
      outlineOpacity: 0,
      outlineWidth: 0,
      textColor: DISTINCT_TEXT_COLOR,
      textDecorationStyle: 'wavy',
    },
    unlearned: { backgroundColor: '#dc4646' },
    learning: { backgroundColor: '#e6aa1e' },
    learned: { backgroundColor: '#32aa50' },
    unknown: {},
  };

  // A single flowing sentence mixing all three known-deck words with ordinary
  // connecting Japanese text, including the kanji word's pre-existing <ruby>
  // furigana markup — mirrors the TWO_PARAGRAPHS_HTML / NHK fixtures in
  // grouping.e2e.js, which pre-wrap only the words the extension is expected
  // to classify (scanPage only considers existing <span> elements — see
  // scan-util.js scanPage — it does not tokenize raw paragraph text itself).
  const DENSE_HTML = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>Dense Paragraph E2E — Issue #48</title></head>
<body>
  <p id="dense">
    今日は<span id="kega">けが</span>をしてしまったので、<span id="anime">アニメ</span>を見ながら家で休むことにした。それでも<span id="nihongo"><ruby>日本語<rt>にほんご</rt></ruby></span>の勉強は少しだけ続けた。
  </p>
</body>
</html>`;

  const consoleErrors = [];
  const page = await browserContext.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  await page.goto(`chrome-extension://${extensionId}/options.html`);
  // content.js reads furiganaLearned as a TOP-LEVEL settings key (see its
  // DEFAULTS, and scan-util.js's applyFurigana which maps
  // 'anki-learned': settings.furiganaLearned) — it is NOT nested inside
  // styleSettings. The default is furiganaLearned:false, which applies
  // anki-hide-furigana and content.css hides <rt> (visibility:hidden) for
  // learned words. 日本語 (the only ruby-bearing word in this fixture) is
  // "learned" in the AnkiKan-E2E deck, so without this override its furigana
  // would render invisibly — defeating the whole point of a screenshot meant
  // to show underline vs. furigana collision. Set both keys in one
  // chrome.storage.local.set call, matching seedStorage's pattern in
  // segmentation.e2e.js (top-level settings + styleSettings can share a call).
  await page.evaluate(
    ({ styleSettings, furiganaLearned }) =>
      new Promise((resolve) => chrome.storage.local.set({ styleSettings, furiganaLearned }, resolve)),
    { styleSettings: CUSTOM_STYLE_SETTINGS, furiganaLearned: true }
  );

  await page.route('http://test-dense-paragraph.local/', (route) =>
    route.fulfill({ contentType: 'text/html', body: DENSE_HTML })
  );
  await page.goto('http://test-dense-paragraph.local/');

  // Baseline (pre-#48, must still pass): each known word gets its real
  // AnkiConnect-derived status class regardless of the new text properties.
  await expect(page.locator('#kega')).toHaveClass(/anki-unlearned/, { timeout: 8000 });
  await expect(page.locator('#anime')).toHaveClass(/anki-learning/, { timeout: 8000 });
  await expect(page.locator('#nihongo')).toHaveClass(/anki-learned/, { timeout: 8000 });

  // Guard against a silent regression of the furiganaLearned:true seed above:
  // if the <rt> is ever hidden again, the screenshot would silently stop
  // proving anything about underline/furigana collision even though every
  // other assertion in this test could still pass. Checked BEFORE the
  // screenshot so the capture below is only trusted once this holds.
  const rtVisibility = await page.evaluate(() => {
    const rt = document.querySelector('#nihongo rt');
    return rt ? getComputedStyle(rt).visibility : 'missing';
  });
  expect(
    rtVisibility,
    '#nihongo\'s <rt> (furigana reading) must be visible — furiganaLearned:true must be honoured — or the screenshot cannot show underline vs. furigana collision'
  ).not.toBe('hidden');

  // Capture the manual-review screenshot before the (possibly failing)
  // assertions below — a reviewer needs to see the CURRENT rendering either
  // way, not just a pass/fail flag, to visually confirm ruby + underline +
  // fill coexist correctly once the feature lands.
  await page.locator('#dense').screenshot({ path: SCREENSHOT_PATH });

  // Programmatic checks of what issue #48 adds: computed color + underline on
  // the ruby-bearing "learned" span specifically — proving the new text
  // properties render correctly ALONGSIDE pre-existing ruby markup, not just
  // in isolation on a plain span (T-48-020 already covers the isolated case).
  const rubyComputed = await page.locator('#nihongo').evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      color: cs.color,
      textDecorationLine: cs.textDecorationLine,
      textDecorationStyle: cs.textDecorationStyle,
    };
  });
  expect(
    rubyComputed.color,
    'the ruby-bearing .anki-learned span must render the configured textColor'
  ).toBe(rgbString(DISTINCT_TEXT_COLOR));
  expect(
    rubyComputed.textDecorationLine,
    'the ruby-bearing .anki-learned span must still render the underline'
  ).toContain('underline');
  expect(rubyComputed.textDecorationStyle).toBe('wavy');

  // The <ruby>/<rt> markup itself must remain intact — underline/fill styling
  // must not have caused content.js to strip or replace it.
  await expect(page.locator('#nihongo ruby')).toBeAttached();
  await expect(page.locator('#nihongo rt')).toHaveText('にほんご');

  expect(
    consoleErrors,
    `content script must not throw console errors while rendering the dense paragraph:\n${consoleErrors.join('\n')}`
  ).toEqual([]);

  await page.close();
});
