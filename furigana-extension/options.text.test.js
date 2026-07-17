import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { STYLE_DEFAULTS, STYLE_SCHEMA } from './style-util.js';

// ---------------------------------------------------------------------------
// Issue #48 — Highlight styling: text styling + underline properties
// (options-page wiring)
//
// The dev plan adds two new STYLE_SCHEMA control types: "bool" (fontWeight ->
// <input type="checkbox">) and "enum" (textDecorationStyle -> <select> built
// from entry.options). These specs drive that generation, and the
// read-back/round-trip and live-preview paths, ENTIRELY through STYLE_SCHEMA
// itself (never hard-coding an id/key for the new properties) so they hold
// regardless of exactly which id fragments the developer chooses for the new
// entries -- only the *type* contract (bool/enum) and STYLE_SCHEMA's existing
// key/id/group/options shape are assumed, matching options.schema.test.js's
// existing convention of driving assertions off STYLE_SCHEMA rather than
// literal ids for the generated-from-schema paths.
//
// Right now STYLE_SCHEMA has zero "bool" or "enum" entries, so the first
// assertion in each describe block below (STYLE_SCHEMA must declare at least
// one of each) is expected to fail until the developer adds fontWeight /
// textDecorationStyle (or equivalent) to STYLE_SCHEMA.
// ---------------------------------------------------------------------------

function makeSchemaOptionsDoc() {
  const { window } = new JSDOM(`<!DOCTYPE html><html><body>
    <section>
      <h2>Highlight Style</h2>
      <div id="style-controls"></div>
      <button id="resetStylesBtn">Reset to defaults</button>
    </section>
  </body></html>`);
  return window.document;
}

describe('bool/enum control generation (issue #48 AC-1/AC-2)', () => {
  it('T-48-010 STYLE_SCHEMA declares at least one "bool" entry and one "enum" entry, and loadStyleSettings renders them as <input type="checkbox"> and <select> (with one <option> per entry.options) respectively; both round-trip through currentStyleSettings', async () => {
    const boolEntries = STYLE_SCHEMA.filter((e) => e.type === 'bool');
    const enumEntries = STYLE_SCHEMA.filter((e) => e.type === 'enum');
    expect(boolEntries.length, 'STYLE_SCHEMA must declare at least one "bool" entry (e.g. fontWeight)').toBeGreaterThan(0);
    expect(enumEntries.length, 'STYLE_SCHEMA must declare at least one "enum" entry (e.g. textDecorationStyle)').toBeGreaterThan(0);

    const { loadStyleSettings, currentStyleSettings } = await import('./options.js');
    const doc = makeSchemaOptionsDoc();
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: STYLE_DEFAULTS.styleSettings });
    await loadStyleSettings(doc, storageGet);

    for (const entry of boolEntries) {
      const globalEl = doc.getElementById(`global-${entry.id}`);
      expect(globalEl, `missing default control for bool entry "${entry.key}" (#global-${entry.id})`).not.toBeNull();
      expect(globalEl.tagName, `#global-${entry.id} must be an <input>`).toBe('INPUT');
      expect(globalEl.type, `#global-${entry.id} must be type="checkbox"`).toBe('checkbox');

      // Round-trip: checking the box must set the boolean true on "default".
      globalEl.checked = true;
      let result = currentStyleSettings(doc);
      expect(result.default[entry.key], `checked "${entry.key}" checkbox must read back as boolean true`).toBe(true);

      globalEl.checked = false;
      result = currentStyleSettings(doc);
      expect(result.default[entry.key], `unchecked "${entry.key}" checkbox must read back as boolean false`).toBe(false);
    }

    for (const entry of enumEntries) {
      expect(Array.isArray(entry.options), `enum entry "${entry.key}" must declare an "options" array`).toBe(true);
      expect(entry.options.length, `enum entry "${entry.key}".options must be non-empty`).toBeGreaterThan(0);

      const globalEl = doc.getElementById(`global-${entry.id}`);
      expect(globalEl, `missing default control for enum entry "${entry.key}" (#global-${entry.id})`).not.toBeNull();
      expect(globalEl.tagName, `#global-${entry.id} must be a <select>`).toBe('SELECT');

      const optionValues = Array.from(globalEl.options).map((o) => o.value);
      expect(optionValues, `#global-${entry.id} <option> values must equal entry.options exactly`).toEqual(entry.options);

      // Round-trip: selecting a non-first option must read back exactly that string.
      const chosen = entry.options[entry.options.length - 1];
      globalEl.value = chosen;
      const result = currentStyleSettings(doc);
      expect(result.default[entry.key], `selected "${entry.key}" option must read back verbatim`).toBe(chosen);
    }
  });
});

