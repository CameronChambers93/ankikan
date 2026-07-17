import { describe, it, expect } from 'vitest';
import {
  STYLE_DEFAULTS,
  STYLE_CATEGORIES,
  buildStyleSheet,
} from './style-util.js';

// ---------------------------------------------------------------------------
// Issue #49 — Highlight styling: glow/shadow + spacing properties
//
// Adds seven new style properties to the CSS emitter:
//   - glowColor + glowOpacity + glowBlur + glowSpread compose into ONE
//     "box-shadow" declaration (box-shadow: 0 0 <blur>px <spread>px rgba(...)),
//     emitted only when glowColor is set AND (glowBlur or glowSpread) > 0.
//   - paddingX / paddingY compose into ONE "padding" declaration
//     (padding: <y>px <x>px) plus "box-decoration-break: clone" (and its
//     -webkit- prefix), emitted whenever either is > 0.
//   - letterSpacing -> "letter-spacing: <n>px", emitted only when > 0.
//
// None of these keys exist on STYLE_SCHEMA yet (that's the developer's job for
// this issue), so -- following the established style-util.text.test.js
// (issue #48) pattern -- these tests build style objects directly with the new
// keys and drive buildStyleSheet, the single CSS-generation entry point, to
// lock the emitted declarations before any options-page UI exists for them.
//
// Defaults MUST stay byte-identical to the issue #48 golden output (see
// style-util.text.test.js T-48-006, itself copied from #45's T-45-001/002):
// none of the new properties may appear, or alter spacing, when absent
// (T-49-005).
// ---------------------------------------------------------------------------

/**
 * Returns the single-line rule for one category within a buildStyleSheet-shaped
 * CSS string (one `.anki-<cat> { … }` line per category, newline-joined).
 */
function extractRule(css, cat) {
  const line = css.split('\n').find((l) => l.startsWith(`.anki-${cat} `));
  if (line === undefined) throw new Error(`no rule found for category "${cat}" in:\n${css}`);
  return line;
}

/**
 * True if `rule` contains a top-level CSS declaration whose property name is
 * exactly `prop` (not merely a substring match).
 */
function hasDeclaration(rule, prop) {
  return rule.split(';').some((d) => d.trim().startsWith(`${prop}:`));
}

