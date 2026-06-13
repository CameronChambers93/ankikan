import { resolveLemmaMode } from './lemma-util.js';
import { hasDictionary } from './dict-store.js';

const ext = (typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null));

const DEFAULTS = {
  fieldName: 'Expression',
  allowedUrls: [],
  blockedUrls: [],
  furiganaGlobal: true,
  furiganaUnlearned: true,
  furiganaLearning: true,
  furiganaLearned: false,
  lemmaMode: null,
  useLemma: false,
};

/**
 * Shows the dictionary import row only in local mode.
 *
 * @param {Document} doc - The popup document.
 * @param {string} mode - The current lemma mode.
 */
export function updateLemmaModeUI(doc, mode) {
  const hidden = mode !== 'local';
  const row = doc.getElementById('importDictRow');
  if (row) row.classList.toggle('hidden', hidden);
  const outer = doc.getElementById('importRow');
  if (outer) outer.classList.toggle('hidden', hidden);
}

/**
 * Reflects the current dictionary status in `#dictStatus`.
 *
 * @param {Document} doc - The popup document.
 */
async function refreshDictStatus(doc) {
  const el = doc.getElementById('dictStatus');
  if (!el) return;
  const loaded = await hasDictionary().catch(() => false);
  el.textContent = loaded ? 'Loaded' : 'Not loaded';
}

/**
 * Loads saved settings from extension storage and populates all popup form fields.
 * Resolves the lemma mode (migrating from the legacy `useLemma` boolean when needed)
 * and persists the migration when a `set` function is supplied.
 *
 * @param {Document} doc - The popup document.
 * @param {(defaults: object) => Promise<object>} storageGet - Reads stored settings.
 * @param {(obj: object) => Promise<void>} [storageSet] - Persists settings (for migration write-back).
 */
export async function loadSettings(doc, storageGet, storageSet) {
  const s = await storageGet(DEFAULTS);
  const mode = resolveLemmaMode(s);
  doc.getElementById('fieldName').value = s.fieldName;
  doc.getElementById('allowedUrls').value = (s.allowedUrls || []).join('\n');
  doc.getElementById('blockedUrls').value = (s.blockedUrls || []).join('\n');
  doc.getElementById('furiganaGlobal').checked = s.furiganaGlobal;
  doc.getElementById('furiganaUnlearned').checked = s.furiganaUnlearned;
  doc.getElementById('furiganaLearning').checked = s.furiganaLearning;
  doc.getElementById('furiganaLearned').checked = s.furiganaLearned;
  doc.getElementById('lemmaMode').value = mode;
  updatePerStatusState(doc, s.furiganaGlobal);
  updateLemmaModeUI(doc, mode);
  if (typeof s.lemmaMode !== 'string' && storageSet) {
    await storageSet({ lemmaMode: mode });
  }
  await refreshDictStatus(doc);
}

/**
 * Reads the current form state and returns a normalized settings object.
 *
 * @param {Document} doc - The popup document.
 * @returns {object} Settings object ready to be persisted.
 */
export function currentSettings(doc) {
  return {
    fieldName: doc.getElementById('fieldName').value.trim() || 'Expression',
    allowedUrls: doc.getElementById('allowedUrls').value.split('\n').map((u) => u.trim()).filter(Boolean),
    blockedUrls: doc.getElementById('blockedUrls').value.split('\n').map((u) => u.trim()).filter(Boolean),
    furiganaGlobal: doc.getElementById('furiganaGlobal').checked,
    furiganaUnlearned: doc.getElementById('furiganaUnlearned').checked,
    furiganaLearning: doc.getElementById('furiganaLearning').checked,
    furiganaLearned: doc.getElementById('furiganaLearned').checked,
    lemmaMode: doc.getElementById('lemmaMode').value,
  };
}

/**
 * Enables or disables the per-status furigana checkboxes based on the global furigana toggle.
 *
 * @param {Document} doc - The popup document.
 * @param {boolean} enabled - Whether the global furigana toggle is checked.
 */
function updatePerStatusState(doc, enabled) {
  doc.getElementById('furiganaPerStatus').classList.toggle('disabled', !enabled);
}

if (ext) {
  /** Shorthand for `document.getElementById`. */
  const $ = (id) => document.getElementById(id);

  const storageGet = (defaults) => ext.storage.local.get(defaults);
  const storageSet = (obj) => ext.storage.local.set(obj);

  /** Persists the current form state to `ext.storage.local`. */
  const saveSettings = () => ext.storage.local.set(currentSettings(document));

  /**
   * Displays a status message in the popup footer bar.
   *
   * @param {string} msg - Message text to display.
   * @param {string} [type=''] - Optional CSS modifier class.
   */
  const setStatus = (msg, type = '') => {
    const el = $('status');
    el.textContent = msg;
    el.className = 'status ' + type;
  };

  /** Returns the currently active tab in the current browser window. */
  const getActiveTab = async () => {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    return tab;
  };

  /**
   * Sends a message to the content script running in the given tab.
   * Returns `null` if the content script is not injected on that page.
   */
  const sendToContentScript = async (tab, msg) => {
    try {
      return await ext.tabs.sendMessage(tab.id, msg);
    } catch (e) {
      return null;
    }
  };

  /**
   * Handles changes to any furigana visibility checkbox: saves settings, refreshes the
   * per-status control state, then live-updates the active tab.
   */
  const onFuriganaChange = async () => {
    await saveSettings();
    const settings = currentSettings(document);
    updatePerStatusState(document, settings.furiganaGlobal);
    const tab = await getActiveTab();
    if (tab) await sendToContentScript(tab, { action: 'refreshFurigana', settings });
  };

  $('furiganaGlobal').addEventListener('change', onFuriganaChange);
  $('furiganaUnlearned').addEventListener('change', onFuriganaChange);
  $('furiganaLearning').addEventListener('change', onFuriganaChange);
  $('furiganaLearned').addEventListener('change', onFuriganaChange);

  $('openOptionsBtn').addEventListener('click', () => ext.runtime.openOptionsPage());

  $('fieldName').addEventListener('change', saveSettings);
  $('allowedUrls').addEventListener('change', saveSettings);
  $('blockedUrls').addEventListener('change', saveSettings);

  $('lemmaMode').addEventListener('change', async () => {
    await saveSettings();
    updateLemmaModeUI(document, $('lemmaMode').value);
    await refreshDictStatus(document);
  });

  $('importDictBtn').addEventListener('click', () => ext.runtime.openOptionsPage());

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

  // Re-sync the popup when storage changes underneath it (e.g. settings written by another
  // surface, or by automated tooling) so the displayed lemma mode always reflects storage.
  if (ext.storage.onChanged) {
    ext.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if ('lemmaMode' in changes || 'useLemma' in changes) {
        loadSettings(document, storageGet);
      }
    });
  }

  loadSettings(document, storageGet, storageSet);
}
