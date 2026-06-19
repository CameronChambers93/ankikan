/**
 * Unit tests for overlay-render.js (issue #26).
 *
 * overlay-render.js does not exist yet; the imports below are intentionally
 * unresolvable so every test starts red until the developer creates the module.
 *
 * JSDOM zeroes getClientRects()/getBoundingClientRect(), so pixel-position
 * correctness is NOT tested here (that is Playwright e2e AC-21–24).  Instead,
 * wherever geometry matters we stub range.getClientRects() on a real Range to
 * return a controlled DOMRect array, then assert that the overlay div's inline
 * styles equal those controlled values plus the window scroll offsets.  This
 * tests the renderOverlay logic without depending on real layout.
 *
 * AC-14: body has exactly one #anki-overlay with pointer-events:none.
 * AC-15: clearOverlay removes #anki-overlay.
 * AC-16: rect div has correct class and inline style from stubbed rect + scroll.
 * AC-17: duplicate:true adds anki-duplicate class to rect div.
 * AC-18: furiganaVisible→true + reading emits a furigana element.
 * AC-19: furiganaVisible→false emits no furigana element.
 * AC-20: second renderOverlay call rebuilds overlay without duplication.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderOverlay, clearOverlay } from './overlay-render.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fresh JSDOM document and return it (with window attached). */
function makeDocument() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  return dom.window.document;
}

/**
 * Build a minimal WordRecord with a real JSDOM Range whose getClientRects is
 * stubbed to return the given array of rect-like objects.
 *
 * The Range is created on the document supplied; startContainer is the body
 * text node so the Range is real (not detached) and won't throw.
 */
function makeRecord(doc, overrides = {}) {
  const textNode = doc.createTextNode('日本語');
  doc.body.appendChild(textNode);
  const range = doc.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, 3);

  // Stub getClientRects to return a predictable array — JSDOM always returns [].
  const fakeRect = { x: 10, y: 20, width: 50, height: 16, left: 10, top: 20, right: 60, bottom: 36 };
  range.getClientRects = vi.fn().mockReturnValue([fakeRect]);

  return {
    range,
    surface: '日本語',
    lemma: null,
    reading: null,
    status: null,
    duplicate: false,
    ...overrides,
  };
}

/** Minimal settings covering all furigana flags. */
const baseSettings = {
  furiganaGlobal: true,
  furiganaUnlearned: true,
  furiganaLearning: true,
  furiganaLearned: false,
};

// ---------------------------------------------------------------------------
// AC-14: single overlay div with pointer-events:none
// ---------------------------------------------------------------------------

