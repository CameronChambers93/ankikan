import { STYLE_DEFAULTS, resolveStyleSettings } from './style-util.js';
import { resetToDefaults } from './popup-style.js';

const ext = typeof browser !== 'undefined' ? browser : chrome;

const DEFAULTS = {
  fieldName: 'Expression',
  allowedUrls: [],
  blockedUrls: [],
  furiganaGlobal: true,
  furiganaUnlearned: true,
  furiganaLearning: true,
  furiganaLearned: false,
  useLemma: false,
};

/** Shorthand for `document.getElementById`. */
const $ = (id) => document.getElementById(id);

/**
 * Loads saved settings from extension storage and populates all popup form fields.
 * Falls back to `DEFAULTS` for any key not yet persisted.
 */
async function loadSettings() {
  const s = await ext.storage.local.get({ ...DEFAULTS, styleSettings: STYLE_DEFAULTS.styleSettings });
  $('fieldName').value = s.fieldName;
  $('allowedUrls').value = (s.allowedUrls || []).join('\n');
  $('blockedUrls').value = (s.blockedUrls || []).join('\n');
  $('furiganaGlobal').checked = s.furiganaGlobal;
  $('furiganaUnlearned').checked = s.furiganaUnlearned;
  $('furiganaLearning').checked = s.furiganaLearning;
  $('furiganaLearned').checked = s.furiganaLearned;
  $('useLemma').checked = s.useLemma;
  updatePerStatusState(s.furiganaGlobal);

  const styleSettings = resolveStyleSettings(s.styleSettings);
  $('global-bg-color').value = styleSettings.default.backgroundColor;
  $('global-bg-opacity').value = styleSettings.default.backgroundOpacity;
  $('global-border-radius').value = styleSettings.default.borderRadius;
  $('global-outline-color').value = styleSettings.default.outlineColor;
  $('global-outline-opacity').value = styleSettings.default.outlineOpacity;
  $('global-outline-width').value = styleSettings.default.outlineWidth;
  for (const cat of ['unlearned', 'learning', 'learned']) {
    const overrides = styleSettings[cat] ?? {};
    const hasColor  = 'backgroundColor' in overrides;
    $(`${cat}-bg-color-enabled`).checked = hasColor;
    $(`${cat}-bg-color`).disabled        = !hasColor;
    $(`${cat}-bg-color`).value           = overrides.backgroundColor ?? '#808080';
    $(`${cat}-bg-opacity`).value         = overrides.backgroundOpacity ?? '';
  }
}

/**
 * Reads the current form state and returns a normalized settings object.
 * Trims whitespace, splits textarea lines into arrays, and falls back to `'Expression'`
 * if the field name input is empty.
 *
 * @returns {object} Settings object ready to be passed to `ext.storage.local.set`.
 */
function currentSettings() {
  return {
    fieldName: $('fieldName').value.trim() || 'Expression',
    allowedUrls: $('allowedUrls').value.split('\n').map((u) => u.trim()).filter(Boolean),
    blockedUrls: $('blockedUrls').value.split('\n').map((u) => u.trim()).filter(Boolean),
    furiganaGlobal: $('furiganaGlobal').checked,
    furiganaUnlearned: $('furiganaUnlearned').checked,
    furiganaLearning: $('furiganaLearning').checked,
    furiganaLearned: $('furiganaLearned').checked,
    useLemma: $('useLemma').checked,
  };
}

/** Persists the current form state to `ext.storage.local`. */
async function saveSettings() {
  await ext.storage.local.set(currentSettings());
}

/**
 * Enables or disables the per-status furigana checkboxes based on the global furigana toggle.
 * When disabled, the controls are visually greyed out via the `disabled` CSS class.
 *
 * @param {boolean} enabled - Whether the global furigana toggle is checked.
 */
function updatePerStatusState(enabled) {
  $('furiganaPerStatus').classList.toggle('disabled', !enabled);
}

/**
 * Displays a status message in the popup footer bar.
 *
 * @param {string} msg - Message text to display.
 * @param {string} [type=''] - Optional CSS modifier class (e.g. `'ok'` or `'error'`).
 */
function setStatus(msg, type = '') {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status ' + type;
}

/**
 * Returns the currently active tab in the current browser window.
 *
 * @returns {Promise<chrome.tabs.Tab>} The active tab object.
 */
