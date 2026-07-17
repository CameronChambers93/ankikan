import {
  STYLE_DEFAULTS,
  BUILT_IN_STYLE_FALLBACK,
  STYLE_SCHEMA,
  STYLE_CATEGORIES,
  STYLE_PRESETS,
  resolveStyleSettings,
  applyPreset,
  matchPreset,
  buildStyleSheet,
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
  } else if (entry.type === 'bool') {
    input.type = 'checkbox';
  }
}

/**
 * Creates the DOM control element for a STYLE_SCHEMA entry: a <select> with one
 * <option> per entry.options for "enum" entries, otherwise an <input> configured
 * by applyControlAttributes.
 *
 * @param {Document} doc
 * @param {object} entry - A STYLE_SCHEMA entry.
 * @returns {HTMLElement}
 */
function createStyleControl(doc, entry) {
  if (entry.type === 'enum') {
    const select = doc.createElement('select');
    for (const option of entry.options) {
      const optionEl = doc.createElement('option');
      optionEl.value = option;
      optionEl.textContent = option;
      select.appendChild(optionEl);
    }
    return select;
  }
  const input = doc.createElement('input');
  applyControlAttributes(input, entry);
  return input;
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
    const input = createStyleControl(doc, entry);
    input.id = `global-${entry.id}`;
    label.appendChild(input);
    groupEl.appendChild(label);
  }

  const tablist = doc.createElement('div');
  tablist.setAttribute('role', 'tablist');
  container.appendChild(tablist);

  STYLE_CATEGORIES.forEach((cat, index) => {
    const tab = doc.createElement('button');
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.classList.add('style-category-tab');
    tab.id = `style-tab-${cat}`;
    tab.dataset.category = cat;
    tab.setAttribute('aria-controls', `style-panel-${cat}`);
    tab.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
    tab.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
    tablist.appendChild(tab);

    const panel = doc.createElement('div');
    panel.classList.add('style-category-panel');
    panel.setAttribute('role', 'tabpanel');
    panel.id = `style-panel-${cat}`;
    panel.dataset.categoryPanel = cat;
    panel.setAttribute('aria-labelledby', `style-tab-${cat}`);
    if (index !== 0) panel.setAttribute('hidden', '');

    for (const entry of STYLE_SCHEMA) {
      const label = doc.createElement('label');
      const enabled = doc.createElement('input');
      enabled.type = 'checkbox';
      enabled.id = `${cat}-${entry.id}-enabled`;
      label.appendChild(enabled);
      label.appendChild(doc.createTextNode(` ${cat} ${entry.key} `));
      const input = createStyleControl(doc, entry);
      input.id = `${cat}-${entry.id}`;
      label.appendChild(input);
      panel.appendChild(label);
    }
    container.appendChild(panel);
  });
}

/**
 * Shows `#style-panel-<cat>` and hides every other `.style-category-panel`,
 * moving `aria-selected="true"` to `#style-tab-<cat>` (all other tabs get
 * `"false"`).
 *
 * @param {Document} doc
 * @param {string} cat
 */
