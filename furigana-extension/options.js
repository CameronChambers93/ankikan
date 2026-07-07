import {
  STYLE_DEFAULTS,
  BUILT_IN_STYLE_FALLBACK,
  STYLE_SCHEMA,
  STYLE_CATEGORIES,
  STYLE_PRESETS,
  resolveStyleSettings,
  applyPreset,
  matchPreset,
} from './style-util.js';
import { ZipReader, BlobReader, BlobWriter } from '@zip.js/zip.js';
import { saveDictionary, hasDictionary } from './dict-store.js';
import { validateDictFiles } from './lemma-util.js';

/**
 * Sets the `type`/`step`/`min`/`max` attributes for a generated control input
 * according to its STYLE_SCHEMA entry.
 *
 * @param {HTMLInputElement} input
 * @param {object} entry - A STYLE_SCHEMA entry.
 */
function applyControlAttributes(input, entry) {
  if (entry.type === 'color') {
    input.type = 'color';
  } else if (entry.type === 'opacity') {
    input.type = 'number';
    input.step = '0.01';
    input.min = '0';
    input.max = '1';
  } else if (entry.type === 'px') {
    input.type = 'number';
    input.step = '1';
    if (entry.min !== undefined) input.min = String(entry.min);
    if (entry.max !== undefined) input.max = String(entry.max);
  }
}

/**
 * Generates one default control per STYLE_SCHEMA entry, and one override control
 * plus enable checkbox per category x entry, into `#style-controls`. No-op if the
 * container is absent (legacy/hand-written markup) or already populated.
 *
 * @param {Document} doc
 */
function ensureStyleControls(doc) {
  const container = doc.getElementById('style-controls');
  if (!container) return;
  if (doc.getElementById(`global-${STYLE_SCHEMA[0].id}`)) return;

  const groupContainers = {};
  for (const entry of STYLE_SCHEMA) {
    let groupEl = groupContainers[entry.group];
    if (!groupEl) {
      groupEl = doc.createElement('div');
      groupEl.dataset.styleGroup = entry.group;
      const heading = doc.createElement('h3');
      heading.textContent = entry.group.charAt(0).toUpperCase() + entry.group.slice(1);
      groupEl.appendChild(heading);
      groupContainers[entry.group] = groupEl;
      container.appendChild(groupEl);
    }
    const label = doc.createElement('label');
    label.textContent = `Default ${entry.key} `;
    const input = doc.createElement('input');
    input.id = `global-${entry.id}`;
    applyControlAttributes(input, entry);
    label.appendChild(input);
    groupEl.appendChild(label);
  }

  for (const cat of STYLE_CATEGORIES) {
    const row = doc.createElement('div');
    for (const entry of STYLE_SCHEMA) {
      const label = doc.createElement('label');
      const enabled = doc.createElement('input');
      enabled.type = 'checkbox';
      enabled.id = `${cat}-${entry.id}-enabled`;
      label.appendChild(enabled);
      label.appendChild(doc.createTextNode(` ${cat} ${entry.key} `));
      const input = doc.createElement('input');
      input.id = `${cat}-${entry.id}`;
      applyControlAttributes(input, entry);
      label.appendChild(input);
      row.appendChild(label);
    }
    container.appendChild(row);
  }
}

/**
 * Populates `#style-preset` with one <option> per STYLE_PRESETS entry (in
 * insertion order) plus a trailing "Custom" option. No-op if the element is
 * absent or already populated.
 *
 * @param {Document} doc
 */
function ensurePresetOptions(doc) {
  const select = doc.getElementById('style-preset');
  if (!select || select.options.length) return;

  for (const [key, preset] of Object.entries(STYLE_PRESETS)) {
    const option = doc.createElement('option');
    option.value = key;
    option.textContent = preset.label;
    select.appendChild(option);
  }
  const customOption = doc.createElement('option');
  customOption.value = 'custom';
  customOption.textContent = 'Custom';
  select.appendChild(customOption);
}

/**
 * Reads stored style settings via `storageGet` and populates all inputs in `doc`.
 * Falls back to STYLE_DEFAULTS when storage returns nothing. Generates the
 * schema-driven controls into `#style-controls` first if they don't exist yet.
 *
 * @param {Document} doc
 * @param {Function} storageGet - Returns Promise<{ styleSettings? }>
 */
export async function loadStyleSettings(doc, storageGet) {
  ensureStyleControls(doc);
  ensurePresetOptions(doc);

  const data = await storageGet({ styleSettings: STYLE_DEFAULTS.styleSettings });
  const styleSettings = resolveStyleSettings(data.styleSettings);

  const presetEl = doc.getElementById('style-preset');
  if (presetEl) presetEl.value = matchPreset(styleSettings) ?? 'custom';

  for (const entry of STYLE_SCHEMA) {
    const globalEl = doc.getElementById(`global-${entry.id}`);
    if (globalEl) globalEl.value = styleSettings.default[entry.key];

    for (const cat of STYLE_CATEGORIES) {
      const overrides = styleSettings[cat] ?? {};
      const has = entry.key in overrides;
      const enabledEl = doc.getElementById(`${cat}-${entry.id}-enabled`);
      const valueEl = doc.getElementById(`${cat}-${entry.id}`);
      if (enabledEl) {
        enabledEl.checked = has;
        if (valueEl) {
          valueEl.value = has ? overrides[entry.key] : (BUILT_IN_STYLE_FALLBACK[cat]?.[entry.key] ?? '');
          valueEl.disabled = !has;
        }
      } else if (valueEl) {
        valueEl.value = has ? overrides[entry.key] : '';
      }
    }
  }
}

