import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { STYLE_DEFAULTS, STYLE_CATEGORIES } from './style-util.js';

// ---------------------------------------------------------------------------
// Issue #47 AC-4 (continued) — per-category override tabs
//
// options.presets.test.js T-47-012 already covers grouping the six GLOBAL
// default controls (fill/shape/border). That leaves the 48 per-category
// override inputs (4 STYLE_CATEGORIES x 6 STYLE_SCHEMA entries x 2 controls
// each) as one flat scroll beneath the global groups -- still a "60-input
// single scroll" by AC-4's own count. This file locks down the tab UI that
// replaces that flat list.
//
// Contract this spec locks down (to be implemented in options.js):
//
//   - ensureStyleControls(doc), after the existing global default group
//     containers, additionally generates:
//       * a `role="tablist"` element containing one
//         `<button type="button" role="tab" class="style-category-tab"
//          id="style-tab-<cat>" data-category="<cat>"
//          aria-controls="style-panel-<cat>" aria-selected="...">` per
//         STYLE_CATEGORIES entry, IN STYLE_CATEGORIES ORDER. The first
//         category is selected by default (aria-selected="true"); the rest
//         are "false".
//       * one `<div class="style-category-panel" role="tabpanel"
//          id="style-panel-<cat>" data-category-panel="<cat>">` per category,
//         containing that category's existing `<cat>-<entry.id>` /
//         `<cat>-<entry.id>-enabled` controls (ids unchanged from issue #45).
//         The first category's panel is visible; every other panel carries
//         the `hidden` attribute.
//   - selectStyleCategory(doc, cat) is a new export that shows
//     #style-panel-<cat> (removes `hidden`), hides every other panel (adds
//     `hidden`), and moves aria-selected="true" to #style-tab-<cat> (the
//     rest become "false").
// ---------------------------------------------------------------------------

function makeDoc() {
  const { window } = new JSDOM(`<!DOCTYPE html><html><body>
    <section>
      <h2>Highlight Style</h2>
      <label for="style-preset">Preset</label>
      <select id="style-preset"></select>
      <div id="style-controls"></div>
      <button id="resetStylesBtn">Reset to defaults</button>
    </section>
  </body></html>`);
  return window.document;
}

