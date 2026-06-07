import { STYLE_DEFAULTS } from './style-util.js';

/**
 * Resets every style input in `doc` to STYLE_DEFAULTS values, persists to storage,
 * and notifies the active tab to refresh its injected stylesheet.
 *
 * Input element IDs are the DOM contract shared between popup.html and popup.js:
 *   global-bg-color, global-bg-opacity, global-border-radius,
 *   global-outline-color, global-outline-opacity, global-outline-width,
 *   unlearned-bg-color, unlearned-bg-opacity,
 *   learning-bg-color, learning-bg-opacity,
 *   learned-bg-color, learned-bg-opacity
 *
 * @param {Document} doc       - The popup document (pass `document` in production).
 * @param {Function} storageFn - Called with `{ styleSettings }` to persist; wrap chrome.storage.local.set.
 * @param {Function} messageFn - Called with `{ action: 'refreshStyles', styleSettings }` to notify the tab.
 */
export function resetToDefaults(doc, storageFn, messageFn) {
  const defaults = STYLE_DEFAULTS.styleSettings;
  doc.getElementById('global-bg-color').value        = defaults.default.backgroundColor;
  doc.getElementById('global-bg-opacity').value      = defaults.default.backgroundOpacity;
  doc.getElementById('global-border-radius').value   = defaults.default.borderRadius;
  doc.getElementById('global-outline-color').value   = defaults.default.outlineColor;
  doc.getElementById('global-outline-opacity').value = defaults.default.outlineOpacity;
  doc.getElementById('global-outline-width').value   = defaults.default.outlineWidth;
  for (const cat of ['unlearned', 'learning', 'learned']) {
    const colorEl   = doc.getElementById(`${cat}-bg-color`);
    const opacityEl = doc.getElementById(`${cat}-bg-opacity`);
    if (colorEl)   colorEl.value   = '';
    if (opacityEl) opacityEl.value = '';
  }
  storageFn({ styleSettings: defaults });
  messageFn({ action: 'refreshStyles', styleSettings: defaults });
}
