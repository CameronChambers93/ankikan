import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { STYLE_DEFAULTS, STYLE_SCHEMA, STYLE_CATEGORIES } from './style-util.js';

// ---------------------------------------------------------------------------
// Issue #49 — Highlight styling: glow/shadow + spacing properties
// (options-page wiring)
//
// The dev plan adds seven new STYLE_SCHEMA entries: glowColor (color),
// glowOpacity (opacity, pairs with glowColor), glowBlur / glowSpread (px,
// group "effects"), and paddingX / paddingY / letterSpacing (px, group
// "spacing"). These specs drive the schema-driven generator (issue #45),
// the per-category enable/override contract (issue #48's T-48-011 pattern),
// and the live preview (issue #46/#48's T-48-012 pattern) for the new keys --
// ENTIRELY through STYLE_SCHEMA itself (never hard-coding an id/key for the
// new properties) so they hold regardless of exactly which id fragments the
// developer chooses, matching options.schema.test.js's existing convention.
//
// Right now STYLE_SCHEMA has zero "glowColor"/"paddingX"/"letterSpacing" (etc)
// entries, so the first assertion in each describe block below is expected to
// fail until the developer adds them to STYLE_SCHEMA.
// ---------------------------------------------------------------------------

const NEW_KEYS_TYPES = {
  glowColor: 'color',
  glowOpacity: 'opacity',
  glowBlur: 'px',
  glowSpread: 'px',
  paddingX: 'px',
  paddingY: 'px',
  letterSpacing: 'px',
};

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