describe('per-category override tabs (issue #47 AC-4)', () => {
  it('T-47-023 ensureStyleControls generates a tablist with one tab per STYLE_CATEGORIES entry in order, and one panel per category containing that category\'s bg-color input', async () => {
    // Proves the tablist/panel skeleton exists and that per-category controls
    // (still keyed by the unchanged `<cat>-<entry.id>` ids) actually live
    // inside their matching panel, not just alongside it.
    const { loadStyleSettings } = await import('./options.js');
    const doc = makeDoc();
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: STYLE_DEFAULTS.styleSettings });
    await loadStyleSettings(doc, storageGet);

    const tablist = doc.querySelector('[role="tablist"]');
    expect(tablist, '#style-controls must contain a role="tablist" element').not.toBeNull();

    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
    expect(tabs.length, 'must be exactly one tab per STYLE_CATEGORIES entry').toBe(STYLE_CATEGORIES.length);
    expect(tabs.map((t) => t.dataset.category)).toEqual(STYLE_CATEGORIES);
    expect(tabs.map((t) => t.id)).toEqual(STYLE_CATEGORIES.map((cat) => `style-tab-${cat}`));
    for (const tab of tabs) {
      expect(tab.tagName).toBe('BUTTON');
      expect(tab.getAttribute('type')).toBe('button');
      expect(tab.classList.contains('style-category-tab')).toBe(true);
      const cat = tab.dataset.category;
      expect(tab.getAttribute('aria-controls')).toBe(`style-panel-${cat}`);
    }

    for (const cat of STYLE_CATEGORIES) {
      const panel = doc.getElementById(`style-panel-${cat}`);
      expect(panel, `#style-panel-${cat} must exist`).not.toBeNull();
      expect(panel.getAttribute('role')).toBe('tabpanel');
      expect(panel.classList.contains('style-category-panel')).toBe(true);
      expect(panel.dataset.categoryPanel).toBe(cat);

      const input = doc.getElementById(`${cat}-bg-color`);
      expect(input, `#${cat}-bg-color must exist`).not.toBeNull();
      expect(panel.contains(input), `#${cat}-bg-color must live inside #style-panel-${cat}`).toBe(true);
    }
  });

  it('T-47-024 on initial generation only the first category (unknown) panel is visible and its tab is aria-selected; every other panel is hidden', async () => {
    // This is the "no 60-input single scroll" guarantee itself: exactly one
    // category's override inputs may be reachable/visible at a time.
    const { loadStyleSettings } = await import('./options.js');
    const doc = makeDoc();
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: STYLE_DEFAULTS.styleSettings });
    await loadStyleSettings(doc, storageGet);

    const [first, ...rest] = STYLE_CATEGORIES;
    expect(first, 'STYLE_CATEGORIES must lead with "unknown" per style-util.js').toBe('unknown');

    const firstPanel = doc.getElementById(`style-panel-${first}`);
    expect(firstPanel, `#style-panel-${first} must exist`).not.toBeNull();
    expect(firstPanel.hasAttribute('hidden'), `#style-panel-${first} must be visible by default`).toBe(false);
    expect(doc.getElementById(`style-tab-${first}`).getAttribute('aria-selected')).toBe('true');

    for (const cat of rest) {
      const panel = doc.getElementById(`style-panel-${cat}`);
      expect(panel, `#style-panel-${cat} must exist`).not.toBeNull();
      expect(panel.hasAttribute('hidden'), `#style-panel-${cat} must start hidden`).toBe(true);
      expect(doc.getElementById(`style-tab-${cat}`).getAttribute('aria-selected')).toBe('false');
    }

    const visiblePanels = STYLE_CATEGORIES.filter(
      (cat) => !doc.getElementById(`style-panel-${cat}`).hasAttribute('hidden')
    );
    expect(visiblePanels, 'exactly one panel must be visible at a time').toEqual([first]);
  });

  it('T-47-025 selectStyleCategory(doc, "learning") shows #style-panel-learning, hides every other panel, and moves aria-selected to #style-tab-learning', async () => {
    // The switching behaviour itself: calling the exported function must be
    // enough to flip both the panel visibility and the tab's ARIA state, with
    // no other panel left visible.
    const { loadStyleSettings, selectStyleCategory } = await import('./options.js');
    const doc = makeDoc();
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: STYLE_DEFAULTS.styleSettings });
    await loadStyleSettings(doc, storageGet);

    selectStyleCategory(doc, 'learning');

    expect(doc.getElementById('style-panel-learning').hasAttribute('hidden')).toBe(false);
    expect(doc.getElementById('style-tab-learning').getAttribute('aria-selected')).toBe('true');

    for (const cat of STYLE_CATEGORIES.filter((c) => c !== 'learning')) {
      expect(
        doc.getElementById(`style-panel-${cat}`).hasAttribute('hidden'),
        `#style-panel-${cat} must be hidden after selecting "learning"`
      ).toBe(true);
      expect(doc.getElementById(`style-tab-${cat}`).getAttribute('aria-selected')).toBe('false');
    }
  });

  it('T-47-026 editing an override input inside a non-default selected panel still round-trips through currentStyleSettings', async () => {
    // Tabs must be purely a visibility affordance: an input in a currently
    // hidden-then-shown panel is still a real DOM node with a real value, so
    // the existing read path (currentStyleSettings, unchanged from issue #45)
    // must not need to know anything about tab state.
    const { loadStyleSettings, selectStyleCategory, currentStyleSettings } = await import('./options.js');
    const doc = makeDoc();
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: STYLE_DEFAULTS.styleSettings });
    await loadStyleSettings(doc, storageGet);

    selectStyleCategory(doc, 'learning');

    const enabledEl = doc.getElementById('learning-bg-color-enabled');
    expect(enabledEl, '#learning-bg-color-enabled must exist').not.toBeNull();
    enabledEl.checked = true;
    const valueEl = doc.getElementById('learning-bg-color');
    expect(valueEl, '#learning-bg-color must exist').not.toBeNull();
    valueEl.disabled = false;
    valueEl.value = '#123456';

    const result = currentStyleSettings(doc);
    expect(result.learning.backgroundColor).toBe('#123456');
  });
});
