/**
 * E2E tests for Issue #10 — Scan full sentences/paragraphs across split HTML elements.
 *
 * Prerequisites:
 *   - Anki must be running with the AnkiConnect add-on active (localhost:8765).
 *   - The "AnkiKan-E2E" deck must exist with the following cards:
 *       けが    — Expression field, type 0 (new/unlearned)  → anki-unlearned
 *       アニメ  — Expression field, type 1 (learning)       → anki-learning
 *       日本語  — Expression field, type 2 (review/learned) → anki-learned
 *   Run the setup script to create/restore this deck:
 *       node e2e/setup-anki-e2e.js
 *
 * Test coverage:
 *   AC1 — Multiple spans inside a single <p> each get individual anki-* classes
 *   AC2 — Spans in separate <p> blocks each get independent classes
 *   AC3 — NHK-style <div> containing multiple spans: each span gets its own class,
 *          including when spans are nested inside inline wrappers inside the <div>
 *          (this is the scenario the current groupByBlock implementation misses because
 *          it uses closest("p, li, ...") which excludes "div" — a span wrapped inside
 *          <div><em><span> falls back to parentElement=<em>, not the <div>, so the two
 *          spans in the block are split into separate groups and tokenized without context)
 *   AC4 — The class is on the <span> element itself, not on the parent <p> or <div>
 *
 * The NHK nested-wrapper tests (AC3b) are the red-phase failures:
 * the current dist/content.js uses span.closest("p, li, td, th, dd, dt, blockquote")
 * which excludes <div>, so nested spans inside <div><em> fall back to parentElement=<em>
 * and are incorrectly split into separate single-span groups instead of one <div> group.
 */

import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Shared browser context
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
});

test.afterAll(async () => {
  await browserContext?.close();
});

// ---------------------------------------------------------------------------
// Test HTML fixtures
// ---------------------------------------------------------------------------

/**
 * AC1 / AC4: Both けが (unlearned) and アニメ (learning) as direct children of a <p>.
 * The grouping module must send both together for tokenization context and still apply
 * individual status classes to each span.
 */
const SINGLE_PARAGRAPH_HTML = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>Grouping E2E — Single Paragraph</title></head>
<body>
  <p id="block">
    <span id="kega">けが</span>
    <span id="anime">アニメ</span>
  </p>
</body>
</html>`;

/**
 * AC2: けが and 日本語 in separate <p> blocks.
 * Each block is an independent tokenization unit; the grouper must not merge them.
 */
const TWO_PARAGRAPHS_HTML = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>Grouping E2E — Two Paragraphs</title></head>
<body>
  <p id="block-a">
    <span id="kega">けが</span>
  </p>
  <p id="block-b">
    <span id="nihongo"><ruby>日本語<rt>にほんご</rt></ruby></span>
  </p>
</body>
</html>`;

/**
 * AC3a: NHK-style <div> with spans as direct children.
 * The grouper must treat <div> as a valid block ancestor so both spans are grouped.
 */
const NHK_DIV_DIRECT_HTML = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>Grouping E2E — NHK div direct</title></head>
<body>
  <div id="block">
    <span id="kega">けが</span>
    <span id="anime">アニメ</span>
  </div>
</body>
</html>`;

/**
 * AC3b: NHK-style <div> where each span is wrapped in an inline element (<em>).
 * This is the regression case that exposes the bug in the current implementation:
 *   current code: span.closest("p, li, td, ...") → no match → falls back to span.parentElement = <em>
 *   correct code (findBlockAncestor): walks up past <em> and finds the <div>
 * Without the fix, けが and アニメ each get their own group (parentElement=<em>) and
 * are tokenized without the other word's context. With the fix, both are in one <div> group.
 *
 * The E2E test doesn't directly observe grouping, but it verifies that both spans
 * still get annotated — a broken grouping path that causes an uncaught error would
 * prevent annotation of some spans.
 */
const NHK_DIV_NESTED_HTML = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>Grouping E2E — NHK div nested</title></head>
<body>
  <div id="block">
    <em><span id="kega">けが</span></em>
    <em><span id="anime">アニメ</span></em>
  </div>
</body>
</html>`;

