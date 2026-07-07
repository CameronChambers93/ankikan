import { describe, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { STYLE_DEFAULTS, STYLE_SCHEMA, STYLE_PRESETS } from './style-util.js';

// ---------------------------------------------------------------------------
// Issue #47 — Style presets + progressive disclosure (options-page wiring)
//
// Contract this spec locks down (owned by QA per the issue #47 brief, to be
// implemented in options.js):
//
//   - loadStyleSettings(doc, storageGet) additionally populates a `<select
//     id="style-preset">` with one <option value="<key>">label</option> per
//     STYLE_PRESETS entry (insertion order) plus a trailing
//     <option value="custom">Custom</option>, and syncs its selected value to
//     matchPreset(...) (or "custom") based on the loaded settings.
//   - onPresetChange(doc, storageSet, messageFn) reads #style-preset, applies
//     the preset over the current settings, writes the merged values back
//     into the generated inputs, and persists via the same
//     { styleSettings } / { action: 'refreshStyles', styleSettings } contract
//     as onStyleChange.
//   - onStyleChange(doc, storageSet, messageFn) (existing, issue #45) is
//     extended to also re-sync #style-preset after every persist, so a manual
//     edit that no longer matches any preset flips the picker to "Custom".
//   - #style-controls sub-groups its generated controls under STYLE_SCHEMA[].group
//     headings via a `[data-style-group="<group>"]` container per group, so
//     categories are reachable in logical sections rather than one long list
//     (AC-4).
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

describe('#style-preset population (issue #47 AC-1)', () => {
  it('T-47-010 loadStyleSettings populates #style-preset with one <option> per STYLE_PRESETS entry, in insertion order, plus a trailing Custom option', async () => {
    // The picker must offer exactly the two shipped presets (soft-fill,
    // outline-box) in their declared order, plus a Custom sentinel so the
    // picker always has a value even when settings don't match any preset.
    const { loadStyleSettings } = await import('./options.js');
    const doc = makeDoc();
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: STYLE_DEFAULTS.styleSettings });
    await loadStyleSettings(doc, storageGet);

    const select = doc.getElementById('style-preset');
    expect(select, '#style-preset must exist').not.toBeNull();

    const options = Array.from(select.options);
    const expectedValues = [...Object.keys(STYLE_PRESETS), 'custom'];
    expect(options.map((o) => o.value)).toEqual(expectedValues);

    for (const [key, preset] of Object.entries(STYLE_PRESETS)) {
      const opt = options.find((o) => o.value === key);
      expect(opt, `missing <option> for preset "${key}"`).toBeDefined();
      expect(opt.textContent).toBe(preset.label);
    }
    expect(options[options.length - 1].value).toBe('custom');
    expect(options[options.length - 1].textContent).toBe('Custom');
  });
});

describe('onPresetChange (issue #47 AC-1)', () => {
  it('T-47-011 selecting a preset and calling onPresetChange persists the merged settings via storageSet and messageFn, preserving unrelated default keys', async () => {
    // Selecting "Soft fill" must write backgroundOpacity/outlineWidth from the
    // preset while keeping every other default key (e.g. backgroundColor) as
    // it was, then push the merged object through the exact same persistence
    // contract as a manual edit (AC-1).
    const { loadStyleSettings, onPresetChange } = await import('./options.js');
    const doc = makeDoc();
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: STYLE_DEFAULTS.styleSettings });
    await loadStyleSettings(doc, storageGet);

    doc.getElementById('style-preset').value = 'soft-fill';
    const storageSet = vi.fn().mockResolvedValue(undefined);
    const messageFn = vi.fn();
    await onPresetChange(doc, storageSet, messageFn);

    expect(storageSet).toHaveBeenCalledOnce();
    const { styleSettings } = storageSet.mock.calls[0][0];
    expect(styleSettings.default.backgroundOpacity).toBe(STYLE_PRESETS['soft-fill'].settings.default.backgroundOpacity);
    expect(styleSettings.default.outlineWidth).toBe(STYLE_PRESETS['soft-fill'].settings.default.outlineWidth);
    expect(styleSettings.default.backgroundColor).toBe(STYLE_DEFAULTS.styleSettings.default.backgroundColor);

    expect(messageFn).toHaveBeenCalledOnce();
    expect(messageFn.mock.calls[0][0]).toEqual({ action: 'refreshStyles', styleSettings });

    // The generated advanced inputs must reflect the merged values too, so a
    // subsequent manual edit builds on top of the preset rather than stale DOM.
    expect(Number(doc.getElementById('global-bg-opacity').value)).toBe(STYLE_PRESETS['soft-fill'].settings.default.backgroundOpacity);
    expect(Number(doc.getElementById('global-outline-width').value)).toBe(STYLE_PRESETS['soft-fill'].settings.default.outlineWidth);
  });
});

