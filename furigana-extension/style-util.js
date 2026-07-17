/**
 * Default storage shape for user style settings.
 * Empty per-category objects mean "inherit from global default".
 */
export const STYLE_DEFAULTS = {
  styleSettings: {
    default: {
      backgroundColor: '#808080',
      backgroundOpacity: 0.22,
      borderRadius: 3,
      outlineColor: '#808080',
      outlineOpacity: 0.35,
      outlineWidth: 1,
    },
    unlearned: {},
    learning: {},
    learned: {},
    unknown: {},
  },
};

/** Default visual style for each Anki status category used when no user overrides are set. */
export const BUILT_IN_STYLE_FALLBACK = {
  unlearned: { backgroundColor: '#dc4646', backgroundOpacity: 0.22, borderRadius: 3, outlineColor: '#dc4646', outlineOpacity: 0.35, outlineWidth: 1 },
  learning:  { backgroundColor: '#e6aa1e', backgroundOpacity: 0.22, borderRadius: 3, outlineColor: '#e6aa1e', outlineOpacity: 0.40, outlineWidth: 1 },
  learned:   { backgroundColor: '#32aa50', backgroundOpacity: 0.22, borderRadius: 3, outlineColor: '#32aa50', outlineOpacity: 0.35, outlineWidth: 1 },
  unknown:   { backgroundColor: '#808080', backgroundOpacity: 0.22, borderRadius: 3, outlineColor: '#808080', outlineOpacity: 0.35, outlineWidth: 1 },
};

/**
 * Single source of truth for the six per-category highlight style properties.
 * Drives both the generated CSS (buildStyleSheet, grouped by `group`) and the
 * generated options-page controls (options.js, keyed by `id`). Adding a new
 * property only requires a new entry here.
 */
export const STYLE_SCHEMA = [
  { key: 'backgroundColor',      id: 'bg-color',        type: 'color',   group: 'fill' },
  { key: 'backgroundOpacity',    id: 'bg-opacity',       type: 'opacity', group: 'fill',   pairsWith: 'backgroundColor' },
  { key: 'borderRadius',         id: 'border-radius',    type: 'px',      group: 'shape',  min: 0, max: 20 },
  { key: 'outlineColor',         id: 'outline-color',    type: 'color',   group: 'border' },
  { key: 'outlineOpacity',       id: 'outline-opacity',  type: 'opacity', group: 'border', pairsWith: 'outlineColor' },
  { key: 'outlineWidth',         id: 'outline-width',    type: 'px',      group: 'border', min: 0, max: 6 },
  { key: 'textColor',            id: 'text-color',       type: 'color',   group: 'text' },
  { key: 'fontWeight',           id: 'font-weight',      type: 'bool',    group: 'text' },
  { key: 'textDecorationStyle',  id: 'underline-style',  type: 'enum',    group: 'text', options: ['none', 'solid', 'dotted', 'dashed', 'wavy'] },
  { key: 'textDecorationColor',  id: 'underline-color',  type: 'color',   group: 'text' },
];

/** Anki status categories, in the exact order buildStyleSheet renders their CSS rules. */
export const STYLE_CATEGORIES = ['unknown', 'unlearned', 'learning', 'learned'];

/**
 * Named shortcuts for the `default` layer of styleSettings, offered on the
 * options page as a quick "just pick a look" alternative to the full
 * schema-driven advanced controls.
 */
export const STYLE_PRESETS = {
  'soft-fill':   { label: 'Soft fill',   settings: { default: { backgroundOpacity: 0.22, outlineWidth: 0 } } },
  'outline-box': { label: 'Outline box', settings: { default: { backgroundOpacity: 0, outlineWidth: 2, outlineOpacity: 0.8 } } },
};

/**
 * Merges a named preset's `default` layer over `current.default`, preserving
 * every other `default` key and passing per-category overrides through
 * unchanged. Returns `current` unchanged for an unrecognised preset name or
 * the literal `'custom'` sentinel.
 *
 * @param {object} current - The current styleSettings object.
 * @param {string} presetName - A STYLE_PRESETS key, or 'custom'.
 * @returns {object} A new styleSettings object with the preset applied.
 */
export function applyPreset(current, presetName) {
  const preset = STYLE_PRESETS[presetName];
  if (presetName === 'custom' || !preset) return current;
  return {
    ...current,
    default: { ...current.default, ...preset.settings.default },
  };
}

/**
 * Returns the STYLE_PRESETS key that fully explains `styleSettings.default`:
 * every key the preset declares must equal its preset value, and every other
 * STYLE_SCHEMA key must still equal its STYLE_DEFAULTS value (i.e. untouched
 * by the preset). Schema keys with no canonical value in either the preset or
 * STYLE_DEFAULTS (e.g. the issue #48 text-group properties, which are
 * intentionally absent from STYLE_DEFAULTS) are outside any preset's concern
 * and never disqualify a match. Returns `null` if no preset matches (i.e. the
 * settings are "Custom").
 *
 * @param {object} styleSettings
 * @returns {string|null}
 */
export function matchPreset(styleSettings) {
  for (const [key, preset] of Object.entries(STYLE_PRESETS)) {
    const presetDefaults = preset.settings.default;
    const matches = STYLE_SCHEMA.every((entry) => {
      if (!(entry.key in presetDefaults) && !(entry.key in STYLE_DEFAULTS.styleSettings.default)) {
        return true;
      }
      const expected = entry.key in presetDefaults
        ? presetDefaults[entry.key]
        : STYLE_DEFAULTS.styleSettings.default[entry.key];
      return styleSettings.default[entry.key] === expected;
    });
    if (matches) return key;
  }
  return null;
}

