import { describe, it, expect } from 'vitest';
import { BUILT_IN_STYLE_FALLBACK, hexToRgb, resolveCategory, buildStyleSheet } from './style-util.js';

// ---------------------------------------------------------------------------
// hexToRgb
// ---------------------------------------------------------------------------

describe('hexToRgb', () => {
  it('converts a 6-digit hex string to an { r, g, b } object', () => {
    // The CSS background and outline colours are stored as hex strings; they
    // must be decomposed into r/g/b components to build rgba() values in the
    // stylesheet.
    const result = hexToRgb('#dc4646');
    expect(result).toEqual({ r: 220, g: 70, b: 70 });
  });

  it('converts a 3-digit shorthand hex string to the correct { r, g, b } object', () => {
    // Users may enter shorthand hex colours (e.g. #f06 for #ff0066); the
    // function must expand each nibble to a full byte before converting.
    const result = hexToRgb('#f06');
    expect(result).toEqual({ r: 255, g: 0, b: 102 });
  });

  it('converts lowercase 6-digit hex correctly', () => {
    // Colour pickers commonly emit lowercase hex; case must not affect the
    // numeric result.
    const result = hexToRgb('#32aa50');
    expect(result).toEqual({ r: 50, g: 170, b: 80 });
  });

  it('converts an uppercase 6-digit hex correctly', () => {
    // Some inputs may be uppercase; the function must handle both cases.
    const result = hexToRgb('#E6AA1E');
    expect(result).toEqual({ r: 230, g: 170, b: 30 });
  });

  it('returns null for an invalid hex string', () => {
    // An invalid input must not cause a runtime error; returning null lets the
    // caller fall back gracefully rather than crashing stylesheet generation.
    expect(hexToRgb('not-a-color')).toBeNull();
  });

  it('returns null for an empty string', () => {
    // An empty string is not a valid colour; null signals the caller to use a
    // fallback value.
    expect(hexToRgb('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveCategory
// ---------------------------------------------------------------------------

describe('resolveCategory', () => {
  it('returns built-in fallback values when styleSettings is empty', () => {
    // When no user settings exist the extension must render the built-in
    // colour scheme so the page still highlights correctly out of the box
    // (acceptance criterion 1 -- no regression).
    const result = resolveCategory({}, 'unlearned');
    expect(result.backgroundColor).toBe(BUILT_IN_STYLE_FALLBACK.unlearned.backgroundColor);
    expect(result.backgroundOpacity).toBe(BUILT_IN_STYLE_FALLBACK.unlearned.backgroundOpacity);
    expect(result.outlineColor).toBe(BUILT_IN_STYLE_FALLBACK.unlearned.outlineColor);
  });

  it('returns built-in fallback for "learning" when styleSettings is empty', () => {
    // Each category must independently fall through to its own built-in values
    // so categories are not accidentally cross-contaminated.
    const result = resolveCategory({}, 'learning');
    expect(result.backgroundColor).toBe(BUILT_IN_STYLE_FALLBACK.learning.backgroundColor);
    expect(result.outlineColor).toBe(BUILT_IN_STYLE_FALLBACK.learning.outlineColor);
  });

  it('applies a global default background colour to all categories when no category override exists', () => {
    // A global default lets the user change one value and have it propagate
    // everywhere -- the key user-facing feature of the settings system
    // (acceptance criterion 2).
    const settings = { default: { backgroundColor: '#ffffff' }, unlearned: {}, learning: {}, learned: {} };
    const unlearned = resolveCategory(settings, 'unlearned');
    const learning  = resolveCategory(settings, 'learning');
    const learned   = resolveCategory(settings, 'learned');
    expect(unlearned.backgroundColor).toBe('#ffffff');
    expect(learning.backgroundColor).toBe('#ffffff');
    expect(learned.backgroundColor).toBe('#ffffff');
  });

  it('a category override takes precedence over the global default for that category', () => {
    // Per-category overrides exist precisely so one category can deviate from
    // the global default without affecting others (acceptance criterion 3).
    const settings = {
      default:   { backgroundColor: '#ffffff' },
      unlearned: { backgroundColor: '#ff0000' },
      learning:  {},
      learned:   {},
    };
    expect(resolveCategory(settings, 'unlearned').backgroundColor).toBe('#ff0000');
  });

  it('a category override does not affect other categories', () => {
    // Overriding "unlearned" must leave "learning" and "learned" using the
    // global default (acceptance criterion 3 -- only the targeted category
    // changes).
    const settings = {
      default:   { backgroundColor: '#ffffff' },
      unlearned: { backgroundColor: '#ff0000' },
      learning:  {},
      learned:   {},
    };
    expect(resolveCategory(settings, 'learning').backgroundColor).toBe('#ffffff');
    expect(resolveCategory(settings, 'learned').backgroundColor).toBe('#ffffff');
  });

  it('a blank category object inherits all values from the global default', () => {
    // An empty per-category object means "use whatever the global default
    // says" -- the merge must not leave any field undefined
    // (acceptance criterion 4).
    const settings = {
      default:   { backgroundColor: '#aabbcc', backgroundOpacity: 0.5, borderRadius: 5, outlineColor: '#aabbcc', outlineOpacity: 0.6, outlineWidth: 2 },
      unlearned: {},
      learning:  {},
      learned:   {},
    };
    const result = resolveCategory(settings, 'unlearned');
    expect(result.backgroundColor).toBe('#aabbcc');
    expect(result.backgroundOpacity).toBe(0.5);
    expect(result.borderRadius).toBe(5);
  });

  it('a blank global default inherits from built-in fallback for each field', () => {
    // When the user has not set a global default the built-in fallback is the
    // only source of truth -- no field should be undefined or null
    // (acceptance criterion 4).
    const settings = { default: {}, unlearned: {}, learning: {}, learned: {} };
    const result = resolveCategory(settings, 'learned');
    expect(result.backgroundColor).toBe(BUILT_IN_STYLE_FALLBACK.learned.backgroundColor);
    expect(result.borderRadius).toBe(BUILT_IN_STYLE_FALLBACK.learned.borderRadius);
  });

  it('returns borderRadius 0 when explicitly set to zero in global default', () => {
    // Zero is a valid and meaningful value (sharp corners); falsy-check merges
    // must not accidentally replace it with the built-in fallback
    // (acceptance criterion 5).
    const settings = { default: { borderRadius: 0 }, unlearned: {}, learning: {}, learned: {} };
    expect(resolveCategory(settings, 'unlearned').borderRadius).toBe(0);
  });

  it('returns borderRadius 0 when set to zero in a category override', () => {
    // Same zero-value guard but at the per-category level -- the override
    // layer must also preserve 0 without treating it as absent.
    const settings = { default: { borderRadius: 3 }, unlearned: { borderRadius: 0 }, learning: {}, learned: {} };
    expect(resolveCategory(settings, 'unlearned').borderRadius).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildStyleSheet
// ---------------------------------------------------------------------------

describe('buildStyleSheet', () => {
  it('returns a string containing a rule for .anki-unlearned', () => {
    // The stylesheet must include all three status classes so the DOM classes
    // added by scanPage() are actually styled (acceptance criterion 7).
    const css = buildStyleSheet({});
    expect(typeof css).toBe('string');
    expect(css).toContain('.anki-unlearned');
  });

  it('returns a string containing a rule for .anki-learning', () => {
    // .anki-learning must also be present in the output.
    const css = buildStyleSheet({});
    expect(css).toContain('.anki-learning');
  });

  it('returns a string containing a rule for .anki-learned', () => {
    // .anki-learned must also be present in the output.
    const css = buildStyleSheet({});
    expect(css).toContain('.anki-learned');
  });

  it('produces built-in fallback colour for .anki-unlearned when no settings are provided', () => {
    // With no user customisation the generated CSS must embed the built-in
    // fallback colours so the page looks correct immediately after install
    // (acceptance criterion 1).
    const css = buildStyleSheet({});
    // Built-in unlearned background is #dc4646 -> r=220, g=70, b=70
    expect(css).toContain('220');
    expect(css).toContain('70');
  });

  it('uses a global default background colour in all three class rules', () => {
    // A global default override must appear in every class rule, not just one
    // (acceptance criterion 2).
    const settings = { default: { backgroundColor: '#112233' }, unlearned: {}, learning: {}, learned: {} };
    const css = buildStyleSheet(settings);
    // #112233 -> r=17, g=34, b=51
    expect(css).toContain('17');
    expect(css).toContain('34');
    expect(css).toContain('51');
    expect(css).toContain('.anki-unlearned');
    expect(css).toContain('.anki-learning');
    expect(css).toContain('.anki-learned');
  });

  it('uses per-category background override only in the targeted class rule', () => {
    // A category override must be scoped to its class, not leak into others
    // (acceptance criterion 3).
    const settings = {
      default:   { backgroundColor: '#ffffff' },
      unlearned: { backgroundColor: '#ff0000' },
      learning:  {},
      learned:   {},
    };
    const css = buildStyleSheet(settings);
    const unlearnedBlock = css.slice(css.indexOf('.anki-unlearned'), css.indexOf('.anki-learning'));
    const learningBlock  = css.slice(css.indexOf('.anki-learning'),  css.indexOf('.anki-learned'));
    // #ff0000 -> 255, 0, 0 must appear in unlearned block
    expect(unlearnedBlock).toContain('255');
    // learning block must NOT use the unlearned override colour
    expect(learningBlock).not.toContain('rgba(255, 0, 0');
  });

  it('renders borderRadius 0 as "border-radius: 0px" in the CSS output', () => {
    // Zero border-radius means sharp corners; the property must be emitted as
    // "0px" rather than omitted, since omitting it leaves the browser default
    // in place (acceptance criterion 5).
    const settings = { default: { borderRadius: 0 }, unlearned: {}, learning: {}, learned: {} };
    const css = buildStyleSheet(settings);
    expect(css).toMatch(/border-radius:\s*0px/);
  });

  it('renders a non-zero borderRadius as "border-radius: Npx" in the CSS output', () => {
    // borderRadius is stored as a raw pixel number; the stylesheet builder
    // must append the "px" unit so the CSS is valid.
    const settings = { default: { borderRadius: 6 }, unlearned: {}, learning: {}, learned: {} };
    const css = buildStyleSheet(settings);
    expect(css).toMatch(/border-radius:\s*6px/);
  });

  it('does not contain any class selectors other than the three status classes', () => {
    // The stylesheet must be scoped to exactly the three status selectors so
    // it cannot accidentally style unrelated page elements
    // (acceptance criterion 7).
    const css = buildStyleSheet({});
    const classMatches = css.match(/\.[a-z-]+\s*\{/g) || [];
    const selectors = classMatches.map((m) => m.replace(/\s*\{/, '').trim());
    expect(selectors.sort()).toEqual(['.anki-learned', '.anki-learning', '.anki-unlearned']);
  });

  it('produces rgba() expressions that embed the opacity value', () => {
    // Opacity is encoded inside rgba() rather than as a separate CSS property
    // so that the highlight does not obscure the page text behind it.
    const settings = { default: { backgroundColor: '#ff0000', backgroundOpacity: 0.5 }, unlearned: {}, learning: {}, learned: {} };
    const css = buildStyleSheet(settings);
    expect(css).toMatch(/rgba\(255,\s*0,\s*0,\s*0\.5\)/);
  });
});
