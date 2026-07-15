import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { STYLE_DEFAULTS, STYLE_SCHEMA, STYLE_CATEGORIES } from './style-util.js';

// ---------------------------------------------------------------------------
// Issue #45 — Schema-driven options UI
//
// Before this issue, options.html hand-wrote one <input> per property/category
// pair, and only backgroundColor + backgroundOpacity were per-category
// overridable. These specs assert the options page instead generates its
// controls from STYLE_SCHEMA so every property is overridable for every
// category, and that the generated DOM ids for the pre-existing 6 keys are
// unchanged (regression guard for the existing e2e selectors).
//
// Contract assumed here (per plans/issue-45-plan.md §4): loadStyleSettings(doc,
// storageGet) both GENERATES the controls into #style-controls (if not already
// present) and populates their values from storage. Ids follow
// `global-<schemaEntry.id>` for the default group and
// `<category>-<schemaEntry.id>` / `<category>-<schemaEntry.id>-enabled` for
// per-category overrides, where `schemaEntry.id` is the short id fragment declared
// on each STYLE_SCHEMA entry (e.g. 'bg-color' for backgroundColor).
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

// A representative distinct value per schema key, keyed by property key so
// tests can drive every generated input without hard-coding DOM ids.
const DISTINCT_VALUES = {
  backgroundColor: '#123456',
  backgroundOpacity: 0.11,
  borderRadius: 9,
  outlineColor: '#654321',
  outlineOpacity: 0.66,
  outlineWidth: 4,
};

describe('schema-driven #style-controls generation (issue #45 AC-2)', () => {
  it('T-45-010 loadStyleSettings generates one default control per STYLE_SCHEMA entry and one override control + -enabled checkbox per category x entry inside #style-controls', async () => {
    // AC-2: every one of the 6 properties must be both a global default control
    // and a per-category override control (with its own enable checkbox), for
    // all 4 categories -- not just backgroundColor/backgroundOpacity as before.
    const { loadStyleSettings } = await import('./options.js');
    const doc = makeSchemaOptionsDoc();
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: STYLE_DEFAULTS.styleSettings });
    await loadStyleSettings(doc, storageGet);

    const container = doc.getElementById('style-controls');
    expect(container, '#style-controls must exist').not.toBeNull();

    for (const entry of STYLE_SCHEMA) {
      const globalEl = doc.getElementById(`global-${entry.id}`);
      expect(globalEl, `missing default control for "${entry.key}" (#global-${entry.id})`).not.toBeNull();
      expect(container.contains(globalEl), `#global-${entry.id} must live inside #style-controls`).toBe(true);

      for (const cat of STYLE_CATEGORIES) {
        const overrideEl = doc.getElementById(`${cat}-${entry.id}`);
        const enabledEl = doc.getElementById(`${cat}-${entry.id}-enabled`);
        expect(overrideEl, `missing override control for "${entry.key}"/"${cat}" (#${cat}-${entry.id})`).not.toBeNull();
        expect(enabledEl, `missing enable checkbox for "${entry.key}"/"${cat}" (#${cat}-${entry.id}-enabled)`).not.toBeNull();
        expect(enabledEl.type, `#${cat}-${entry.id}-enabled must be a checkbox`).toBe('checkbox');
        expect(container.contains(overrideEl), `#${cat}-${entry.id} must live inside #style-controls`).toBe(true);
      }
    }
  });
});

describe('currentStyleSettings round-trips every schema property (issue #45 AC-2)', () => {
  it('T-45-011 setting each generated default input to a distinct value and reading back via currentStyleSettings returns exactly those values', async () => {
    // The "default" object returned by currentStyleSettings must reflect ALL 6
    // schema properties, not just the 3 that were previously wired
    // (backgroundColor, backgroundOpacity, borderRadius, outlineColor,
    // outlineOpacity, outlineWidth already existed as globals -- this proves the
    // schema-driven read path covers every one of them uniformly).
    const { loadStyleSettings, currentStyleSettings } = await import('./options.js');
    const doc = makeSchemaOptionsDoc();
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: STYLE_DEFAULTS.styleSettings });
    await loadStyleSettings(doc, storageGet);

    for (const entry of STYLE_SCHEMA) {
      const el = doc.getElementById(`global-${entry.id}`);
      const value = DISTINCT_VALUES[entry.key];
      expect(value, `no test fixture value defined for schema key "${entry.key}"`).toBeDefined();
      el.value = String(value);
    }

    const result = currentStyleSettings(doc);
    for (const entry of STYLE_SCHEMA) {
      expect(result.default[entry.key]).toBe(DISTINCT_VALUES[entry.key]);
    }
  });

  it('T-45-012 enabling a per-category override for a non-background property (learned/outlineWidth) includes ONLY that key in the category object; unchecked keys are omitted', async () => {
    // Before issue #45 there was no way to override outlineWidth per category at
    // all. This proves the generalised enable/override mechanism scopes strictly
    // to the one property that was checked, leaving every other property for
    // "learned" to inherit from the global default (i.e. absent from the object).
    const outlineWidthEntry = STYLE_SCHEMA.find((e) => e.key === 'outlineWidth');
    expect(outlineWidthEntry, 'STYLE_SCHEMA must contain an "outlineWidth" entry').toBeDefined();

    const { loadStyleSettings, currentStyleSettings } = await import('./options.js');
    const doc = makeSchemaOptionsDoc();
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: STYLE_DEFAULTS.styleSettings });
    await loadStyleSettings(doc, storageGet);

    const enabledEl = doc.getElementById(`learned-${outlineWidthEntry.id}-enabled`);
    const valueEl = doc.getElementById(`learned-${outlineWidthEntry.id}`);
    enabledEl.checked = true;
    valueEl.value = '5';

    const result = currentStyleSettings(doc);
    expect(result.learned).toEqual({ outlineWidth: 5 });
  });
});