/**
 * Coerces a raw input string to the type expected for a STYLE_SCHEMA entry's key
 * (string for colours, Number for opacity/px).
 *
 * @param {object} entry - A STYLE_SCHEMA entry.
 * @param {string} raw
 * @returns {string|number}
 */
function coerceValue(entry, raw) {
  return entry.type === 'color' ? raw : Number(raw);
}

/**
 * Reads all style inputs from `doc` and returns a styleSettings object.
 *
 * For each category x STYLE_SCHEMA entry: if a `<cat>-<id>-enabled` checkbox
 * exists, the property is included only when it is checked (schema-generated
 * controls). Otherwise (legacy hand-written markup with no enable checkbox for
 * that property, e.g. backgroundOpacity before issue #45), the property is
 * included whenever its raw input value is non-empty.
 *
 * @param {Document} doc
 * @returns {object} styleSettings
 */
export function currentStyleSettings(doc) {
  const result = { default: {} };
  for (const entry of STYLE_SCHEMA) {
    const el = doc.getElementById(`global-${entry.id}`);
    result.default[entry.key] = coerceValue(entry, el.value);
  }

  for (const cat of STYLE_CATEGORIES) {
    result[cat] = {};
    for (const entry of STYLE_SCHEMA) {
      const enabledEl = doc.getElementById(`${cat}-${entry.id}-enabled`);
      const valueEl = doc.getElementById(`${cat}-${entry.id}`);
      if (enabledEl) {
        if (enabledEl.checked && valueEl) {
          result[cat][entry.key] = coerceValue(entry, valueEl.value);
        }
      } else if (valueEl && valueEl.value !== '') {
        result[cat][entry.key] = coerceValue(entry, valueEl.value);
      }
    }
  }
  return result;
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

  const sel = doc.getElementById('style-preset');
  if (sel) sel.value = matchPreset(styleSettings) ?? 'custom';
}

/**
 * Applies the preset selected in `#style-preset` over the current style
 * settings, writes the merged default-layer values back into the generated
 * inputs, and persists via the same contract as onStyleChange.
 *
 * @param {Document} doc
 * @param {Function} storageSet - Called with { styleSettings }
 * @param {Function} messageFn  - Called with { action: 'refreshStyles', styleSettings }
 */
export async function onPresetChange(doc, storageSet, messageFn) {
  const value = doc.getElementById('style-preset').value;
  const merged = applyPreset(currentStyleSettings(doc), value);

  for (const entry of STYLE_SCHEMA) {
    const globalEl = doc.getElementById(`global-${entry.id}`);
    if (globalEl) globalEl.value = merged.default[entry.key];
  }

  await storageSet({ styleSettings: merged });
  messageFn({ action: 'refreshStyles', styleSettings: merged });

  doc.getElementById('style-preset').value = matchPreset(merged) ?? value;
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

  for (const entry of STYLE_SCHEMA) {
    const globalEl = doc.getElementById(`global-${entry.id}`);
    if (globalEl) globalEl.value = defaults.default[entry.key];

    for (const cat of STYLE_CATEGORIES) {
      const enabledEl = doc.getElementById(`${cat}-${entry.id}-enabled`);
      const valueEl = doc.getElementById(`${cat}-${entry.id}`);
      if (enabledEl) {
        enabledEl.checked = false;
        if (valueEl) {
          valueEl.disabled = true;
          valueEl.value = BUILT_IN_STYLE_FALLBACK[cat]?.[entry.key] ?? '';
        }
      } else if (valueEl) {
        valueEl.value = '';
      }
    }
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

  // loadStyleSettings generates the schema-driven controls, so it must run before
  // any of the id lists below are computed against the live DOM.
  await loadStyleSettings(document, storageGet);

  const colorInputIds = [];
  const numberInputIds = [];
  for (const entry of STYLE_SCHEMA) {
    const ids = entry.type === 'color' ? colorInputIds : numberInputIds;
    ids.push(`global-${entry.id}`);
    for (const cat of STYLE_CATEGORIES) {
      ids.push(`${cat}-${entry.id}`);
    }
  }

  colorInputIds.forEach((id) => {
    document.getElementById(id)?.addEventListener('input', () =>
      onStyleChange(document, storageSet, messageFn)
    );
  });
  numberInputIds.forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () =>
      onStyleChange(document, storageSet, messageFn)
    );
  });

  for (const cat of STYLE_CATEGORIES) {
    for (const entry of STYLE_SCHEMA) {
      document.getElementById(`${cat}-${entry.id}-enabled`)?.addEventListener('change', (e) => {
        const valueEl = document.getElementById(`${cat}-${entry.id}`);
        if (valueEl) valueEl.disabled = !e.target.checked;
        onStyleChange(document, storageSet, messageFn);
      });
    }
  }

  document.getElementById('resetStylesBtn')?.addEventListener('click', () =>
    resetOptionsToDefaults(document, storageSet, messageFn)
  );

  document.getElementById('style-preset')?.addEventListener('change', () =>
    onPresetChange(document, storageSet, messageFn)
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
}
