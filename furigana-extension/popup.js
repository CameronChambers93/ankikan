'use strict';

const ext = typeof browser !== 'undefined' ? browser : chrome;

const DEFAULTS = {
  fieldName: 'Expression',
  allowedUrls: [],
  blockedUrls: [],
  furiganaGlobal: true,
  furiganaUnlearned: true,
  furiganaLearning: true,
  furiganaLearned: false,
};

const $ = (id) => document.getElementById(id);

async function loadSettings() {
  const s = await ext.storage.local.get(DEFAULTS);
  $('fieldName').value = s.fieldName;
  $('allowedUrls').value = (s.allowedUrls || []).join('\n');
  $('blockedUrls').value = (s.blockedUrls || []).join('\n');
  $('furiganaGlobal').checked = s.furiganaGlobal;
  $('furiganaUnlearned').checked = s.furiganaUnlearned;
  $('furiganaLearning').checked = s.furiganaLearning;
  $('furiganaLearned').checked = s.furiganaLearned;
  updatePerStatusState(s.furiganaGlobal);
}

function currentSettings() {
  return {
    fieldName: $('fieldName').value.trim() || 'Expression',
    allowedUrls: $('allowedUrls').value.split('\n').map((u) => u.trim()).filter(Boolean),
    blockedUrls: $('blockedUrls').value.split('\n').map((u) => u.trim()).filter(Boolean),
    furiganaGlobal: $('furiganaGlobal').checked,
    furiganaUnlearned: $('furiganaUnlearned').checked,
    furiganaLearning: $('furiganaLearning').checked,
    furiganaLearned: $('furiganaLearned').checked,
  };
}

async function saveSettings() {
  await ext.storage.local.set(currentSettings());
}

function updatePerStatusState(enabled) {
  $('furiganaPerStatus').classList.toggle('disabled', !enabled);
}

function setStatus(msg, type = '') {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status ' + type;
}

async function getActiveTab() {
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToContentScript(tab, msg) {
  try {
    return await ext.tabs.sendMessage(tab.id, msg);
  } catch (e) {
    // Content script not injected on this page (e.g. about:, chrome:, moz-extension:)
    return null;
  }
}

// Furigana toggles update live without requiring a full rescan
async function onFuriganaChange() {
  await saveSettings();
  const settings = currentSettings();
  updatePerStatusState(settings.furiganaGlobal);
  const tab = await getActiveTab();
  if (tab) await sendToContentScript(tab, { action: 'refreshFurigana', settings });
}

$('furiganaGlobal').addEventListener('change', onFuriganaChange);
$('furiganaUnlearned').addEventListener('change', onFuriganaChange);
$('furiganaLearning').addEventListener('change', onFuriganaChange);
$('furiganaLearned').addEventListener('change', onFuriganaChange);

// Field/URL changes just save; scan button applies them
$('fieldName').addEventListener('change', saveSettings);
$('allowedUrls').addEventListener('change', saveSettings);
$('blockedUrls').addEventListener('change', saveSettings);

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

loadSettings();