/**
 * Renders the CSS declaration(s) for one STYLE_SCHEMA `group`, given a fully
 * resolved style object for a category (see resolveCategory). Each group maps
 * to exactly one declaration in the rendered `.anki-<cat>` rule.
 */
const CSS_GROUP_RENDERERS = {
  fill: (s) => {
    const bg = hexToRgb(s.backgroundColor);
    const bgColor = bg ? `rgba(${bg.r}, ${bg.g}, ${bg.b}, ${s.backgroundOpacity})` : 'transparent';
    return `background-color: ${bgColor};`;
  },
  shape: (s) => `border-radius: ${s.borderRadius}px;`,
  border: (s) => {
    const ol = hexToRgb(s.outlineColor);
    const olColor = ol ? `rgba(${ol.r}, ${ol.g}, ${ol.b}, ${s.outlineOpacity})` : 'transparent';
    return `outline: ${s.outlineWidth}px solid ${olColor};`;
  },
  text: (s) => {
    const parts = [];
    if (s.textColor) parts.push(`color: ${s.textColor};`);
    if (s.fontWeight === true) parts.push('font-weight: bold;');
    if (s.textDecorationStyle && s.textDecorationStyle !== 'none') {
      parts.push('text-decoration-line: underline;');
      parts.push(`text-decoration-style: ${s.textDecorationStyle};`);
      if (s.textDecorationColor) parts.push(`text-decoration-color: ${s.textDecorationColor};`);
    }
    return parts.join(' ');
  },
};

/** Declaration order within a `.anki-<cat> { … }` rule, matching the pre-refactor output. */
const CSS_GROUP_ORDER = ['fill', 'shape', 'border', 'text'];

/**
 * Parses a 3- or 6-digit CSS hex color string into `{r, g, b}` integer components.
 * Returns `null` for any input that isn't a valid hex color.
 */
export function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const short = hex.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
    };
  }
  const full = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (full) {
    return {
      r: parseInt(full[1], 16),
      g: parseInt(full[2], 16),
      b: parseInt(full[3], 16),
    };
  }
  return null;
}

/**
 * Merges built-in defaults with optional user overrides for one status category.
 * Layer order (last wins): built-in fallback → `styleSettings.default` → `styleSettings[category]`.
 *
 * @param {object|null} styleSettings - User style configuration object, or null/undefined to use defaults.
 * @param {'unlearned'|'learning'|'learned'} category - The Anki status category to resolve.
 * @returns {object} Resolved style properties for the category.
 */
export function resolveCategory(styleSettings, category) {
  const catOverride = styleSettings?.[category] ?? {};
  const hasCatKeys = Object.keys(catOverride).length > 0;
  return {
    ...(hasCatKeys ? {} : BUILT_IN_STYLE_FALLBACK[category]),
    ...(styleSettings?.default ?? {}),
    ...catOverride,
  };
}

/**
 * Generates a CSS string with background-color, border-radius, and outline rules for
 * `.anki-unlearned`, `.anki-learning`, and `.anki-learned` based on the given style settings.
 *
 * @param {object|null} styleSettings - User style overrides; null/undefined uses built-in defaults.
 * @returns {string} A multi-line CSS rule block ready to be inserted into a `<style>` element.
 */
/**
 * Merges stored user settings over STYLE_DEFAULTS, falling back to defaults when
 * storage is unavailable or returns a non-object.
 *
 * @param {object|null|undefined} stored - Value returned from chrome.storage.local.
 * @returns {object} A full styleSettings object safe to pass to buildStyleSheet.
 */
export function resolveStyleSettings(stored) {
  if (!stored || typeof stored !== 'object') return STYLE_DEFAULTS.styleSettings;
  const hasDefaultKeys = stored.default && Object.keys(stored.default).length > 0;
  return {
    default: hasDefaultKeys ? { ...STYLE_DEFAULTS.styleSettings.default, ...(stored.default ?? {}) } : {},
    unlearned: { ...(stored.unlearned ?? {}) },
    learning: { ...(stored.learning ?? {}) },
    learned: { ...(stored.learned ?? {}) },
    unknown: { ...(stored?.unknown ?? {}) },
  };
}

/**
 * Injects (or replaces) a `<style id="anki-dynamic-styles">` element in `doc.head`
 * containing the CSS produced by buildStyleSheet(styleSettings).
 *
 * @param {Document} doc - The document to inject into (pass `document` in production).
 * @param {object|null} styleSettings - User style overrides; null/undefined uses built-in defaults.
 */
export function injectStyles(doc, styleSettings) {
  const css = buildStyleSheet(styleSettings);
  let el = doc.getElementById('anki-dynamic-styles');
  if (!el) {
    el = doc.createElement('style');
    el.id = 'anki-dynamic-styles';
    doc.head.appendChild(el);
  }
  el.textContent = css;
}

export function buildStyleSheet(styleSettings) {
  return STYLE_CATEGORIES.map((cat) => {
    const s = resolveCategory(styleSettings, cat);
    const decls = CSS_GROUP_ORDER.map((group) => CSS_GROUP_RENDERERS[group](s)).filter((d) => d).join(' ');
    return `.anki-${cat} { ${decls} }`;
  }).join('\n');
}
