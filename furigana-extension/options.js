import { STYLE_DEFAULTS, resolveStyleSettings } from './style-util.js';

/**
 * Reads stored style settings via `storageGet` and populates all inputs in `doc`.
 * Falls back to STYLE_DEFAULTS when storage returns nothing.
 *
 * @param {Document} doc
 * @param {Function} storageGet - Returns Promise<{ styleSettings? }>
 */
export async function loadStyleSettings(doc, storageGet) {
  const data = await storageGet({ styleSettings: STYLE_DEFAULTS.styleSettings });
  const styleSettings = resolveStyleSettings(data.styleSettings);

  doc.getElementById('global-bg-color').value        = styleSettings.default.backgroundColor;
  doc.getElementById('global-bg-opacity').value      = styleSettings.default.backgroundOpacity;
  doc.getElementById('global-border-radius').value   = styleSettings.default.borderRadius;
  doc.getElementById('global-outline-color').value   = styleSettings.default.outlineColor;
  doc.getElementById('global-outline-opacity').value = styleSettings.default.outlineOpacity;
  doc.getElementById('global-outline-width').value   = styleSettings.default.outlineWidth;

  for (const cat of ['unlearned', 'learning', 'learned']) {
    const overrides  = styleSettings[cat] ?? {};
    const hasColor   = 'backgroundColor' in overrides;
    doc.getElementById(`${cat}-bg-color-enabled`).checked  = hasColor;
    doc.getElementById(`${cat}-bg-color`).disabled         = !hasColor;
    doc.getElementById(`${cat}-bg-color`).value            = overrides.backgroundColor ?? '#808080';
    doc.getElementById(`${cat}-bg-opacity`).value          = overrides.backgroundOpacity ?? '';
  }
}

/**
 * Reads all style inputs from `doc` and returns a styleSettings object.
 * Per-category backgroundColor is only included when the enable checkbox is checked.
 * Per-category backgroundOpacity is only included when the opacity input is non-empty.
 *
 * @param {Document} doc
 * @returns {object} styleSettings
 */
export function currentStyleSettings(doc) {
  const catOverride = (cat) => {
    const colorEnabled = doc.getElementById(`${cat}-bg-color-enabled`).checked;
    const opacityRaw   = doc.getElementById(`${cat}-bg-opacity`).value;
    return {
      ...(colorEnabled ? { backgroundColor: doc.getElementById(`${cat}-bg-color`).value } : {}),
      ...(opacityRaw !== '' ? { backgroundOpacity: Number(opacityRaw) } : {}),
    };
  };
  return {
    default: {
      backgroundColor:   doc.getElementById('global-bg-color').value,
      backgroundOpacity: Number(doc.getElementById('global-bg-opacity').value),
      borderRadius:      Number(doc.getElementById('global-border-radius').value),
      outlineColor:      doc.getElementById('global-outline-color').value,
      outlineOpacity:    Number(doc.getElementById('global-outline-opacity').value),
      outlineWidth:      Number(doc.getElementById('global-outline-width').value),
    },
    unlearned: catOverride('unlearned'),
    learning:  catOverride('learning'),
    learned:   catOverride('learned'),
  };
}

/**
 * Persists current style settings to storage and sends a refreshStyles message.
 *
 * @param {Document} doc
 * @param {Function} storageSet - Called with { styleSettings }
 * @param {Function} messageFn  - Called with { action: 'refreshStyles', styleSettings }
 */
export async function onStyleChange(doc, storageSet, messageFn) {
  const styleSettings = currentStyleSettings(doc);
  await storageSet({ styleSettings });
  messageFn({ action: 'refreshStyles', styleSettings });
}

/**
 * Resets all style inputs to STYLE_DEFAULTS, unchecks per-category enable checkboxes,
 * persists defaults to storage, and sends a refreshStyles message.
 *
 * @param {Document} doc
 * @param {Function} storageSet - Called with { styleSettings }
 * @param {Function} messageFn  - Called with { action: 'refreshStyles', styleSettings }
 */
export async function resetOptionsToDefaults(doc, storageSet, messageFn) {
  const defaults = STYLE_DEFAULTS.styleSettings;
  doc.getElementById('global-bg-color').value        = defaults.default.backgroundColor;
  doc.getElementById('global-bg-opacity').value      = defaults.default.backgroundOpacity;
  doc.getElementById('global-border-radius').value   = defaults.default.borderRadius;
  doc.getElementById('global-outline-color').value   = defaults.default.outlineColor;
  doc.getElementById('global-outline-opacity').value = defaults.default.outlineOpacity;
  doc.getElementById('global-outline-width').value   = defaults.default.outlineWidth;

  for (const cat of ['unlearned', 'learning', 'learned']) {
    const enabledEl = doc.getElementById(`${cat}-bg-color-enabled`);
    const colorEl   = doc.getElementById(`${cat}-bg-color`);
    const opacityEl = doc.getElementById(`${cat}-bg-opacity`);
    if (enabledEl) { enabledEl.checked = false; }
    if (colorEl)   { colorEl.disabled = true; colorEl.value = ''; }
    if (opacityEl) { opacityEl.value = ''; }
  }

  await onStyleChange(doc, storageSet, messageFn);
}

// ---------------------------------------------------------------------------
// Browser wiring — only runs when loaded as a real extension page
// ---------------------------------------------------------------------------

if (typeof document !== 'undefined' && typeof chrome !== 'undefined') {
  const ext = typeof browser !== 'undefined' ? browser : chrome;

  const storageGet = (defaults) =>
    new Promise((resolve) => ext.storage.local.get(defaults, resolve));

  const storageSet = (data) =>
    new Promise((resolve) => ext.storage.local.set(data, resolve));

  const messageFn = async (msg) => {
    const tabs = await ext.tabs.query({});
    for (const tab of tabs) {
      if (!tab.url?.startsWith('chrome-extension://')) {
        try { await ext.tabs.sendMessage(tab.id, msg); } catch {}
      }
    }
  };

  const styleInputIds = [
    'global-bg-color', 'global-outline-color',
    'unlearned-bg-color', 'learning-bg-color', 'learned-bg-color',
  ];
  const numberInputIds = [
    'global-bg-opacity', 'global-border-radius',
    'global-outline-opacity', 'global-outline-width',
    'unlearned-bg-opacity', 'learning-bg-opacity', 'learned-bg-opacity',
  ];

  styleInputIds.forEach((id) => {
    document.getElementById(id)?.addEventListener('input', () =>
      onStyleChange(document, storageSet, messageFn)
    );
  });
  numberInputIds.forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () =>
      onStyleChange(document, storageSet, messageFn)
    );
  });

  for (const cat of ['unlearned', 'learning', 'learned']) {
    document.getElementById(`${cat}-bg-color-enabled`)?.addEventListener('change', (e) => {
      document.getElementById(`${cat}-bg-color`).disabled = !e.target.checked;
      onStyleChange(document, storageSet, messageFn);
    });
  }

  document.getElementById('resetStylesBtn')?.addEventListener('click', () =>
    resetOptionsToDefaults(document, storageSet, messageFn)
  );

  ext.storage.onChanged.addListener((changes) => {
    if ('styleSettings' in changes && !changes.styleSettings.newValue) {
      loadStyleSettings(document, storageGet);
    }
  });

  loadStyleSettings(document, storageGet);
}