describe('per-category enable + value scoping for new control types (issue #48 AC-1/AC-2)', () => {
  it('T-48-011 enabling a per-category override for an enum entry includes ONLY that key with the selected option value; leaving the checkbox unchecked omits the key from that category entirely (same enable/override contract as the pre-existing color/opacity/px controls)', async () => {
    const entry = STYLE_SCHEMA.find((e) => e.type === 'enum');
    expect(entry, 'STYLE_SCHEMA must contain an "enum" entry to override per category').toBeDefined();

    const { loadStyleSettings, currentStyleSettings } = await import('./options.js');
    const doc = makeSchemaOptionsDoc();
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: STYLE_DEFAULTS.styleSettings });
    await loadStyleSettings(doc, storageGet);

    const enabledEl = doc.getElementById(`learning-${entry.id}-enabled`);
    const valueEl = doc.getElementById(`learning-${entry.id}`);
    expect(enabledEl, `missing enable checkbox for "${entry.key}"/"learning" (#learning-${entry.id}-enabled)`).not.toBeNull();
    expect(valueEl, `missing override control for "${entry.key}"/"learning" (#learning-${entry.id})`).not.toBeNull();
    expect(enabledEl.type).toBe('checkbox');

    // Baseline: never enabled -> the key must be entirely absent (not just falsy).
    let result = currentStyleSettings(doc);
    expect(result.learning, `"learning" must not contain "${entry.key}" while its checkbox is unchecked`).not.toHaveProperty(entry.key);

    // Enable + choose a non-"none" option -> included with exactly that value,
    // and ONLY that key (no other schema key leaks into "learning").
    const chosenValue = entry.options.find((o) => o !== 'none') ?? entry.options[0];
    enabledEl.checked = true;
    valueEl.value = chosenValue;

    result = currentStyleSettings(doc);
    expect(result.learning[entry.key]).toBe(chosenValue);
    expect(Object.keys(result.learning)).toEqual([entry.key]);
  });
});

describe('renderPreview reflects a new text/underline property (issue #48, extending issue #46 AC-1)', () => {
  /**
   * Appends a #style-preview container with one sample span per anki-<cat>
   * class, mirroring options.test.js's appendPreviewContainer (issue #46) --
   * built here rather than imported since it is test-only DOM scaffolding,
   * not production logic, and options.test.js does not export it.
   */
  function appendPreviewContainer(doc) {
    const container = doc.createElement('div');
    container.id = 'style-preview';
    const span = doc.createElement('span');
    span.className = 'anki-unknown';
    span.textContent = '日本語のサンプル文';
    container.appendChild(span);
    doc.body.appendChild(container);
    return container;
  }

  it('T-48-012 checking the generated global control for a "bool" entry (fontWeight) and calling renderPreview injects a CSS rule containing "font-weight: bold;" -- the live preview reflects the new property with no storage round-trip', async () => {
    const entry = STYLE_SCHEMA.find((e) => e.type === 'bool');
    expect(entry, 'STYLE_SCHEMA must contain a "bool" entry (e.g. fontWeight) to preview').toBeDefined();

    const { loadStyleSettings, renderPreview, currentStyleSettings } = await import('./options.js');
    const doc = makeSchemaOptionsDoc();
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: STYLE_DEFAULTS.styleSettings });
    await loadStyleSettings(doc, storageGet);
    appendPreviewContainer(doc);

    // Before checking the box, the preview must not claim bold text.
    renderPreview(doc);
    const styleElBefore = doc.getElementById('style-preview-styles');
    expect(styleElBefore, '#style-preview-styles must exist after the first renderPreview call').not.toBeNull();
    expect(styleElBefore.textContent).not.toContain('font-weight');

    // Simulate the user checking the box directly (no storageSet call anywhere
    // in this test -- matches T-46-002's "no storage round-trip" contract).
    const globalEl = doc.getElementById(`global-${entry.id}`);
    globalEl.checked = true;
    renderPreview(doc);

    const styleElAfter = doc.getElementById('style-preview-styles');
    expect(styleElAfter.textContent).toContain('font-weight: bold;');

    // The scoping contract from issue #46 (T-46-004) must still hold for the
    // new declaration -- it lives inside a #style-preview .anki-<cat> rule.
    expect(styleElAfter.textContent).toMatch(/#style-preview \.anki-unknown \{[^}]*font-weight: bold;/);

    const settings = currentStyleSettings(doc);
    expect(settings.default[entry.key]).toBe(true);
  });
});
