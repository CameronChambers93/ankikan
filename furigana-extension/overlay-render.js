import { furiganaVisible } from './scan-util.js';

/**
 * Removes the #anki-overlay element from the document if it exists.
 * Safe to call when no overlay is present.
 *
 * @param {Document} doc
 */
export function clearOverlay(doc) {
  const existing = doc.getElementById('anki-overlay');
  if (existing) existing.remove();
}

/**
 * Renders (or re-renders) the highlight overlay and any furigana annotations.
 * Creates a single #anki-overlay div (position:absolute; top:0; left:0;
 * pointer-events:none; z-index:2147483647) as a direct body child.
 * Clears any previous overlay before building the new one.
 *
 * @param {Document} doc
 * @param {Array} records - WordRecord[] from collectWords / collectFromSpans.
 * @param {object} settings - Extension settings with furigana* flags.
 */
export function renderOverlay(doc, records, settings) {
  _rendering = true;
  clearOverlay(doc);

  const overlay = doc.createElement('div');
  overlay.id = 'anki-overlay';
  overlay.style.position = 'absolute';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '2147483647';
  doc.body.appendChild(overlay);

  const win = doc.defaultView || {};
  const scrollX = win.scrollX || 0;
  const scrollY = win.scrollY || 0;

  // For pre-annotated records (reading:null from collectFromSpans), the page's own
  // <ruby><rt> markup is toggled via the .anki-hide-furigana class on the body so
  // the CSS rule `.anki-hide-furigana rt { visibility:hidden }` applies.
  // We apply the class when any pre-annotated word has furigana disabled.
  const hasHiddenPageRuby = records.some(
    (r) => r.status && r.reading === null && !furiganaVisible(r.status, settings)
  );
  if (hasHiddenPageRuby) {
    doc.body.classList.add('anki-hide-furigana');
  } else {
    doc.body.classList.remove('anki-hide-furigana');
  }

  for (const record of records) {
    if (!record.status) continue;

    const rects = Array.from(record.range.getClientRects());
    if (!rects.length) continue;

    const showFurigana = furiganaVisible(record.status, settings) && !!record.reading;

    rects.forEach((rect, i) => {
      const div = doc.createElement('div');
      div.className = `anki-overlay-rect anki-${record.status}`;
      if (record.duplicate) div.classList.add('anki-duplicate');

      div.style.position = 'absolute';
      div.style.left = `${rect.left + scrollX}px`;
      div.style.top = `${rect.top + scrollY}px`;
      div.style.width = `${rect.width}px`;
      div.style.height = `${rect.height}px`;

      overlay.appendChild(div);

      if (showFurigana && i === 0) {
        const furi = doc.createElement('div');
        furi.className = 'anki-furigana';
        furi.textContent = record.reading;
        furi.style.position = 'absolute';
        furi.style.left = `${rect.left + scrollX}px`;
        furi.style.top = `${rect.top + scrollY - 14}px`;
        overlay.appendChild(furi);
      }
    });
  }

  // Reset the flag in the next macrotask, after MutationObserver callbacks have fired.
  // This prevents re-entrant reposition triggers from overlay DOM mutations.
  setTimeout(() => { _rendering = false; }, 0);
}

/**
 * Repositions all rect divs inside #anki-overlay to match the current layout.
 * Reads all client rects first, then writes all positions (batch read/write).
 *
 * @param {Document} doc
 * @param {Array} records - WordRecord[].
 * @param {object} settings - Extension settings with furigana* flags.
 */
export function reposition(doc, records, settings) {
  renderOverlay(doc, records, settings);
}

/**
 * Attaches resize, scroll, font-loading, and MutationObserver listeners that
 * keep the overlay in sync with layout changes.  Returns a cleanup function
 * that removes all listeners and observers.
 *
 * @param {Document} doc
 * @param {Function} onReposition - Called (possibly debounced) when a repositioning event fires.
 * @returns {Function} Cleanup function.
 */
// Flag set during renderOverlay to suppress MutationObserver re-entry.
let _rendering = false;

export function attachRepositionListeners(doc, onReposition) {
  const win = doc.defaultView;
  if (!win) return () => {};

  let rafId = null;
  function throttled() {
    if (rafId) return;
    rafId = win.requestAnimationFrame(() => {
      rafId = null;
      onReposition();
    });
  }

  win.addEventListener('resize', throttled);
  win.addEventListener('scroll', throttled, { passive: true });

  let resizeObserver = null;
  if (win.ResizeObserver) {
    resizeObserver = new win.ResizeObserver(throttled);
    resizeObserver.observe(doc.body);
  }

  if (doc.fonts && doc.fonts.ready) {
    doc.fonts.ready.then(() => onReposition());
  }

  let mutationTimer = null;
  const mutationObserver = new win.MutationObserver(() => {
    if (_rendering) return;
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => onReposition(), 500);
  });
  mutationObserver.observe(doc.body, { childList: true, subtree: true });

  return function cleanup() {
    win.removeEventListener('resize', throttled);
    win.removeEventListener('scroll', throttled);
    if (resizeObserver) resizeObserver.disconnect();
    mutationObserver.disconnect();
    if (mutationTimer) clearTimeout(mutationTimer);
    if (rafId) win.cancelAnimationFrame(rafId);
  };
}
