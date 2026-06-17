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
  },
};

/** Default visual style for each Anki status category used when no user overrides are set. */
export const BUILT_IN_STYLE_FALLBACK = {
  unlearned: { backgroundColor: '#dc4646', backgroundOpacity: 0.22, borderRadius: 3, outlineColor: '#dc4646', outlineOpacity: 0.35, outlineWidth: 1 },
  learning:  { backgroundColor: '#e6aa1e', backgroundOpacity: 0.22, borderRadius: 3, outlineColor: '#e6aa1e', outlineOpacity: 0.40, outlineWidth: 1 },
  learned:   { backgroundColor: '#32aa50', backgroundOpacity: 0.22, borderRadius: 3, outlineColor: '#32aa50', outlineOpacity: 0.35, outlineWidth: 1 },
};

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
  const categories = ['unlearned', 'learning', 'learned'];
  return categories.map((cat) => {
    const s = resolveCategory(styleSettings, cat);
    const bg = hexToRgb(s.backgroundColor);
    const ol = hexToRgb(s.outlineColor);
    const bgColor = bg ? `rgba(${bg.r}, ${bg.g}, ${bg.b}, ${s.backgroundOpacity})` : 'transparent';
    const olColor = ol ? `rgba(${ol.r}, ${ol.g}, ${ol.b}, ${s.outlineOpacity})` : 'transparent';
    return `.anki-${cat} { background-color: ${bgColor}; border-radius: ${s.borderRadius}px; outline: ${s.outlineWidth}px solid ${olColor}; }`;
  }).join('\n');
}