describe('renderOverlay — overlay container (AC-14)', () => {
  it('T-26-034: creates exactly one #anki-overlay element on body', () => {
    // A single overlay div must exist so CSS z-index scoping works; more than
    // one would stack and produce visual artefacts.
    const doc = makeDocument();
    const record = makeRecord(doc, { status: 'unlearned' });

    renderOverlay(doc, [record], baseSettings);

    const overlays = doc.querySelectorAll('#anki-overlay');
    expect(overlays.length).toBe(1);
    expect(doc.body.contains(overlays[0])).toBe(true);
  });

  it('T-26-035: #anki-overlay has pointer-events:none in its inline style', () => {
    // pointer-events:none ensures the overlay never intercepts mouse events that
    // should reach the underlying page content.
    const doc = makeDocument();
    const record = makeRecord(doc, { status: 'unlearned' });

    renderOverlay(doc, [record], baseSettings);

    const overlay = doc.getElementById('anki-overlay');
    expect(overlay.style.pointerEvents).toBe('none');
  });

  it('T-26-036: #anki-overlay is a direct child of body', () => {
    // The overlay must be a direct body child (not nested) so document-absolute
    // positioning with scrollX/scrollY offsets works correctly.
    const doc = makeDocument();
    const record = makeRecord(doc, { status: 'unlearned' });

    renderOverlay(doc, [record], baseSettings);

    const overlay = doc.getElementById('anki-overlay');
    expect(overlay.parentElement).toBe(doc.body);
  });

  it('T-26-037: records with null status produce no rect divs inside the overlay', () => {
    // Unscanned records (status null) have not been matched to Anki cards yet
    // and must not produce any overlay element.
    const doc = makeDocument();
    const record = makeRecord(doc, { status: null });

    renderOverlay(doc, [record], baseSettings);

    const overlay = doc.getElementById('anki-overlay');
    // Overlay may or may not exist, but must have no rect divs
    const rectDivs = overlay ? overlay.querySelectorAll('.anki-overlay-rect') : [];
    expect(rectDivs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-15: clearOverlay
// ---------------------------------------------------------------------------

describe('clearOverlay (AC-15)', () => {
  it('T-26-038: clearOverlay removes #anki-overlay from the document', () => {
    // After clearing, getElementById must return null so a subsequent
    // renderOverlay starts with a clean slate.
    const doc = makeDocument();
    const record = makeRecord(doc, { status: 'unlearned' });
    renderOverlay(doc, [record], baseSettings);

    clearOverlay(doc);

    expect(doc.getElementById('anki-overlay')).toBeNull();
  });

  it('T-26-039: clearOverlay does not throw when overlay does not exist', () => {
    // Calling clearOverlay on a document that never had an overlay must be a
    // safe no-op so callers need not check before calling.
    const doc = makeDocument();

    expect(() => clearOverlay(doc)).not.toThrow();
    expect(doc.getElementById('anki-overlay')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-16: rect div class and inline style with scroll offset
// ---------------------------------------------------------------------------

describe('renderOverlay — rect div geometry (AC-16)', () => {
  it('T-26-040: rect div carries class anki-overlay-rect and the status class', () => {
    // Each rect div must be identifiable by the generic anki-overlay-rect class
    // (for CSS resets) and the status class (for coloured background rules).
    const doc = makeDocument();
    const record = makeRecord(doc, { status: 'unlearned' });

    renderOverlay(doc, [record], baseSettings);

    const overlay = doc.getElementById('anki-overlay');
    const rectDiv = overlay.querySelector('.anki-overlay-rect');
    expect(rectDiv).not.toBeNull();
    expect(rectDiv.classList.contains('anki-unlearned')).toBe(true);
  });

  it('T-26-041: rect div inline left equals rect.left + window.scrollX', () => {
    // Document-absolute positioning requires adding the scroll offset to the
    // viewport-relative rect so the div tracks the word after scrolling.
    const doc = makeDocument();
    // JSDOM does not expose scrollX on the document; the implementation should
    // read from the window object.  We simulate scrollX=5 via the document's
    // defaultView if accessible, or expect the implementation accepts it as 0.
    const record = makeRecord(doc, { status: 'unlearned' });
    // Stubbed rect: left=10, top=20, width=50, height=16
    // scrollX defaults to 0 in JSDOM → expected left = 10
    renderOverlay(doc, [record], baseSettings);

    const overlay = doc.getElementById('anki-overlay');
    const rectDiv = overlay.querySelector('.anki-overlay-rect');
    // Parse the px value from inline style
    const left = parseFloat(rectDiv.style.left);
    // scrollX is 0 in JSDOM so expected = fakeRect.left + 0 = 10
    expect(left).toBe(10);
  });

  it('T-26-042: rect div inline top equals rect.top + window.scrollY', () => {
    // Same rationale as left — scrollY must be added to the rect's top value.
    const doc = makeDocument();
    const record = makeRecord(doc, { status: 'learning' });

    renderOverlay(doc, [record], baseSettings);

    const overlay = doc.getElementById('anki-overlay');
    const rectDiv = overlay.querySelector('.anki-overlay-rect');
    const top = parseFloat(rectDiv.style.top);
    // fakeRect.top=20, scrollY=0 → 20
    expect(top).toBe(20);
  });

  it('T-26-043: rect div inline width and height equal the rect dimensions', () => {
    // Width and height do not change with scroll so they are copied verbatim
    // from the DOMRect returned by getClientRects.
    const doc = makeDocument();
    const record = makeRecord(doc, { status: 'learned' });

    renderOverlay(doc, [record], baseSettings);

    const overlay = doc.getElementById('anki-overlay');
    const rectDiv = overlay.querySelector('.anki-overlay-rect');
    expect(parseFloat(rectDiv.style.width)).toBe(50);
    expect(parseFloat(rectDiv.style.height)).toBe(16);
  });

  it('T-26-044: scroll offsets are added to rect coords when window.scrollX/scrollY are non-zero', () => {
    // This test stubs the window scroll values on the document's defaultView to
    // verify the implementation actually reads and applies them.
    const doc = makeDocument();
    Object.defineProperty(doc.defaultView, 'scrollX', { value: 7, configurable: true });
    Object.defineProperty(doc.defaultView, 'scrollY', { value: 13, configurable: true });
    const record = makeRecord(doc, { status: 'unlearned' });
    // fakeRect.left=10, fakeRect.top=20 → expected: left=17, top=33

    renderOverlay(doc, [record], baseSettings);

    const overlay = doc.getElementById('anki-overlay');
    const rectDiv = overlay.querySelector('.anki-overlay-rect');
    expect(parseFloat(rectDiv.style.left)).toBe(17);
    expect(parseFloat(rectDiv.style.top)).toBe(33);
  });
});

// ---------------------------------------------------------------------------
// AC-17: duplicate class
// ---------------------------------------------------------------------------

describe('renderOverlay — duplicate (AC-17)', () => {
  it('T-26-045: rect div has anki-duplicate class when record.duplicate is true', () => {
    // When multiple Anki cards match the same word, the rect div must be marked
    // so the user can see the ambiguity via the ::after pseudo-element.
    const doc = makeDocument();
    const record = makeRecord(doc, { status: 'unlearned', duplicate: true });

    renderOverlay(doc, [record], baseSettings);

    const overlay = doc.getElementById('anki-overlay');
    const rectDiv = overlay.querySelector('.anki-overlay-rect');
    expect(rectDiv.classList.contains('anki-duplicate')).toBe(true);
  });

  it('T-26-046: rect div does not have anki-duplicate class when record.duplicate is false', () => {
    // The duplicate class must be absent for unambiguous matches so the user
    // is not confused by a marker that does not apply.
    const doc = makeDocument();
    const record = makeRecord(doc, { status: 'unlearned', duplicate: false });

    renderOverlay(doc, [record], baseSettings);

    const overlay = doc.getElementById('anki-overlay');
    const rectDiv = overlay.querySelector('.anki-overlay-rect');
    expect(rectDiv.classList.contains('anki-duplicate')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-18: furigana element emitted when furiganaVisible && reading present
// ---------------------------------------------------------------------------

describe('renderOverlay — furigana emit (AC-18)', () => {
  it('T-26-047: a furigana element with class anki-furigana is appended when furiganaVisible and reading is set', () => {
    // The overlay furigana element is the only source of generated readings for
    // pages without ruby markup; it must appear when settings permit it.
    const doc = makeDocument();
    const record = makeRecord(doc, {
      status: 'unlearned',
      reading: 'にほんご',
    });
    const settings = { ...baseSettings, furiganaGlobal: true, furiganaUnlearned: true };

    renderOverlay(doc, [record], settings);

    const overlay = doc.getElementById('anki-overlay');
    const furigana = overlay.querySelector('.anki-furigana');
    expect(furigana).not.toBeNull();
    expect(furigana.textContent).toBe('にほんご');
  });

  it('T-26-048: furigana element text content equals record.reading', () => {
    // The furigana must display the hiragana reading exactly as stored in the
    // record; any transformation here would produce incorrect annotations.
    const doc = makeDocument();
    const record = makeRecord(doc, { status: 'learning', reading: 'べんきょう' });

    renderOverlay(doc, [record], { ...baseSettings, furiganaLearning: true });

    const overlay = doc.getElementById('anki-overlay');
    expect(overlay.querySelector('.anki-furigana').textContent).toBe('べんきょう');
  });
});

// ---------------------------------------------------------------------------
// AC-19: furigana suppressed when furiganaVisible returns false
// ---------------------------------------------------------------------------

describe('renderOverlay — furigana suppression (AC-19)', () => {
  it('T-26-049: no furigana element when furiganaGlobal is false', () => {
    // The global furigana flag disables all furigana regardless of the per-status
    // setting or whether a reading is present.
    const doc = makeDocument();
    const record = makeRecord(doc, { status: 'unlearned', reading: 'にほんご' });
    const settings = { ...baseSettings, furiganaGlobal: false };

    renderOverlay(doc, [record], settings);

    const overlay = doc.getElementById('anki-overlay');
    const furigana = overlay ? overlay.querySelector('.anki-furigana') : null;
    expect(furigana).toBeNull();
  });

  it('T-26-050: no furigana element when per-status flag is false (furiganaUnlearned=false for unlearned)', () => {
    // Even with the global flag true, the per-status override can suppress
    // furigana for a specific category.
    const doc = makeDocument();
    const record = makeRecord(doc, { status: 'unlearned', reading: 'にほんご' });
    const settings = { ...baseSettings, furiganaGlobal: true, furiganaUnlearned: false };

    renderOverlay(doc, [record], settings);

    const overlay = doc.getElementById('anki-overlay');
    const furigana = overlay ? overlay.querySelector('.anki-furigana') : null;
    expect(furigana).toBeNull();
  });

  it('T-26-051: no furigana element when record.reading is null', () => {
    // A record without a reading (e.g. from collectFromSpans) cannot produce a
    // furigana annotation; the element must not appear with empty text.
    const doc = makeDocument();
    const record = makeRecord(doc, { status: 'unlearned', reading: null });
    const settings = { ...baseSettings, furiganaGlobal: true, furiganaUnlearned: true };

    renderOverlay(doc, [record], settings);

    const overlay = doc.getElementById('anki-overlay');
    const furigana = overlay ? overlay.querySelector('.anki-furigana') : null;
    expect(furigana).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-20: idempotent rebuild (second call clears and rebuilds)
// ---------------------------------------------------------------------------

describe('renderOverlay — idempotent rebuild (AC-20)', () => {
  it('T-26-052: calling renderOverlay twice does not duplicate #anki-overlay', () => {
    // Re-scanning the page calls renderOverlay again; there must still be exactly
    // one overlay div, not two stacked on top of each other.
    const doc = makeDocument();
    const record = makeRecord(doc, { status: 'unlearned' });

    renderOverlay(doc, [record], baseSettings);
    renderOverlay(doc, [record], baseSettings);

    expect(doc.querySelectorAll('#anki-overlay').length).toBe(1);
  });

  it('T-26-053: second renderOverlay call clears old rect divs before adding new ones', () => {
    // Old rect divs from the first call must be removed so stale highlights
    // from a previous scan cannot persist after the records change.
    const doc = makeDocument();
    const record1 = makeRecord(doc, { status: 'unlearned' });

    renderOverlay(doc, [record1], baseSettings);
    const countAfterFirst = doc.querySelectorAll('.anki-overlay-rect').length;

    // Second call with an empty records array — overlay must be cleared.
    renderOverlay(doc, [], baseSettings);
    const countAfterSecond = doc.querySelectorAll('.anki-overlay-rect').length;

    expect(countAfterFirst).toBeGreaterThan(0);
    expect(countAfterSecond).toBe(0);
  });

  it('T-26-054: second renderOverlay call with updated status produces new class on rect div', () => {
    // After a rescan, a word may receive a different status; the rect div must
    // reflect the new status, not the stale one from the first call.
    const doc = makeDocument();
    const record = makeRecord(doc, { status: 'unlearned' });

    renderOverlay(doc, [record], baseSettings);

    // Update status and re-render.
    record.status = 'learned';
    renderOverlay(doc, [record], baseSettings);

    const overlay = doc.getElementById('anki-overlay');
    const rectDivs = overlay.querySelectorAll('.anki-overlay-rect');
    expect(rectDivs.length).toBeGreaterThan(0);
    expect(rectDivs[0].classList.contains('anki-learned')).toBe(true);
    expect(rectDivs[0].classList.contains('anki-unlearned')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Multiple rects per range (multi-line words)
// ---------------------------------------------------------------------------

describe('renderOverlay — multiple rects per range', () => {
  it('T-26-055: produces one rect div per entry returned by range.getClientRects()', () => {
    // A word that wraps across a line break produces two client rects; the
    // overlay must emit one div per rect so all line fragments are highlighted.
    const doc = makeDocument();
    const textNode = doc.createTextNode('日本語');
    doc.body.appendChild(textNode);
    const range = doc.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 3);
    const rect1 = { x: 0, y: 0, width: 30, height: 16, left: 0, top: 0, right: 30, bottom: 16 };
    const rect2 = { x: 0, y: 20, width: 20, height: 16, left: 0, top: 20, right: 20, bottom: 36 };
    range.getClientRects = vi.fn().mockReturnValue([rect1, rect2]);

    const record = {
      range,
      surface: '日本語',
      lemma: null,
      reading: null,
      status: 'unlearned',
      duplicate: false,
    };

    renderOverlay(doc, [record], baseSettings);

    const overlay = doc.getElementById('anki-overlay');
    const rectDivs = overlay.querySelectorAll('.anki-overlay-rect');
    expect(rectDivs.length).toBe(2);
  });
});