/** Extracts the raw value string of a top-level declaration named `prop`, or undefined. */
function declarationValue(rule, prop) {
  const decl = rule.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${prop}:`));
  return decl ? decl.slice(prop.length + 1).trim() : undefined;
}

describe('glow/shadow CSS emission (issue #49)', () => {
  it('T-49-001 glowColor + glowBlur: 8 (glowOpacity explicit) composes "box-shadow: 0 0 8px 0px rgba(r, g, b, opacity);" in every .anki-* rule; glow absent emits no box-shadow at all', () => {
    // The "default" layer has no per-category override, so every category
    // inherits it (same merge order as every other property -- see
    // resolveCategory) and must render the same composed declaration. Spread
    // defaults to 0 and must still render explicitly as "0px" (not omitted).
    const withGlow = buildStyleSheet({
      default: { ...STYLE_DEFAULTS.styleSettings.default, glowColor: '#112233', glowOpacity: 0.6, glowBlur: 8 },
    });
    for (const cat of STYLE_CATEGORIES) {
      const rule = extractRule(withGlow, cat);
      expect(hasDeclaration(rule, 'box-shadow'), `.anki-${cat} must have a "box-shadow" declaration`).toBe(true);
      expect(declarationValue(rule, 'box-shadow')).toBe('0 0 8px 0px rgba(17, 34, 51, 0.6)');
    }

    const withoutGlow = buildStyleSheet(STYLE_DEFAULTS.styleSettings);
    for (const cat of STYLE_CATEGORIES) {
      const rule = extractRule(withoutGlow, cat);
      expect(hasDeclaration(rule, 'box-shadow'), `.anki-${cat} must NOT have a "box-shadow" declaration when glow is unset`).toBe(false);
    }
  });

  it('T-49-002 glowSpread contributes to the composed box-shadow spread radius (independently of glowBlur), rendering both blur and spread px values verbatim', () => {
    const css = buildStyleSheet({
      default: { ...STYLE_DEFAULTS.styleSettings.default, glowColor: '#00ff00', glowOpacity: 1, glowBlur: 3, glowSpread: 6 },
    });
    for (const cat of STYLE_CATEGORIES) {
      const rule = extractRule(css, cat);
      expect(declarationValue(rule, 'box-shadow')).toBe('0 0 3px 6px rgba(0, 255, 0, 1)');
    }
  });

  it('T-49-006 failure path: glowBlur/glowSpread set but glowColor absent emits no box-shadow at all -- a colour is required to compose a shadow', () => {
    const css = buildStyleSheet({
      default: { ...STYLE_DEFAULTS.styleSettings.default, glowBlur: 10, glowSpread: 5, glowOpacity: 0.5 },
    });
    for (const cat of STYLE_CATEGORIES) {
      const rule = extractRule(css, cat);
      expect(hasDeclaration(rule, 'box-shadow'), `.anki-${cat} must NOT have "box-shadow" without a glowColor`).toBe(false);
    }
  });

  it('T-49-007 failure path: glowColor set but glowBlur AND glowSpread are both 0 (or both absent) emits no box-shadow -- per the dev plan, glow is omitted "otherwise"', () => {
    const bothZero = buildStyleSheet({
      default: { ...STYLE_DEFAULTS.styleSettings.default, glowColor: '#ff00ff', glowOpacity: 0.8, glowBlur: 0, glowSpread: 0 },
    });
    const bothAbsent = buildStyleSheet({
      default: { ...STYLE_DEFAULTS.styleSettings.default, glowColor: '#ff00ff', glowOpacity: 0.8 },
    });
    for (const css of [bothZero, bothAbsent]) {
      for (const cat of STYLE_CATEGORIES) {
        const rule = extractRule(css, cat);
        expect(hasDeclaration(rule, 'box-shadow'), `.anki-${cat} must NOT have "box-shadow" when blur and spread are both 0/absent`).toBe(false);
      }
    }
  });

  it('T-49-010 glowOpacity omitted (glowColor + glowBlur only) still composes a box-shadow, defaulting the alpha channel to fully opaque (1)', () => {
    // The dev plan pairs glowOpacity with glowColor but does not specify a
    // fallback when only glowColor/glowBlur are set -- a fully-opaque default
    // (alpha 1) is the least surprising choice, matching how an unset alpha
    // channel is conventionally treated as opaque rather than invisible.
    const css = buildStyleSheet({
      default: { ...STYLE_DEFAULTS.styleSettings.default, glowColor: '#010203', glowBlur: 4 },
    });
    for (const cat of STYLE_CATEGORIES) {
      const rule = extractRule(css, cat);
      expect(hasDeclaration(rule, 'box-shadow'), `.anki-${cat} must have "box-shadow" even without an explicit glowOpacity`).toBe(true);
      expect(declarationValue(rule, 'box-shadow')).toBe('0 0 4px 0px rgba(1, 2, 3, 1)');
    }
  });
});

describe('padding CSS emission (issue #49)', () => {
  it('T-49-003 paddingX: 4, paddingY: 2 composes "padding: 2px 4px;" AND emits "box-decoration-break: clone;" (plus its -webkit- prefix) for correct inline-wrap rendering; both 0 emits neither declaration', () => {
    const withPadding = buildStyleSheet({
      default: { ...STYLE_DEFAULTS.styleSettings.default, paddingX: 4, paddingY: 2 },
    });
    for (const cat of STYLE_CATEGORIES) {
      const rule = extractRule(withPadding, cat);
      expect(hasDeclaration(rule, 'padding'), `.anki-${cat} must have a "padding" declaration`).toBe(true);
      expect(declarationValue(rule, 'padding')).toBe('2px 4px');
      expect(hasDeclaration(rule, 'box-decoration-break'), `.anki-${cat} must have "box-decoration-break" alongside padding`).toBe(true);
      expect(declarationValue(rule, 'box-decoration-break')).toBe('clone');
      expect(hasDeclaration(rule, '-webkit-box-decoration-break'), `.anki-${cat} must have the -webkit- prefixed box-decoration-break too`).toBe(true);
      expect(declarationValue(rule, '-webkit-box-decoration-break')).toBe('clone');
    }

    const withoutPadding = buildStyleSheet({
      default: { ...STYLE_DEFAULTS.styleSettings.default, paddingX: 0, paddingY: 0 },
    });
    const withAbsent = buildStyleSheet(STYLE_DEFAULTS.styleSettings);
    for (const css of [withoutPadding, withAbsent]) {
      for (const cat of STYLE_CATEGORIES) {
        const rule = extractRule(css, cat);
        expect(hasDeclaration(rule, 'padding'), `.anki-${cat} must NOT have "padding" when both paddingX and paddingY are 0/absent`).toBe(false);
        expect(hasDeclaration(rule, 'box-decoration-break'), `.anki-${cat} must NOT have "box-decoration-break" without any padding`).toBe(false);
      }
    }
  });

  it('T-49-009 paddingX alone (paddingY 0/absent) still emits "padding: 0px <x>px;" with box-decoration-break -- either dimension being > 0 triggers the declaration', () => {
    const css = buildStyleSheet({
      default: { ...STYLE_DEFAULTS.styleSettings.default, paddingX: 5 },
    });
    for (const cat of STYLE_CATEGORIES) {
      const rule = extractRule(css, cat);
      expect(hasDeclaration(rule, 'padding')).toBe(true);
      expect(declarationValue(rule, 'padding')).toBe('0px 5px');
      expect(hasDeclaration(rule, 'box-decoration-break')).toBe(true);
    }
  });
});

describe('letterSpacing CSS emission (issue #49)', () => {
  it('T-49-004 letterSpacing: 2 emits "letter-spacing: 2px;"; 0 or absent emits no "letter-spacing" declaration', () => {
    const withSpacing = buildStyleSheet({
      default: { ...STYLE_DEFAULTS.styleSettings.default, letterSpacing: 2 },
    });
    for (const cat of STYLE_CATEGORIES) {
      const rule = extractRule(withSpacing, cat);
      expect(hasDeclaration(rule, 'letter-spacing'), `.anki-${cat} must have "letter-spacing"`).toBe(true);
      expect(declarationValue(rule, 'letter-spacing')).toBe('2px');
    }

    const withZero = buildStyleSheet({
      default: { ...STYLE_DEFAULTS.styleSettings.default, letterSpacing: 0 },
    });
    const withAbsent = buildStyleSheet(STYLE_DEFAULTS.styleSettings);
    for (const css of [withZero, withAbsent]) {
      for (const cat of STYLE_CATEGORIES) {
        const rule = extractRule(css, cat);
        expect(hasDeclaration(rule, 'letter-spacing'), `.anki-${cat} must NOT have "letter-spacing" when 0/absent`).toBe(false);
      }
    }
  });
});

describe('per-category override of a new glow/spacing property (issue #49)', () => {
  it('T-49-008 overriding glowColor + glowBlur on a single category ("learning") only adds "box-shadow" to that category\'s rule, leaving every sibling category with no box-shadow at all', () => {
    // Mirrors T-45-003 / T-48-005's proof that arbitrary properties are
    // overridable per category (resolveCategory's generic merge), applied to
    // an issue #49 key.
    const settings = {
      default: STYLE_DEFAULTS.styleSettings.default,
      learning: { glowColor: '#abcdef', glowOpacity: 0.4, glowBlur: 12 },
    };
    const css = buildStyleSheet(settings);

    const learningRule = extractRule(css, 'learning');
    expect(hasDeclaration(learningRule, 'box-shadow')).toBe(true);
    expect(declarationValue(learningRule, 'box-shadow')).toBe('0 0 12px 0px rgba(171, 205, 239, 0.4)');

    for (const cat of STYLE_CATEGORIES.filter((c) => c !== 'learning')) {
      const rule = extractRule(css, cat);
      expect(hasDeclaration(rule, 'box-shadow'), `.anki-${cat} must not inherit "learning"'s glow override`).toBe(false);
    }
  });
});

