export const BUILT_IN_STYLE_FALLBACK = {
  unlearned: { backgroundColor: '#dc4646', backgroundOpacity: 0.22, borderRadius: 3, outlineColor: '#dc4646', outlineOpacity: 0.35, outlineWidth: 1 },
  learning:  { backgroundColor: '#e6aa1e', backgroundOpacity: 0.22, borderRadius: 3, outlineColor: '#e6aa1e', outlineOpacity: 0.40, outlineWidth: 1 },
  learned:   { backgroundColor: '#32aa50', backgroundOpacity: 0.22, borderRadius: 3, outlineColor: '#32aa50', outlineOpacity: 0.35, outlineWidth: 1 },
};

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

export function resolveCategory(styleSettings, category) {
  return {
    ...BUILT_IN_STYLE_FALLBACK[category],
    ...(styleSettings?.default ?? {}),
    ...(styleSettings?.[category] ?? {}),
  };
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
