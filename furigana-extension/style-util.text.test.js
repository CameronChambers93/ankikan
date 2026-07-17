import { describe, it, expect } from 'vitest';
import {
  STYLE_DEFAULTS,
  STYLE_CATEGORIES,
  buildStyleSheet,
} from './style-util.js';

// ---------------------------------------------------------------------------
// Issue #48 — Highlight styling: text styling + underline properties
//
// Adds four new style properties to the CSS emitter: textColor (-> color),
// fontWeight (-> font-weight: bold when exactly true), textDecorationStyle
// (-> text-decoration-line/style, "underline" reader-style wavy/dotted/etc.)
// and textDecorationColor (-> text-decoration-color, only meaningful while a
// decoration style is active). None of these keys exist on STYLE_SCHEMA yet
// (that's the developer's job for this issue) so these tests build style
// objects directly with the new keys and drive buildStyleSheet -- the single
// CSS-generation entry point -- to lock the emitted declarations before any
// options-page UI exists for them.
//
// Defaults MUST stay byte-identical to the issue #45 golden output (see
// style-util.schema.test.js T-45-001/T-45-002): none of the new properties
// may appear, or alter spacing, when absent (T-48-006).
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
 * exactly `prop` (not merely a substring match -- "color:" must not match
 * inside "background-color:"). Declarations are the `;`-separated tokens
 * inside the braces.
 */
function hasDeclaration(rule, prop) {
  return rule.split(';').some((d) => d.trim().startsWith(`${prop}:`));
}

/** Extracts the raw value string of a top-level declaration named `prop`, or undefined. */
function declarationValue(rule, prop) {
  const decl = rule.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${prop}:`));
  return decl ? decl.slice(prop.length + 1).trim() : undefined;
}

describe('textColor CSS emission (issue #48)', () => {
  it('T-48-001 buildStyleSheet with default: { textColor } emits a "color" declaration with that hex value in every .anki-* rule', () => {
    // textColor has no per-category override here, so every category inherits
    // it from the "default" layer (same merge order as every other property --
    // see resolveCategory) and must render the same "color" declaration.
    const settings = {
      default: { ...STYLE_DEFAULTS.styleSettings.default, textColor: '#112233' },
    };
    const css = buildStyleSheet(settings);
    for (const cat of STYLE_CATEGORIES) {
      const rule = extractRule(css, cat);
      expect(hasDeclaration(rule, 'color'), `.anki-${cat} must have a "color" declaration`).toBe(true);
      expect(declarationValue(rule, 'color')).toBe('#112233');
    }
  });
});

describe('fontWeight CSS emission (issue #48)', () => {
  it('T-48-002 fontWeight: true emits "font-weight: bold"; fontWeight absent or false emits no "font-weight" declaration at all', () => {
    const withBold = buildStyleSheet({
      default: { ...STYLE_DEFAULTS.styleSettings.default, fontWeight: true },
    });
    for (const cat of STYLE_CATEGORIES) {
      const rule = extractRule(withBold, cat);
      expect(hasDeclaration(rule, 'font-weight'), `.anki-${cat} must have a "font-weight" declaration`).toBe(true);
      expect(declarationValue(rule, 'font-weight')).toBe('bold');
    }

    const withFalse = buildStyleSheet({
      default: { ...STYLE_DEFAULTS.styleSettings.default, fontWeight: false },
    });
    const withAbsent = buildStyleSheet(STYLE_DEFAULTS.styleSettings);
    for (const css of [withFalse, withAbsent]) {
      for (const cat of STYLE_CATEGORIES) {
        const rule = extractRule(css, cat);
        expect(hasDeclaration(rule, 'font-weight'), `.anki-${cat} must NOT have a "font-weight" declaration`).toBe(false);
      }
    }
  });
});

describe('textDecorationStyle CSS emission (issue #48)', () => {
  it('T-48-003 textDecorationStyle: "wavy" emits "text-decoration-line: underline;" and "text-decoration-style: wavy;"; "none" or absent emits neither declaration', () => {
    const wavy = buildStyleSheet({
      default: { ...STYLE_DEFAULTS.styleSettings.default, textDecorationStyle: 'wavy' },
    });
    for (const cat of STYLE_CATEGORIES) {
      const rule = extractRule(wavy, cat);
      expect(hasDeclaration(rule, 'text-decoration-line'), `.anki-${cat} must have "text-decoration-line"`).toBe(true);
      expect(declarationValue(rule, 'text-decoration-line')).toBe('underline');
      expect(hasDeclaration(rule, 'text-decoration-style'), `.anki-${cat} must have "text-decoration-style"`).toBe(true);
      expect(declarationValue(rule, 'text-decoration-style')).toBe('wavy');
    }

    const none = buildStyleSheet({
      default: { ...STYLE_DEFAULTS.styleSettings.default, textDecorationStyle: 'none' },
    });
    const absent = buildStyleSheet(STYLE_DEFAULTS.styleSettings);
    for (const css of [none, absent]) {
      for (const cat of STYLE_CATEGORIES) {
        const rule = extractRule(css, cat);
        expect(hasDeclaration(rule, 'text-decoration-line'), `.anki-${cat} must NOT have "text-decoration-line"`).toBe(false);
        expect(hasDeclaration(rule, 'text-decoration-style'), `.anki-${cat} must NOT have "text-decoration-style"`).toBe(false);
      }
    }
  });
});

describe('textDecorationColor CSS emission (issue #48)', () => {
  it('T-48-004 textDecorationColor set (alongside an active textDecorationStyle) emits "text-decoration-color"; leaving it unset omits the declaration while the underline itself still renders', () => {
    const withColor = buildStyleSheet({
      default: {
        ...STYLE_DEFAULTS.styleSettings.default,
        textDecorationStyle: 'dotted',
        textDecorationColor: '#ff00ff',
      },
    });
    const withoutColor = buildStyleSheet({
      default: { ...STYLE_DEFAULTS.styleSettings.default, textDecorationStyle: 'dotted' },
    });

    for (const cat of STYLE_CATEGORIES) {
      const withColorRule = extractRule(withColor, cat);
      expect(hasDeclaration(withColorRule, 'text-decoration-color'), `.anki-${cat} must have "text-decoration-color"`).toBe(true);
      expect(declarationValue(withColorRule, 'text-decoration-color')).toBe('#ff00ff');
      // The underline itself must still be present regardless of the colour override.
      expect(hasDeclaration(withColorRule, 'text-decoration-style')).toBe(true);

      const withoutColorRule = extractRule(withoutColor, cat);
      expect(hasDeclaration(withoutColorRule, 'text-decoration-color'), `.anki-${cat} must NOT have "text-decoration-color" when textDecorationColor is unset`).toBe(false);
      expect(hasDeclaration(withoutColorRule, 'text-decoration-style'), `.anki-${cat} underline must still render without a colour override`).toBe(true);
    }
  });
});

describe('per-category override of a new text property (issue #48)', () => {
  it('T-48-005 overriding textDecorationStyle on a single category ("learning") only adds the decoration declarations to that category\'s rule, leaving every sibling category with no decoration at all', () => {
    // Mirrors T-45-003's proof that arbitrary properties are overridable per
    // category (resolveCategory's generic merge), applied to a issue #48 key.
    const settings = {
      default: STYLE_DEFAULTS.styleSettings.default,
      learning: { textDecorationStyle: 'dashed' },
    };
    const css = buildStyleSheet(settings);

    const learningRule = extractRule(css, 'learning');
    expect(hasDeclaration(learningRule, 'text-decoration-line')).toBe(true);
    expect(hasDeclaration(learningRule, 'text-decoration-style')).toBe(true);
    expect(declarationValue(learningRule, 'text-decoration-style')).toBe('dashed');

    for (const cat of STYLE_CATEGORIES.filter((c) => c !== 'learning')) {
      const rule = extractRule(css, cat);
      expect(hasDeclaration(rule, 'text-decoration-line'), `.anki-${cat} must not inherit "learning"'s override`).toBe(false);
      expect(hasDeclaration(rule, 'text-decoration-style'), `.anki-${cat} must not inherit "learning"'s override`).toBe(false);
    }
  });
});