describe('regression: default output unchanged by the new schema keys (issue #49)', () => {
  it('T-49-005 buildStyleSheet(STYLE_DEFAULTS.styleSettings) and buildStyleSheet(null) still match the exact pre-issue-#49 golden CSS strings byte-for-byte', () => {
    // The golden strings are copied verbatim from style-util.text.test.js
    // T-48-006 (itself copied from issue #45's T-45-001/T-45-002), captured
    // BEFORE any issue #49 implementation exists. If the new "effects" or
    // "spacing" group renderers ever concatenate an empty string into the
    // declaration list with an extra join separator (a classic "add a group,
    // forget to filter empties" bug), this test catches the stray whitespace
    // even though no individual declaration changed.
    const withDefaults = buildStyleSheet(STYLE_DEFAULTS.styleSettings);
    const expectedWithDefaults = [
      '.anki-unknown { background-color: rgba(128, 128, 128, 0.22); border-radius: 3px; outline: 1px solid rgba(128, 128, 128, 0.35); }',
      '.anki-unlearned { background-color: rgba(128, 128, 128, 0.22); border-radius: 3px; outline: 1px solid rgba(128, 128, 128, 0.35); }',
      '.anki-learning { background-color: rgba(128, 128, 128, 0.22); border-radius: 3px; outline: 1px solid rgba(128, 128, 128, 0.35); }',
      '.anki-learned { background-color: rgba(128, 128, 128, 0.22); border-radius: 3px; outline: 1px solid rgba(128, 128, 128, 0.35); }',
    ].join('\n');
    expect(withDefaults).toBe(expectedWithDefaults);

    const withFallback = buildStyleSheet(null);
    const expectedWithFallback = [
      '.anki-unknown { background-color: rgba(128, 128, 128, 0.22); border-radius: 3px; outline: 1px solid rgba(128, 128, 128, 0.35); }',
      '.anki-unlearned { background-color: rgba(220, 70, 70, 0.22); border-radius: 3px; outline: 1px solid rgba(220, 70, 70, 0.35); }',
      '.anki-learning { background-color: rgba(230, 170, 30, 0.22); border-radius: 3px; outline: 1px solid rgba(230, 170, 30, 0.4); }',
      '.anki-learned { background-color: rgba(50, 170, 80, 0.22); border-radius: 3px; outline: 1px solid rgba(50, 170, 80, 0.35); }',
    ].join('\n');
    expect(withFallback).toBe(expectedWithFallback);
  });
});