describe('#style-controls grouping (issue #47 AC-4)', () => {
  it('T-47-012 the generated #style-controls sub-groups the default controls under their STYLE_SCHEMA group (Fill/Shape/Border)', async () => {
    // AC-4: categories/properties must be reachable in logical sections, not
    // one 60-input scroll. This asserts each group has its own labelled
    // container and that every schema entry's global control lives inside the
    // container matching its declared `group`.
    const { loadStyleSettings } = await import('./options.js');
    const doc = makeDoc();
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: STYLE_DEFAULTS.styleSettings });
    await loadStyleSettings(doc, storageGet);

    const groupLabels = { fill: 'Fill', shape: 'Shape', border: 'Border' };
    for (const [group, label] of Object.entries(groupLabels)) {
      const groupEl = doc.querySelector(`[data-style-group="${group}"]`);
      expect(groupEl, `missing group container for "${group}" (expected [data-style-group="${group}"])`).not.toBeNull();
      expect(groupEl.textContent).toContain(label);

      const entriesInGroup = STYLE_SCHEMA.filter((e) => e.group === group);
      expect(entriesInGroup.length, `STYLE_SCHEMA must declare at least one entry for group "${group}"`).toBeGreaterThan(0);
      for (const entry of entriesInGroup) {
        const input = doc.getElementById(`global-${entry.id}`);
        expect(input, `#global-${entry.id} must exist`).not.toBeNull();
        expect(groupEl.contains(input), `#global-${entry.id} must live inside the "${group}" group container`).toBe(true);
      }
    }
  });
});

describe('#style-preset sync on load (issue #47 AC-3)', () => {
  it('T-47-013 loadStyleSettings selects the matching preset in #style-preset when stored default settings equal a preset, and selects "custom" when they do not', async () => {
    // Reopening the options page must show which preset (if any) is currently
    // active, so the user isn't left staring at "Custom" for settings they
    // picked from the dropdown last time.
    const { loadStyleSettings } = await import('./options.js');

    const docMatch = makeDoc();
    const matchingStored = {
      ...STYLE_DEFAULTS.styleSettings,
      default: { ...STYLE_DEFAULTS.styleSettings.default, ...STYLE_PRESETS['outline-box'].settings.default },
    };
    await loadStyleSettings(docMatch, vi.fn().mockResolvedValue({ styleSettings: matchingStored }));
    expect(docMatch.getElementById('style-preset').value).toBe('outline-box');

    const docCustom = makeDoc();
    const customStored = {
      ...STYLE_DEFAULTS.styleSettings,
      default: { ...STYLE_DEFAULTS.styleSettings.default, backgroundOpacity: 0.77, outlineWidth: 3 },
    };
    await loadStyleSettings(docCustom, vi.fn().mockResolvedValue({ styleSettings: customStored }));
    expect(docCustom.getElementById('style-preset').value).toBe('custom');
  });
});

describe('manual edit after preset selection (issue #47 AC-3)', () => {
  it('T-47-014 editing an advanced control after selecting a preset flips #style-preset to "custom" and the edited value persists in currentStyleSettings', async () => {
    // Presets and manual edits must interoperate: choosing a preset is just a
    // convenient starting point, not a locked mode. The moment the user tweaks
    // an advanced control by hand, the picker must honestly reflect that the
    // settings are no longer exactly the preset ("Custom"), and the edit must
    // not be discarded.
    const { loadStyleSettings, onPresetChange, onStyleChange, currentStyleSettings } = await import('./options.js');
    const doc = makeDoc();
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: STYLE_DEFAULTS.styleSettings });
    await loadStyleSettings(doc, storageGet);

    doc.getElementById('style-preset').value = 'soft-fill';
    await onPresetChange(doc, vi.fn().mockResolvedValue(undefined), vi.fn());
    expect(doc.getElementById('style-preset').value).toBe('soft-fill');

    // Manually edit an advanced control (borderRadius, untouched by soft-fill),
    // simulating the real input-change listener firing onStyleChange.
    doc.getElementById('global-border-radius').value = '11';
    const storageSet = vi.fn().mockResolvedValue(undefined);
    await onStyleChange(doc, storageSet, vi.fn());

    expect(doc.getElementById('style-preset').value).toBe('custom');
    const result = currentStyleSettings(doc);
    expect(result.default.borderRadius).toBe(11);
    // The preset's own contribution must also still be present -- editing one
    // advanced field must not wipe out the rest of the preset's values.
    expect(result.default.backgroundOpacity).toBe(STYLE_PRESETS['soft-fill'].settings.default.backgroundOpacity);
  });
});