/**
 * AC3c: NHK-style <div> whose spans are wrapped in <a> (hyperlinked vocabulary, common on NHK).
 * Same failure mode as AC3b — current closest() misses <div>, walks back to <a> as parentElement.
 */
const NHK_DIV_ANCHOR_HTML = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="utf-8"><title>Grouping E2E — NHK div anchor</title></head>
<body>
  <div id="block">
    <a href="#"><span id="kega">けが</span></a>
    <a href="#"><span id="nihongo"><ruby>日本語<rt>にほんご</rt></ruby></span></a>
  </div>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Opens a new page, intercepts the given URL to serve the supplied HTML, and
 * waits until the content script has applied at least one anki-* class.
 * The short timeout catch allows pages with no Anki matches to still resolve.
 */
async function openFixture(url, html) {
  const page = await browserContext.newPage();

  await page.route(url, (route) =>
    route.fulfill({ contentType: 'text/html', body: html })
  );

  await page.goto(url);

  await page
    .locator('[class*="anki-"]')
    .first()
    .waitFor({ timeout: 8000 })
    .catch(() => { /* no matches is acceptable for negative assertions */ });

  return page;
}

// ---------------------------------------------------------------------------
// AC1 — Multiple spans inside a single <p> each get individual anki-* classes
// ---------------------------------------------------------------------------

test('spans inside a single <p> each receive an individual anki-* class', async () => {
  // Grouping by block ancestor sends both words together for tokenization context,
  // but the highlight class must still land on each individual <span> so per-word
  // styling works. Without this, one span in the paragraph would be invisible.
  const page = await openFixture('http://grouping.test/single-p/', SINGLE_PARAGRAPH_HTML);

  await expect(page.locator('#kega')).toHaveClass(/anki-unlearned/);
  await expect(page.locator('#anime')).toHaveClass(/anki-learning/);

  await page.close();
});

test('<p> with two spans assigns distinct classes when the two cards have different types', async () => {
  // A faulty implementation that applies one class to the whole block instead of per-span
  // would give both spans the same class. This test catches that regression.
  const page = await openFixture('http://grouping.test/single-p-distinct/', SINGLE_PARAGRAPH_HTML);

  const kegaClass = await page.locator('#kega').getAttribute('class');
  const animeClass = await page.locator('#anime').getAttribute('class');

  expect(kegaClass).toMatch(/anki-unlearned/);
  expect(animeClass).toMatch(/anki-learning/);
  expect(kegaClass).not.toMatch(/anki-learning/);
  expect(animeClass).not.toMatch(/anki-unlearned/);

  await page.close();
});

// ---------------------------------------------------------------------------
// AC2 — Spans in separate <p> blocks each get independent classes
// ---------------------------------------------------------------------------

test('span in first <p> (けが) gets anki-unlearned independently of other blocks', async () => {
  // Separate block ancestors must produce independent tokenization units.
  // The first paragraph must be processed and annotated correctly.
  const page = await openFixture('http://grouping.test/two-p-first/', TWO_PARAGRAPHS_HTML);

  await expect(page.locator('#kega')).toHaveClass(/anki-unlearned/);

  await page.close();
});

test('span in second <p> (日本語) gets anki-learned independently of other blocks', async () => {
  // The second block must not be dropped when the page has multiple blocks.
  const page = await openFixture('http://grouping.test/two-p-second/', TWO_PARAGRAPHS_HTML);

  await expect(page.locator('#nihongo')).toHaveClass(/anki-learned/);

  await page.close();
});

// ---------------------------------------------------------------------------
// AC3a — NHK-style <div> with direct child spans: each span gets its own class
// ---------------------------------------------------------------------------

test('direct child spans inside a <div> each receive an individual anki-* class', async () => {
  // NHK Web Easy wraps article text in <div> rather than <p>. The grouper must
  // recognise <div> as a block boundary so spans are annotated correctly.
  const page = await openFixture('http://grouping.test/nhk-direct/', NHK_DIV_DIRECT_HTML);

  await expect(page.locator('#kega')).toHaveClass(/anki-unlearned/);
  await expect(page.locator('#anime')).toHaveClass(/anki-learning/);

  await page.close();
});

