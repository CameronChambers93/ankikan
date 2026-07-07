import { describe, it, expect } from 'vitest';
import {
  STYLE_DEFAULTS,
  STYLE_PRESETS,
  applyPreset,
  matchPreset,
  resolveCategory,
} from './style-util.js';

// ---------------------------------------------------------------------------
// Issue #47 — Style presets + progressive disclosure
//
// Only two presets ship in this issue: 'soft-fill' (flat translucent fill, no
// outline) and 'outline-box' (transparent fill, visible outline). Both are
// buildable purely from the 6-key STYLE_SCHEMA introduced in issue #45 — no
// new schema properties are needed. Selecting a preset must only touch the
// `default` layer; any per-category overrides the user has already set must
// survive untouched (AC-3 interoperability between presets and manual edits).
// ---------------------------------------------------------------------------

describe('applyPreset', () => {
  it('T-47-001 applyPreset merges the preset default layer over current.default, preserving unrelated default keys and untouched per-category overrides', () => {
    // The preset must win on the keys it declares (backgroundOpacity, outlineWidth
    // for soft-fill) but must not clobber other default keys (backgroundColor here)
    // or any pre-existing per-category override (AC-1 + AC-3).
    const current = {
      default: { ...STYLE_DEFAULTS.styleSettings.default, backgroundColor: '#123456' },
      unlearned: { borderRadius: 9 },
      learning: {},
      learned: {},
      unknown: {},
    };

    const result = applyPreset(current, 'soft-fill');

    expect(result.default.backgroundOpacity).toBe(STYLE_PRESETS['soft-fill'].settings.default.backgroundOpacity);
    expect(result.default.outlineWidth).toBe(STYLE_PRESETS['soft-fill'].settings.default.outlineWidth);
    // unrelated default key from the caller's current settings must be preserved,
    // not reset to STYLE_DEFAULTS or clobbered by the preset.
    expect(result.default.backgroundColor).toBe('#123456');
    // per-category overrides must pass through completely unchanged.
    expect(result.unlearned).toEqual({ borderRadius: 9 });
    expect(result.learning).toEqual({});
    expect(result.learned).toEqual({});
  });

  it('T-47-004 applyPreset returns the current styleSettings unchanged for an unrecognised preset name or the literal "custom"', () => {
    // Edge/failure path: an unknown key (typo, stale option value) or the
    // sentinel "custom" value must be a safe no-op rather than throwing or
    // silently corrupting the user's settings.
    const current = {
      default: { ...STYLE_DEFAULTS.styleSettings.default, backgroundColor: '#abcdef' },
      unlearned: { borderRadius: 9 },
      learning: {},
      learned: {},
      unknown: {},
    };

    expect(applyPreset(current, 'does-not-exist')).toEqual(current);
    expect(applyPreset(current, 'custom')).toEqual(current);
  });
});

describe('resolveCategory after applyPreset', () => {
  it('T-47-002 a category with no per-category overrides resolves to the preset\'s default values after applyPreset (outline-box)', () => {
    // This is the actual rendering path (buildStyleSheet -> resolveCategory), so
    // it must reflect the preset's values for every category that inherits from
    // "default" -- proving the preset actually changes what gets drawn, not just
    // the stored object shape.
    const result = applyPreset(STYLE_DEFAULTS.styleSettings, 'outline-box');
    const resolved = resolveCategory(result, 'learning'); // "learning" has no overrides in STYLE_DEFAULTS

    expect(resolved.backgroundOpacity).toBe(STYLE_PRESETS['outline-box'].settings.default.backgroundOpacity);
    expect(resolved.outlineWidth).toBe(STYLE_PRESETS['outline-box'].settings.default.outlineWidth);
    expect(resolved.outlineOpacity).toBe(STYLE_PRESETS['outline-box'].settings.default.outlineOpacity);
  });
});

describe('matchPreset', () => {
  it('T-47-003 matchPreset returns the preset key whose default settings equal styleSettings.default, and null when no preset matches (Custom)', () => {
    // Drives the options-page picker's "which preset is currently active" state
    // (AC-3): every preset must round-trip through applyPreset -> matchPreset,
    // and an arbitrary manual combination must report null (i.e. "Custom").
    const soft = applyPreset(STYLE_DEFAULTS.styleSettings, 'soft-fill');
    expect(matchPreset(soft)).toBe('soft-fill');

    const outline = applyPreset(STYLE_DEFAULTS.styleSettings, 'outline-box');
    expect(matchPreset(outline)).toBe('outline-box');

    const custom = {
      ...STYLE_DEFAULTS.styleSettings,
      default: { ...STYLE_DEFAULTS.styleSettings.default, backgroundOpacity: 0.9, outlineWidth: 5 },
    };
    expect(matchPreset(custom)).toBeNull();
  });
});

describe('STYLE_PRESETS shape', () => {
  it('T-47-005 STYLE_PRESETS declares exactly soft-fill and outline-box, in that display order, each with a label and a settings.default object', () => {
    // Locks the issue #47 scope decision: only these two presets ship now;
    // underline/bold/wavy/glow are explicitly deferred and must not appear.
    const keys = Object.keys(STYLE_PRESETS);
    expect(keys).toEqual(['soft-fill', 'outline-box']);
    for (const key of keys) {
      const preset = STYLE_PRESETS[key];
      expect(typeof preset.label).toBe('string');
      expect(preset.label.length).toBeGreaterThan(0);
      expect(typeof preset.settings.default).toBe('object');
    }
  });
});
