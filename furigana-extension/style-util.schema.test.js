import { describe, it, expect } from 'vitest';
import {
  STYLE_DEFAULTS,
  buildStyleSheet,
  hexToRgb,
} from './style-util.js';

// ---------------------------------------------------------------------------
// Issue #45 — Schema-driven style engine
//
// These specs lock the CSS output of buildStyleSheet() byte-for-byte across
// the schema-driven refactor (AC-1), and assert the existence/shape of the
// new STYLE_SCHEMA / STYLE_CATEGORIES data structures that make the refactor
// possible (AC-3). The golden strings below were captured from `buildStyleSheet`
// on `main` before the refactor — any deviation is a behaviour regression.
// ---------------------------------------------------------------------------

describe('buildStyleSheet golden output (issue #45 AC-1)', () => {
  it('T-45-001 buildStyleSheet(STYLE_DEFAULTS.styleSettings) matches the exact pre-refactor CSS string', () => {
    // STYLE_DEFAULTS.styleSettings has real values only in "default"; every
    // category inherits from it, so all four rules render the same grey.
    // This is the primary byte-identical guard for the refactor.
    const css = buildStyleSheet(STYLE_DEFAULTS.styleSettings);
    const expected = [
      '.anki-unknown { background-color: rgba(128, 128, 128, 0.22); border-radius: 3px; outline: 1px solid rgba(128, 128, 128, 0.35); }',
      '.anki-unlearned { background-color: rgba(128, 128, 128, 0.22); border-radius: 3px; outline: 1px solid rgba(128, 128, 128, 0.35); }',
      '.anki-learning { background-color: rgba(128, 128, 128, 0.22); border-radius: 3px; outline: 1px solid rgba(128, 128, 128, 0.35); }',
      '.anki-learned { background-color: rgba(128, 128, 128, 0.22); border-radius: 3px; outline: 1px solid rgba(128, 128, 128, 0.35); }',
    ].join('\n');
    expect(css).toBe(expected);
  });

  it('T-45-002 buildStyleSheet(null) and buildStyleSheet(undefined) both match the exact built-in fallback CSS string', () => {
    // With no user settings at all, each category must render its own
    // BUILT_IN_STYLE_FALLBACK colour (grey/red/amber/green). 0.40 must render
    // as "0.4" (no trailing zero) -- a common float-to-string regression.
    const expected = [
      '.anki-unknown { background-color: rgba(128, 128, 128, 0.22); border-radius: 3px; outline: 1px solid rgba(128, 128, 128, 0.35); }',
      '.anki-unlearned { background-color: rgba(220, 70, 70, 0.22); border-radius: 3px; outline: 1px solid rgba(220, 70, 70, 0.35); }',
      '.anki-learning { background-color: rgba(230, 170, 30, 0.22); border-radius: 3px; outline: 1px solid rgba(230, 170, 30, 0.4); }',
      '.anki-learned { background-color: rgba(50, 170, 80, 0.22); border-radius: 3px; outline: 1px solid rgba(50, 170, 80, 0.35); }',
    ].join('\n');
    expect(buildStyleSheet(null)).toBe(expected);
    expect(buildStyleSheet(undefined)).toBe(expected);
  });

  it('T-45-003 a per-category override of a non-colour property (borderRadius) is emitted correctly, proving the generalised override path', () => {
    // Before issue #45 only backgroundColor/backgroundOpacity were overridable
    // per category in the UI; this test exercises the underlying merge logic
    // (resolveCategory) with borderRadius to prove buildStyleSheet already
    // supports arbitrary property overrides -- the schema-driven UI just needs
    // to expose it.
    const settings = {
      default: STYLE_DEFAULTS.styleSettings.default,
      learning: { borderRadius: 8 },
    };
    const css = buildStyleSheet(settings);
    const expected = [
      '.anki-unknown { background-color: rgba(128, 128, 128, 0.22); border-radius: 3px; outline: 1px solid rgba(128, 128, 128, 0.35); }',
      '.anki-unlearned { background-color: rgba(128, 128, 128, 0.22); border-radius: 3px; outline: 1px solid rgba(128, 128, 128, 0.35); }',
      '.anki-learning { background-color: rgba(128, 128, 128, 0.22); border-radius: 8px; outline: 1px solid rgba(128, 128, 128, 0.35); }',
      '.anki-learned { background-color: rgba(128, 128, 128, 0.22); border-radius: 3px; outline: 1px solid rgba(128, 128, 128, 0.35); }',
    ].join('\n');
    expect(css).toBe(expected);
  });

  it('T-45-004 an invalid backgroundColor hex still renders "background-color: transparent" for that rule (hexToRgb failure path preserved)', () => {
    // hexToRgb returns null for unparsable input; buildStyleSheet must keep
    // falling back to the literal string "transparent" rather than emitting a
    // broken rgba() or crashing, across the schema-driven rewrite.
    expect(hexToRgb('not-a-hex')).toBeNull();
    const settings = {
      default: { ...STYLE_DEFAULTS.styleSettings.default, backgroundColor: 'not-a-hex' },
    };
    const css = buildStyleSheet(settings);
    const unknownBlock = css.slice(css.indexOf('.anki-unknown'), css.indexOf('.anki-unlearned'));
    expect(unknownBlock).toContain('background-color: transparent;');
  });
});

describe('STYLE_SCHEMA / STYLE_CATEGORIES (issue #45 AC-3)', () => {
  it('T-45-005 STYLE_SCHEMA is an array with key/type/group entries for all 6 style properties, and STYLE_CATEGORIES matches the four status categories in render order', async () => {
    // AC-3: adding a hypothetical property should require only a STYLE_SCHEMA
    // entry. This guards the schema exists, is array-shaped, declares each of
    // today's 6 properties exactly once, and that STYLE_CATEGORIES is the
    // single source of truth for category iteration order (unknown, unlearned,
    // learning, learned -- matching the current buildStyleSheet L118 order).
    const mod = await import('./style-util.js');
    const { STYLE_SCHEMA, STYLE_CATEGORIES } = mod;

    expect(Array.isArray(STYLE_SCHEMA), 'STYLE_SCHEMA must be exported as an array').toBe(true);

    const expectedKeys = [
      'backgroundColor',
      'backgroundOpacity',
      'borderRadius',
      'outlineColor',
      'outlineOpacity',
      'outlineWidth',
    ];
    const actualKeys = STYLE_SCHEMA.map((entry) => entry.key);
    for (const key of expectedKeys) {
      expect(actualKeys, `STYLE_SCHEMA must contain an entry for "${key}"`).toContain(key);
    }
    expect(actualKeys.length, 'STYLE_SCHEMA must declare each of the 6 keys exactly once').toBe(expectedKeys.length);

    for (const entry of STYLE_SCHEMA) {
      expect(entry, `STYLE_SCHEMA entry for "${entry.key}" must have a "key"`).toHaveProperty('key');
      expect(entry, `STYLE_SCHEMA entry for "${entry.key}" must have a "type"`).toHaveProperty('type');
      expect(entry, `STYLE_SCHEMA entry for "${entry.key}" must have a "group"`).toHaveProperty('group');
    }

    expect(Array.isArray(STYLE_CATEGORIES), 'STYLE_CATEGORIES must be exported as an array').toBe(true);
    expect(STYLE_CATEGORIES).toEqual(['unknown', 'unlearned', 'learning', 'learned']);
  });
});