export function selectStyleCategory(doc, cat) {
  doc.querySelectorAll('.style-category-panel').forEach((panel) => {
    if (panel.dataset.categoryPanel === cat) panel.removeAttribute('hidden');
    else panel.setAttribute('hidden', '');
  });
  doc.querySelectorAll('.style-category-tab').forEach((tab) => {
    tab.setAttribute('aria-selected', tab.dataset.category === cat ? 'true' : 'false');
  });
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
export async function loadStyleSettings(doc, storageGet, isPreserved = () => false) {
  ensureStyleControls(doc);
  ensurePresetOptions(doc);

  const data = await storageGet({ styleSettings: STYLE_DEFAULTS.styleSettings });
  const styleSettings = resolveStyleSettings(data.styleSettings);

  const presetEl = doc.getElementById('style-preset');
  if (presetEl) presetEl.value = matchPreset(styleSettings) ?? 'custom';

  for (const entry of STYLE_SCHEMA) {
    const globalEl = doc.getElementById(`global-${entry.id}`);
    if (globalEl && !isPreserved(`global-${entry.id}`)) {
      if (entry.type === 'bool') {
        globalEl.checked = styleSettings.default[entry.key] === true;
      } else {
        globalEl.value = styleSettings.default[entry.key];
      }
    }

    for (const cat of STYLE_CATEGORIES) {
      const overrides = styleSettings[cat] ?? {};
      const has = entry.key in overrides;
      const enabledEl = doc.getElementById(`${cat}-${entry.id}-enabled`);
      const valueEl = doc.getElementById(`${cat}-${entry.id}`);
      // Skip controls the user already interacted with during this init cycle. The
      // interaction (and its onStyleChange persist) is authoritative; re-applying a
      // storage snapshot taken *before* that interaction would clobber it — e.g. an
      // enable-checkbox the user just checked would get re-disabled here (issue #65).
      if (isPreserved(`${cat}-${entry.id}`)) continue;
      if (enabledEl) {
        enabledEl.checked = has;
        if (valueEl) {
          if (entry.type === 'bool') {
            valueEl.checked = has ? overrides[entry.key] === true : false;
          } else {
            valueEl.value = has ? overrides[entry.key] : (BUILT_IN_STYLE_FALLBACK[cat]?.[entry.key] ?? '');
          }
          valueEl.disabled = !has;
        }
      } else if (valueEl) {
        if (entry.type === 'bool') {
          valueEl.checked = has ? overrides[entry.key] === true : false;
        } else {
          valueEl.value = has ? overrides[entry.key] : '';
        }
      }
    }
  }
}

/**
 * Coerces a control element's value to the type expected for a STYLE_SCHEMA
 * entry's key (string for colours/enums, boolean for bools, Number for
 * opacity/px).
 *
 * @param {object} entry - A STYLE_SCHEMA entry.
 * @param {HTMLElement} el
 * @returns {string|number|boolean}
 */
function coerceValue(entry, el) {
  if (entry.type === 'color' || entry.type === 'enum') return el.value;
  if (entry.type === 'bool') return el.checked;
  if (el.value === '') return undefined;
  return Number(el.value);
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
    if (el) result.default[entry.key] = coerceValue(entry, el);
  }

  for (const cat of STYLE_CATEGORIES) {
    result[cat] = {};
    for (const entry of STYLE_SCHEMA) {
      const enabledEl = doc.getElementById(`${cat}-${entry.id}-enabled`);
      const valueEl = doc.getElementById(`${cat}-${entry.id}`);
      if (enabledEl) {
        if (enabledEl.checked && valueEl) {
          result[cat][entry.key] = coerceValue(entry, valueEl);
        }
      } else if (valueEl && valueEl.value !== '') {
        result[cat][entry.key] = coerceValue(entry, valueEl);
      }
    }
  }
  return result;
}

/**
 * Renders a live preview of the current (not-yet-persisted) style settings into
 * `#style-preview` by injecting a `<style id="style-preview-styles">` scoped to
 * that container. Reads directly from the DOM via currentStyleSettings, so it
 * reflects in-progress edits with no storage round-trip.
 *
 * @param {Document} doc
 */