describe('resetOptionsToDefaults restores every schema property (issue #45 AC-2)', () => {
  it('T-45-013 resetOptionsToDefaults unchecks every generated -enabled checkbox (for all categories x schema entries) and restores every default input to STYLE_DEFAULTS.styleSettings.default', async () => {
    // A full reset must reach every property/category pair generated from the
    // schema, not just the historically-wired backgroundColor/backgroundOpacity
    // checkboxes -- otherwise a user who had overridden e.g. unknown/outlineWidth
    // would still see a stale override after clicking "Reset to defaults".
    const { loadStyleSettings, resetOptionsToDefaults, currentStyleSettings } = await import('./options.js');
    const doc = makeSchemaOptionsDoc();

    // Seed storage with a non-default global value and a non-bg per-category
    // override on a category/property pair that never had UI before issue #45.
    const stored = {
      default: { ...STYLE_DEFAULTS.styleSettings.default, borderRadius: 12 },
      unknown: {},
      unlearned: {},
      learning: {},
      learned: { outlineWidth: 5 },
    };
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: stored });
    await loadStyleSettings(doc, storageGet);
    expect(doc.getElementById('learned-outline-width-enabled')?.checked ?? true).toBe(true);

    const storageSet = vi.fn().mockResolvedValue(undefined);
    await resetOptionsToDefaults(doc, storageSet, vi.fn());

    for (const entry of STYLE_SCHEMA) {
      const el = doc.getElementById(`global-${entry.id}`);
      expect(Number(el.value) || el.value).toEqual(
        Number(STYLE_DEFAULTS.styleSettings.default[entry.key]) || STYLE_DEFAULTS.styleSettings.default[entry.key]
      );
      for (const cat of STYLE_CATEGORIES) {
        const enabledEl = doc.getElementById(`${cat}-${entry.id}-enabled`);
        expect(enabledEl.checked, `#${cat}-${entry.id}-enabled must be unchecked after reset`).toBe(false);
      }
    }

    // The persisted result must have no leftover per-category overrides either.
    const finalSettings = currentStyleSettings(doc);
    for (const cat of STYLE_CATEGORIES) {
      expect(finalSettings[cat]).toEqual({});
    }
  });
});

describe('generated ids match the legacy DOM contract (issue #45 AC-2, regression guard)', () => {
  it('T-45-014 STYLE_SCHEMA id fragments and generated DOM ids equal the pre-refactor ids for the existing 6 keys (global-bg-color, unlearned-bg-color, unlearned-bg-color-enabled, ...)', async () => {
    // Existing Playwright e2e specs (options-styles.e2e.js, popup-styles.e2e.js,
    // unknown-category.e2e.js, options-swatch-defaults.e2e.js) select elements by
    // these exact legacy ids. If the schema-driven generator renames them the
    // refactor silently breaks e2e even though this Vitest suite would stay green
    // -- so this test locks the id contract directly.
    const legacyIdFragment = {
      backgroundColor: 'bg-color',
      backgroundOpacity: 'bg-opacity',
      borderRadius: 'border-radius',
      outlineColor: 'outline-color',
      outlineOpacity: 'outline-opacity',
      outlineWidth: 'outline-width',
    };
    for (const [key, idFragment] of Object.entries(legacyIdFragment)) {
      const entry = STYLE_SCHEMA.find((e) => e.key === key);
      expect(entry, `STYLE_SCHEMA must contain an entry for "${key}"`).toBeDefined();
      expect(entry.id, `STYLE_SCHEMA entry "${key}" must declare id "${idFragment}" to preserve legacy DOM ids`).toBe(idFragment);
    }

    const { loadStyleSettings } = await import('./options.js');
    const doc = makeSchemaOptionsDoc();
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: STYLE_DEFAULTS.styleSettings });
    await loadStyleSettings(doc, storageGet);

    // Literal legacy ids that must resolve exactly, independent of the schema
    // lookup above -- this is what the e2e specs actually query for.
    expect(doc.getElementById('global-bg-color'), '#global-bg-color must exist').not.toBeNull();
    expect(doc.getElementById('global-bg-opacity'), '#global-bg-opacity must exist').not.toBeNull();
    expect(doc.getElementById('global-border-radius'), '#global-border-radius must exist').not.toBeNull();
    expect(doc.getElementById('global-outline-color'), '#global-outline-color must exist').not.toBeNull();
    expect(doc.getElementById('global-outline-opacity'), '#global-outline-opacity must exist').not.toBeNull();
    expect(doc.getElementById('global-outline-width'), '#global-outline-width must exist').not.toBeNull();
    expect(doc.getElementById('unlearned-bg-color'), '#unlearned-bg-color must exist').not.toBeNull();
    expect(doc.getElementById('unlearned-bg-color-enabled'), '#unlearned-bg-color-enabled must exist').not.toBeNull();
  });
});