describe('regression: default output unchanged by the new schema keys (issue #48)', () => {
  it('T-48-006 buildStyleSheet(STYLE_DEFAULTS.styleSettings) and buildStyleSheet(null) still match the exact pre-issue-#48 golden CSS strings byte-for-byte', () => {
    // The golden strings are copied verbatim from style-util.schema.test.js
    // T-45-001/T-45-002. If the new "text" group renderer ever concatenates an
    // empty string into the declaration list with an extra join separator (a
    // classic "add a group, forget to filter empties" bug), this test catches
    // the stray whitespace even though no individual declaration changed.
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

describe('edge case: textDecorationColor without an active decoration style (issue #48)', () => {
  it('T-48-007 setting textDecorationColor while textDecorationStyle is absent (or explicitly "none") omits ALL decoration declarations, including text-decoration-color', () => {
    // "Omit all decoration declarations when style is none/absent" (per the
    // dev plan) must apply to text-decoration-color too, not just line/style --
    // otherwise a stray "text-decoration-color" with no "text-decoration-line"
    // is inert-but-leaked CSS and a state a naive per-property emitter could
    // produce by handling textDecorationColor independently of textDecorationStyle.
    const absentStyle = buildStyleSheet({
      default: { ...STYLE_DEFAULTS.styleSettings.default, textDecorationColor: '#ff00ff' },
    });
    const noneStyle = buildStyleSheet({
      default: { ...STYLE_DEFAULTS.styleSettings.default, textDecorationStyle: 'none', textDecorationColor: '#ff00ff' },
    });
    for (const css of [absentStyle, noneStyle]) {
      for (const cat of STYLE_CATEGORIES) {
        const rule = extractRule(css, cat);
        expect(hasDeclaration(rule, 'text-decoration-line'), `.anki-${cat} must not have "text-decoration-line"`).toBe(false);
        expect(hasDeclaration(rule, 'text-decoration-style'), `.anki-${cat} must not have "text-decoration-style"`).toBe(false);
        expect(hasDeclaration(rule, 'text-decoration-color'), `.anki-${cat} must not have "text-decoration-color"`).toBe(false);
      }
    }
  });
});

describe('failure path: fontWeight requires strict boolean true (issue #48)', () => {
  it('T-48-008 fontWeight set to a truthy-but-not-strictly-true value (the string "bold", or the number 1) does NOT emit font-weight -- the dev plan specifies "fontWeight === true", not a generic truthy check', () => {
    // Locks the exact-equality contract from the plan ("fontWeight === true →
    // font-weight: bold; (omit when false/absent)"). A common bug here is
    // implementing `if (s.fontWeight)` instead, which would incorrectly treat
    // any truthy stored value (e.g. a stray string from a future schema change,
    // or bad migration data) as "bold".
    for (const truthyNonTrue of ['bold', 1, 'true']) {
      const css = buildStyleSheet({
        default: { ...STYLE_DEFAULTS.styleSettings.default, fontWeight: truthyNonTrue },
      });
      for (const cat of STYLE_CATEGORIES) {
        const rule = extractRule(css, cat);
        expect(
          hasDeclaration(rule, 'font-weight'),
          `.anki-${cat} must NOT have "font-weight" for fontWeight === ${JSON.stringify(truthyNonTrue)}`
        ).toBe(false);
      }
    }
  });
});