export function renderPreview(doc) {
  const styleSettings = currentStyleSettings(doc);
  const css = buildStyleSheet(styleSettings);
  const scoped = css
    .split('\n')
    .map((line) => line.replace(/^(\.anki-[a-z]+\s*\{)/, '#style-preview $1'))
    .join('\n');

  let el = doc.getElementById('style-preview-styles');
  if (!el) {
    el = doc.createElement('style');
    el.id = 'style-preview-styles';
    doc.head.appendChild(el);
  }
  el.textContent = scoped;
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
    if (globalEl) {
      if (entry.type === 'bool') globalEl.checked = merged.default[entry.key] === true;
      else globalEl.value = merged.default[entry.key];
    }
  }

  await storageSet({ styleSettings: merged });
  messageFn({ action: 'refreshStyles', styleSettings: merged });

  doc.getElementById('style-preset').value = matchPreset(merged) ?? value;
  renderPreview(doc);
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
    if (globalEl) {
      if (entry.type === 'bool') globalEl.checked = defaults.default[entry.key] === true;
      else globalEl.value = defaults.default[entry.key];
    }

    for (const cat of STYLE_CATEGORIES) {
      const enabledEl = doc.getElementById(`${cat}-${entry.id}-enabled`);
      const valueEl = doc.getElementById(`${cat}-${entry.id}`);
      if (enabledEl) {
        enabledEl.checked = false;
        if (valueEl) {
          valueEl.disabled = true;
          if (entry.type === 'bool') valueEl.checked = BUILT_IN_STYLE_FALLBACK[cat]?.[entry.key] === true;
          else valueEl.value = BUILT_IN_STYLE_FALLBACK[cat]?.[entry.key] ?? '';
        }
      } else if (valueEl) {
        if (entry.type === 'bool') valueEl.checked = false;
        else valueEl.value = '';
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

  // ensureStyleControls generates the schema-driven controls, so it must run before
  // any of the id lists below are computed against the live DOM. It is called
  // synchronously (not via loadStyleSettings) so that all listener wiring below is
  // attached before any awaited storage read resolves.
  ensureStyleControls(document);

  // Tracks controls the user touches before the initial (awaited) storage read
  // resolves, so that read's populate can skip them and not clobber a just-made
  // change (issue #65). Only the initial loadStyleSettings call consults this.
  const dirty = new Set();

  // Persistence is DEFERRED until the initial read has populated the DOM. Until
  // then, currentStyleSettings(doc) would serialise every untouched category as
  // "no override" (its checkbox is still unchecked), so persisting mid-window
  // would overwrite real stored overrides with {} and broadcast broken styles
  // (issue #65). Listeners still flip `disabled` synchronously for responsiveness;
  // they just record that a persist is pending and flush a single onStyleChange
  // once the populate completes, reading a fully-merged DOM. The live preview
  // (issue #46) is deferred the same way — renderPreview reads the live DOM via
  // currentStyleSettings, so it is only trustworthy once the populate completes.
  let initialLoadComplete = false;
  let pendingPersist = false;
  const persist = () => {
    if (initialLoadComplete) {
      onStyleChange(document, storageSet, messageFn);
      renderPreview(document);
    } else {
      pendingPersist = true;
    }
  };

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
    document.getElementById(id)?.addEventListener('input', () => {
      dirty.add(id);
      persist();
    });
  });
  numberInputIds.forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => {
      dirty.add(id);
      persist();
    });
  });

  for (const cat of STYLE_CATEGORIES) {
    for (const entry of STYLE_SCHEMA) {
      document.getElementById(`${cat}-${entry.id}-enabled`)?.addEventListener('change', (e) => {
        dirty.add(`${cat}-${entry.id}`);
        const valueEl = document.getElementById(`${cat}-${entry.id}`);
        if (valueEl) valueEl.disabled = !e.target.checked;
        persist();
      });
    }
  }

  for (const cat of STYLE_CATEGORIES) {
    document.getElementById(`style-tab-${cat}`)?.addEventListener('click', () =>
      selectStyleCategory(document, cat)
    );
  }

  document.getElementById('resetStylesBtn')?.addEventListener('click', () => {
    resetOptionsToDefaults(document, storageSet, messageFn);
    renderPreview(document);
  });

  document.getElementById('style-preset')?.addEventListener('change', () =>
    onPresetChange(document, storageSet, messageFn)
  );

  ext.storage.onChanged.addListener((changes) => {
    if ('styleSettings' in changes && !changes.styleSettings.newValue) {
      loadStyleSettings(document, storageGet).then(() => renderPreview(document));
    }
  });

  document.getElementById('importDictBtn')?.addEventListener('click', () => {
    document.getElementById('dictFileInput')?.click();
  });
  document.getElementById('dictFileInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) onImportDict(document, file);
  });

  await loadStyleSettings(document, storageGet, (id) => dirty.has(id));
  // The DOM is now fully populated (touched controls preserved, the rest filled
  // from storage). Flush a single persist if the user interacted during the
  // window, so their change is saved against a correct, fully-merged snapshot.
  initialLoadComplete = true;
  if (pendingPersist) onStyleChange(document, storageSet, messageFn);
  // Render the live preview (issue #46) once, now the DOM reflects the fully
  // merged settings — currentStyleSettings is only trustworthy after populate.
  renderPreview(document);
  refreshDictStatus(document);
}