async function getActiveTab() {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * Sends a message to the content script running in the given tab.
 * Returns `null` if the content script is not injected on that page
 * (e.g. `about:`, `chrome:`, or `moz-extension:` URLs).
 *
 * @param {chrome.tabs.Tab} tab - The target tab.
 * @param {object} msg - Message object to send.
 * @returns {Promise<any|null>} The content script's response, or null on failure.
 */
async function sendToContentScript(tab, msg) {
  try {
    return await ext.tabs.sendMessage(tab.id, msg);
  } catch (e) {
    // Content script not injected on this page (e.g. about:, chrome:, moz-extension:)
    return null;
  }
}

/**
 * Handles changes to any furigana visibility checkbox.
 * Saves the updated settings, refreshes the per-status control state, then sends
 * a `refreshFurigana` message to the active tab so the page updates immediately
 * without requiring a full rescan.
 */
async function onFuriganaChange() {
  await saveSettings();
  const settings = currentSettings();
  updatePerStatusState(settings.furiganaGlobal);
  const tab = await getActiveTab();
  if (tab) await sendToContentScript(tab, { action: 'refreshFurigana', settings });
}

function currentStyleSettings() {
  const catOverride = (cat) => {
    const colorEnabled = $(`${cat}-bg-color-enabled`).checked;
    const opacityRaw   = $(`${cat}-bg-opacity`).value;
    return {
      ...(colorEnabled ? { backgroundColor: $(`${cat}-bg-color`).value } : {}),
      ...(opacityRaw !== '' ? { backgroundOpacity: Number(opacityRaw) } : {}),
    };
  };
  return {
    default: {
      backgroundColor:   $('global-bg-color').value,
      backgroundOpacity: Number($('global-bg-opacity').value),
      borderRadius:      Number($('global-border-radius').value),
      outlineColor:      $('global-outline-color').value,
      outlineOpacity:    Number($('global-outline-opacity').value),
      outlineWidth:      Number($('global-outline-width').value),
    },
    unlearned: catOverride('unlearned'),
    learning:  catOverride('learning'),
    learned:   catOverride('learned'),
  };
}

async function onStyleChange() {
  const styleSettings = currentStyleSettings();
  await ext.storage.local.set({ styleSettings });
  const tab = await getActiveTab();
  if (tab) await sendToContentScript(tab, { action: 'refreshStyles', styleSettings });
}

$('furiganaGlobal').addEventListener('change', onFuriganaChange);
$('furiganaUnlearned').addEventListener('change', onFuriganaChange);
$('furiganaLearning').addEventListener('change', onFuriganaChange);
$('furiganaLearned').addEventListener('change', onFuriganaChange);

['global-bg-color', 'global-outline-color', 'unlearned-bg-color', 'learning-bg-color', 'learned-bg-color']
  .forEach((id) => $(id).addEventListener('input', onStyleChange));
['global-bg-opacity', 'global-border-radius', 'global-outline-opacity', 'global-outline-width',
  'unlearned-bg-opacity', 'learning-bg-opacity', 'learned-bg-opacity']
  .forEach((id) => $(id).addEventListener('change', onStyleChange));

for (const cat of ['unlearned', 'learning', 'learned']) {
  $(`${cat}-bg-color-enabled`).addEventListener('change', (e) => {
    $(`${cat}-bg-color`).disabled = !e.target.checked;
    onStyleChange();
  });
}

$('resetStylesBtn').addEventListener('click', () => {
  resetToDefaults(document, (data) => ext.storage.local.set(data), async (msg) => {
    const tab = await getActiveTab();
    if (tab) sendToContentScript(tab, msg);
  });
});

// Field/URL/lemma changes just save; scan button applies them
$('fieldName').addEventListener('change', saveSettings);
$('allowedUrls').addEventListener('change', saveSettings);
$('blockedUrls').addEventListener('change', saveSettings);
$('useLemma').addEventListener('change', saveSettings);

$('scanBtn').addEventListener('click', async () => {
  await saveSettings();
  const tab = await getActiveTab();
  if (!tab) {
    setStatus('No active tab found.', 'error');
    return;
  }

  $('scanBtn').disabled = true;
  setStatus('Scanning…');

  const result = await sendToContentScript(tab, { action: 'scan' });

  $('scanBtn').disabled = false;

  if (!result) {
    setStatus('Cannot run on this page.', 'error');
    return;
  }
  if (result.error) {
    const isConnErr = result.error === 'connection' || /connect/i.test(result.error);
    setStatus(isConnErr ? 'Could not reach Anki. Is it running?' : `Error: ${result.error}`, 'error');
    return;
  }
  setStatus(`${result.matched} / ${result.found} words matched`, 'ok');
});

ext.storage.onChanged.addListener((changes) => {
  if ('styleSettings' in changes && !('newValue' in changes.styleSettings)) {
    loadSettings();
  }
});

loadSettings();