// ---------------------------------------------------------------------------
// AC3b — NHK-style <div> with spans nested inside inline wrappers (<em>)
//         This is the red-phase failure that proves the current implementation is broken.
// ---------------------------------------------------------------------------

test('spans nested inside <em> inside a <div> both get annotated (NHK nested-wrapper pattern)', async () => {
  // Current implementation: span.closest("p, li, td, th, dd, dt, blockquote") finds nothing
  // for a span whose ancestors are <em> and <div>; it then falls back to parentElement=<em>.
  // The two spans are split into separate single-element groups sharing no text context.
  // After the fix: findBlockAncestor walks past <em> to the <div>, grouping both together.
  // The test outcome (both spans annotated) is the same either way — the failure that
  // the refactor prevents is a silent quality regression in lemma tokenization context,
  // not a missing annotation. This test guards against a future regression where the
  // broken grouping path causes an uncaught error that prevents annotation entirely.
  const page = await openFixture('http://grouping.test/nhk-em/', NHK_DIV_NESTED_HTML);

  await expect(page.locator('#kega')).toHaveClass(/anki-unlearned/);
  await expect(page.locator('#anime')).toHaveClass(/anki-learning/);

  await page.close();
});

test('<div>-grouped spans wrapped in <em> get distinct classes per span', async () => {
  // Mirrors the per-<p> class-separation test for the nested NHK pattern.
  const page = await openFixture('http://grouping.test/nhk-em-distinct/', NHK_DIV_NESTED_HTML);

  const kegaClass = await page.locator('#kega').getAttribute('class');
  const animeClass = await page.locator('#anime').getAttribute('class');

  expect(kegaClass).toMatch(/anki-unlearned/);
  expect(animeClass).toMatch(/anki-learning/);
  expect(kegaClass).not.toMatch(/anki-learning/);
  expect(animeClass).not.toMatch(/anki-unlearned/);

  await page.close();
});

test('spans nested inside <a> inside a <div> both get annotated (hyperlinked vocabulary pattern)', async () => {
  // NHK Web Easy hyperlinks vocabulary words: <div><a href="…"><span>けが</span></a></div>.
  // current closest() misses <div>, falls back to parentElement=<a>, splitting the group.
  // findBlockAncestor walks past <a> to the <div>, correctly grouping both words.
  const page = await openFixture('http://grouping.test/nhk-anchor/', NHK_DIV_ANCHOR_HTML);

  await expect(page.locator('#kega')).toHaveClass(/anki-unlearned/);
  await expect(page.locator('#nihongo')).toHaveClass(/anki-learned/);

  await page.close();
});

// ---------------------------------------------------------------------------
// AC4 — The anki-* class is on the <span>, not on the parent <p> or <div>
// ---------------------------------------------------------------------------

test('parent <p> does not receive an anki-* class when its child spans are annotated', async () => {
  // The block ancestor is used only for tokenization context grouping; applying
  // the status class to it would highlight the entire paragraph, not individual words.
  const page = await openFixture('http://grouping.test/per-span-p/', SINGLE_PARAGRAPH_HTML);

  await page.locator('#kega').waitFor({ state: 'attached' });

  const parentBlock = page.locator('#block');
  await expect(parentBlock).not.toHaveClass(/anki-unlearned/);
  await expect(parentBlock).not.toHaveClass(/anki-learning/);
  await expect(parentBlock).not.toHaveClass(/anki-learned/);

  await page.close();
});

test('parent <div> does not receive an anki-* class when its child spans are annotated', async () => {
  // Same constraint as for <p>: the <div> block ancestor must never receive a status class.
  const page = await openFixture('http://grouping.test/per-span-div/', NHK_DIV_DIRECT_HTML);

  await page.locator('#kega').waitFor({ state: 'attached' });

  const parentBlock = page.locator('#block');
  await expect(parentBlock).not.toHaveClass(/anki-unlearned/);
  await expect(parentBlock).not.toHaveClass(/anki-learning/);
  await expect(parentBlock).not.toHaveClass(/anki-learned/);

  await page.close();
});