/**
 * Appends a #style-preview container with one sample span per anki-<cat>
 * class, mirroring options.test.js's appendPreviewContainer (issue #46) and
 * options.text.test.js's local copy (issue #48) -- built here rather than
 * imported since it is test-only DOM scaffolding, not production logic.
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

describe('STYLE_SCHEMA declares the new glow/spacing entries (issue #49)', () => {
  it('T-49-011 STYLE_SCHEMA contains glowColor/glowOpacity/glowBlur/glowSpread/paddingX/paddingY/letterSpacing with the expected type per key, and loadStyleSettings generates a default control + one override control per category for each of them inside #style-controls', async () => {
    for (const [key, expectedType] of Object.entries(NEW_KEYS_TYPES)) {
      const entry = STYLE_SCHEMA.find((e) => e.key === key);
      expect(entry, `STYLE_SCHEMA must contain an entry for "${key}"`).toBeDefined();
      expect(entry.type, `STYLE_SCHEMA entry "${key}" must be type "${expectedType}"`).toBe(expectedType);
    }

    const { loadStyleSettings } = await import('./options.js');
    const doc = makeSchemaOptionsDoc();
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: STYLE_DEFAULTS.styleSettings });
    await loadStyleSettings(doc, storageGet);

    const container = doc.getElementById('style-controls');
    for (const key of Object.keys(NEW_KEYS_TYPES)) {
      const entry = STYLE_SCHEMA.find((e) => e.key === key);
      const globalEl = doc.getElementById(`global-${entry.id}`);
      expect(globalEl, `missing default control for "${key}" (#global-${entry.id})`).not.toBeNull();
      expect(container.contains(globalEl), `#global-${entry.id} must live inside #style-controls`).toBe(true);

      for (const cat of STYLE_CATEGORIES) {
        const overrideEl = doc.getElementById(`${cat}-${entry.id}`);
        const enabledEl = doc.getElementById(`${cat}-${entry.id}-enabled`);
        expect(overrideEl, `missing override control for "${key}"/"${cat}" (#${cat}-${entry.id})`).not.toBeNull();
        expect(enabledEl, `missing enable checkbox for "${key}"/"${cat}" (#${cat}-${entry.id}-enabled)`).not.toBeNull();
      }
    }
  });

  it('T-49-012 px-type glow/spacing entries declare the min/max range from the dev plan (glowBlur 0-30, glowSpread 0-20, paddingX/paddingY 0-12, letterSpacing 0-8), and the generated <input> carries those exact min/max attributes', async () => {
    const expectedRanges = {
      glowBlur: [0, 30],
      glowSpread: [0, 20],
      paddingX: [0, 12],
      paddingY: [0, 12],
      letterSpacing: [0, 8],
    };

    const { loadStyleSettings } = await import('./options.js');
    const doc = makeSchemaOptionsDoc();
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: STYLE_DEFAULTS.styleSettings });
    await loadStyleSettings(doc, storageGet);

    for (const [key, [min, max]] of Object.entries(expectedRanges)) {
      const entry = STYLE_SCHEMA.find((e) => e.key === key);
      expect(entry, `STYLE_SCHEMA must contain an entry for "${key}"`).toBeDefined();
      expect(entry.min, `STYLE_SCHEMA entry "${key}".min must be ${min}`).toBe(min);
      expect(entry.max, `STYLE_SCHEMA entry "${key}".max must be ${max}`).toBe(max);

      const globalEl = doc.getElementById(`global-${entry.id}`);
      expect(globalEl.min, `#global-${entry.id} must carry min="${min}"`).toBe(String(min));
      expect(globalEl.max, `#global-${entry.id} must carry max="${max}"`).toBe(String(max));
    }
  });
});

describe('per-category enable + value scoping for the new glow/spacing keys (issue #49, mirrors issue #48 AC-1/AC-2)', () => {
  it('T-49-013 enabling a per-category override for glowBlur includes ONLY that key with the entered value; leaving the checkbox unchecked omits the key from that category entirely (same enable/override contract as every existing control type)', async () => {
    const entry = STYLE_SCHEMA.find((e) => e.key === 'glowBlur');
    expect(entry, 'STYLE_SCHEMA must contain a "glowBlur" entry to override per category').toBeDefined();

    const { loadStyleSettings, currentStyleSettings } = await import('./options.js');
    const doc = makeSchemaOptionsDoc();
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: STYLE_DEFAULTS.styleSettings });
    await loadStyleSettings(doc, storageGet);

    const enabledEl = doc.getElementById(`learning-${entry.id}-enabled`);
    const valueEl = doc.getElementById(`learning-${entry.id}`);
    expect(enabledEl, `missing enable checkbox for "glowBlur"/"learning" (#learning-${entry.id}-enabled)`).not.toBeNull();
    expect(valueEl, `missing override control for "glowBlur"/"learning" (#learning-${entry.id})`).not.toBeNull();

    // Baseline: never enabled -> the key must be entirely absent (not just falsy).
    let result = currentStyleSettings(doc);
    expect(result.learning, '"learning" must not contain "glowBlur" while its checkbox is unchecked').not.toHaveProperty('glowBlur');

    // Enable + set a value -> included with exactly that value, and ONLY that
    // key (no other schema key leaks into "learning").
    enabledEl.checked = true;
    valueEl.value = '14';

    result = currentStyleSettings(doc);
    expect(result.learning.glowBlur).toBe(14);
    expect(Object.keys(result.learning)).toEqual(['glowBlur']);
  });
});

describe('renderPreview reflects the new glow/spacing properties (issue #49, extending issue #46/#48 AC-1/AC-2)', () => {
  it('T-49-014 checking a distinct letterSpacing value into the generated global control and calling renderPreview injects a CSS rule containing "letter-spacing: <n>px;" scoped to #style-preview -- the live preview reflects the new property with no storage round-trip', async () => {
    const entry = STYLE_SCHEMA.find((e) => e.key === 'letterSpacing');
    expect(entry, 'STYLE_SCHEMA must contain a "letterSpacing" entry to preview').toBeDefined();

    const { loadStyleSettings, renderPreview, currentStyleSettings } = await import('./options.js');
    const doc = makeSchemaOptionsDoc();
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: STYLE_DEFAULTS.styleSettings });
    await loadStyleSettings(doc, storageGet);
    appendPreviewContainer(doc);

    // Before entering a value, the preview must not claim any letter-spacing.
    renderPreview(doc);
    const styleElBefore = doc.getElementById('style-preview-styles');
    expect(styleElBefore, '#style-preview-styles must exist after the first renderPreview call').not.toBeNull();
    expect(styleElBefore.textContent).not.toContain('letter-spacing');

    // Simulate the user typing directly into the control (no storageSet call
    // anywhere in this test -- matches T-46-002/T-48-012's "no storage
    // round-trip" contract).
    const globalEl = doc.getElementById(`global-${entry.id}`);
    globalEl.value = '3';
    renderPreview(doc);

    const styleElAfter = doc.getElementById('style-preview-styles');
    expect(styleElAfter.textContent).toContain('letter-spacing: 3px;');
    expect(styleElAfter.textContent).toMatch(/#style-preview \.anki-unknown \{[^}]*letter-spacing: 3px;/);

    const settings = currentStyleSettings(doc);
    expect(settings.default.letterSpacing).toBe(3);
  });

  it('T-49-015 setting BOTH the global glowColor and glowBlur controls and calling renderPreview injects one composed "box-shadow" declaration (proving the two-control composition works live, not just each key in isolation)', async () => {
    const colorEntry = STYLE_SCHEMA.find((e) => e.key === 'glowColor');
    const blurEntry = STYLE_SCHEMA.find((e) => e.key === 'glowBlur');
    expect(colorEntry, 'STYLE_SCHEMA must contain a "glowColor" entry to preview').toBeDefined();
    expect(blurEntry, 'STYLE_SCHEMA must contain a "glowBlur" entry to preview').toBeDefined();

    const { loadStyleSettings, renderPreview } = await import('./options.js');
    const doc = makeSchemaOptionsDoc();
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: STYLE_DEFAULTS.styleSettings });
    await loadStyleSettings(doc, storageGet);
    appendPreviewContainer(doc);

    const colorEl = doc.getElementById(`global-${colorEntry.id}`);
    const blurEl = doc.getElementById(`global-${blurEntry.id}`);
    colorEl.value = '#ff8800';
    blurEl.value = '9';
    renderPreview(doc);

    const styleEl = doc.getElementById('style-preview-styles');
    expect(styleEl.textContent).toContain('box-shadow: 0 0 9px 0px rgba(255, 136, 0, 1);');
    expect(styleEl.textContent).toMatch(/#style-preview \.anki-unknown \{[^}]*box-shadow: 0 0 9px 0px rgba\(255, 136, 0, 1\);/);
  });
});
