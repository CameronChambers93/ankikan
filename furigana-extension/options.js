import { STYLE_DEFAULTS, BUILT_IN_STYLE_FALLBACK, resolveStyleSettings } from './style-util.js';
import { ZipReader, BlobReader, BlobWriter } from '@zip.js/zip.js';
import { saveDictionary, hasDictionary } from './dict-store.js';
import { validateDictFiles } from './lemma-util.js';

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

  for (const cat of ['unlearned', 'learning', 'learned', 'unknown']) {
    const overrides  = styleSettings[cat] ?? {};
    const hasColor   = 'backgroundColor' in overrides;
    doc.getElementById(`${cat}-bg-color-enabled`).checked  = hasColor;
    doc.getElementById(`${cat}-bg-color`).disabled         = !hasColor;
    doc.getElementById(`${cat}-bg-color`).value            = overrides.backgroundColor ?? BUILT_IN_STYLE_FALLBACK[cat].backgroundColor;
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
    unknown:   catOverride('unknown'),
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

  for (const cat of ['unlearned', 'learning', 'learned', 'unknown']) {
    const enabledEl = doc.getElementById(`${cat}-bg-color-enabled`);
    const colorEl   = doc.getElementById(`${cat}-bg-color`);
    const opacityEl = doc.getElementById(`${cat}-bg-opacity`);
    if (enabledEl) { enabledEl.checked = false; }
    if (colorEl)   { colorEl.disabled = true; colorEl.value = BUILT_IN_STYLE_FALLBACK[cat].backgroundColor; }
    if (opacityEl) { opacityEl.value = ''; }
  }

  await onStyleChange(doc, storageSet, messageFn);
}

/**
 * Reflects the current dictionary status in `#dictStatus`.
 *
 * @param {Document} doc - The options document.
 */
export async function refreshDictStatus(doc) {
  const el = doc.getElementById('dictStatus');
  if (!el) return;
  const loaded = await hasDictionary().catch(() => false);
  el.textContent = loaded ? 'Loaded' : 'Not loaded';
}

/**
 * Extracts dictionary files from a zip and stores them, validating completeness first.
 *
 * @param {Document} doc - The options document.
 * @param {File} file - The user-selected zip archive.
 */
export async function onImportDict(doc, file) {
  const status = doc.getElementById('dictStatus');
  if (status) status.textContent = 'Importing…';
  try {
    const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false });
    const entries = await reader.getEntries();
    const fileEntries = entries.filter((e) => !e.directory);
    const names = fileEntries.map((e) => e.filename.split('/').pop());
    const { ok, missing } = validateDictFiles(names);
    if (!ok) {
      await reader.close();
      if (status) status.textContent = `Missing: ${missing.join(', ')}`;
      return;
    }
    const fileMap = new Map();
    for (const entry of fileEntries) {
      const name = entry.filename.split('/').pop();
      const blob = await entry.getData(new BlobWriter());
      fileMap.set(name, blob);
    }
    await reader.close();
    await saveDictionary(fileMap);
    await refreshDictStatus(doc);
  } catch (e) {
    if (status) status.textContent = 'Import failed';
  }
}

// ---------------------------------------------------------------------------
// Browser wiring — only runs when loaded as a real extension page
// ---------------------------------------------------------------------------

const ext = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
if (typeof document !== 'undefined' && ext) {

  const storageGet = (defaults) =>
    new Promise((resolve) => ext.storage.local.get(defaults, resolve));

  const storageSet = (data) =>
    new Promise((resolve) => ext.storage.local.set(data, resolve));

  const messageFn = async (msg) => {
    const tabs = await ext.tabs.query({});
    for (const tab of tabs) {
      if (!tab.url?.startsWith('chrome-extension://') && !tab.url?.startsWith('moz-extension://')) {
        try { await ext.tabs.sendMessage(tab.id, msg); } catch {}
      }
    }
  };

  const styleInputIds = [
    'global-bg-color', 'global-outline-color',
    'unlearned-bg-color', 'learning-bg-color', 'learned-bg-color', 'unknown-bg-color',
  ];
  const numberInputIds = [
    'global-bg-opacity', 'global-border-radius',
    'global-outline-opacity', 'global-outline-width',
    'unlearned-bg-opacity', 'learning-bg-opacity', 'learned-bg-opacity', 'unknown-bg-opacity',
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

  for (const cat of ['unlearned', 'learning', 'learned', 'unknown']) {
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

  document.getElementById('importDictBtn')?.addEventListener('click', () => {
    document.getElementById('dictFileInput')?.click();
  });
  document.getElementById('dictFileInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) onImportDict(document, file);
  });
  refreshDictStatus(document);

  await loadStyleSettings(document, storageGet);
}
