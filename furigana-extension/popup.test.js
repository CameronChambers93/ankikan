import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

// popup.js does not currently export functions — dynamic imports inside each
// test will fail with "does not provide an export named" until the developer
// refactors the module.  vi.resetModules() before each test prevents module-
// cache interference between tests that mutate global DOM state.

beforeEach(() => {
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Helper — build a JSDOM document matching the new popup.html DOM contract
// ---------------------------------------------------------------------------

function makePopupDoc() {
  const { window } = new JSDOM(`<!DOCTYPE html><html><body>
    <input id="fieldName" type="text" value="">
    <textarea id="allowedUrls"></textarea>
    <textarea id="blockedUrls"></textarea>
    <input id="furiganaGlobal"    type="checkbox">
    <input id="furiganaUnlearned" type="checkbox">
    <input id="furiganaLearning"  type="checkbox">
    <input id="furiganaLearned"   type="checkbox">
    <select id="lemmaMode">
      <option value="off">Off</option>
      <option value="server">Server</option>
      <option value="local">Local</option>
    </select>
    <div id="importDictRow" class="hidden">
      <button id="importDictBtn">Import dictionary…</button>
      <input id="dictFileInput" type="file" accept=".zip" style="display:none">
    </div>
    <span id="dictStatus"></span>
    <div id="furiganaPerStatus"></div>
    <button id="openOptionsBtn"></button>
    <button id="scanBtn"></button>
    <div id="status"></div>
  </body></html>`);
  return window.document;
}

/** Build a minimal fake ext.storage.local that resolves from a fixed data object. */
function makeFakeStorage(data = {}) {
  return {
    get: vi.fn().mockResolvedValue(data),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// resolveLemmaMode migration in loadSettings — AC3, AC4
// ---------------------------------------------------------------------------

describe('loadSettings — lemmaMode migration', () => {
  it('sets #lemmaMode.value to "server" when storage contains legacy { useLemma: true }', async () => {
    // Users who previously opted in via the checkbox must continue to use the
    // server path after the upgrade; their setting is migrated to "server" (AC3).
    const { loadSettings } = await import('./popup.js');
    const doc = makePopupDoc();
    const storage = makeFakeStorage({ useLemma: true });
    await loadSettings(doc, storage.get);
    expect(doc.getElementById('lemmaMode').value).toBe('server');
  });

  it('sets #lemmaMode.value to "off" when storage contains legacy { useLemma: false }', async () => {
    // A user who had the feature disabled must remain at "off" after migration (AC3).
    const { loadSettings } = await import('./popup.js');
    const doc = makePopupDoc();
    const storage = makeFakeStorage({ useLemma: false });
    await loadSettings(doc, storage.get);
    expect(doc.getElementById('lemmaMode').value).toBe('off');
  });

  it('sets #lemmaMode.value to "local" when storage contains { lemmaMode: "local" }', async () => {
    // A stored lemmaMode value must be applied verbatim without re-running
    // migration logic on top of it (AC4).
    const { loadSettings } = await import('./popup.js');
    const doc = makePopupDoc();
    const storage = makeFakeStorage({ lemmaMode: 'local' });
    await loadSettings(doc, storage.get);
    expect(doc.getElementById('lemmaMode').value).toBe('local');
  });

  it('calls storage.set with { lemmaMode: "server" } when migrating from useLemma: true (write-back)', async () => {
    // The migration must be persisted on first load so subsequent loads read the
    // new key directly and do not re-run migration logic (AC3 write-back).
    const { loadSettings } = await import('./popup.js');
    const doc = makePopupDoc();
    const storage = makeFakeStorage({ useLemma: true });
    await loadSettings(doc, storage.get, storage.set);
    expect(storage.set).toHaveBeenCalled();
    const setArgs = storage.set.mock.calls.flat();
    const persisted = setArgs.find((arg) => arg && typeof arg === 'object' && 'lemmaMode' in arg);
    expect(persisted).toBeDefined();
    expect(persisted.lemmaMode).toBe('server');
  });
});

// ---------------------------------------------------------------------------
// currentSettings emits lemmaMode — AC1
// ---------------------------------------------------------------------------

describe('currentSettings', () => {
  it('returns an object with lemmaMode: "server" when #lemmaMode.value is "server"', async () => {
    // The settings object written to storage must carry the new lemmaMode key
    // rather than the removed useLemma boolean (AC1).
    const { currentSettings } = await import('./popup.js');
    const doc = makePopupDoc();
    doc.getElementById('lemmaMode').value = 'server';
    const result = currentSettings(doc);
    expect(result.lemmaMode).toBe('server');
  });

  it('returns an object with lemmaMode: "off" when #lemmaMode.value is "off"', async () => {
    // All three dropdown values must survive a currentSettings round-trip (AC1).
    const { currentSettings } = await import('./popup.js');
    const doc = makePopupDoc();
    doc.getElementById('lemmaMode').value = 'off';
    const result = currentSettings(doc);
    expect(result.lemmaMode).toBe('off');
  });

  it('returns an object with lemmaMode: "local" when #lemmaMode.value is "local"', async () => {
    // The "local" path must also be captured correctly by currentSettings (AC1).
    const { currentSettings } = await import('./popup.js');
    const doc = makePopupDoc();
    doc.getElementById('lemmaMode').value = 'local';
    const result = currentSettings(doc);
    expect(result.lemmaMode).toBe('local');
  });

  it('does not include a useLemma key in the returned object', async () => {
    // The legacy boolean key must not appear in new saves so there is a single
    // source of truth for lemma mode going forward (AC1).
    const { currentSettings } = await import('./popup.js');
    const doc = makePopupDoc();
    const result = currentSettings(doc);
    expect(result).not.toHaveProperty('useLemma');
  });
});

// ---------------------------------------------------------------------------
// updateLemmaModeUI — AC2
// ---------------------------------------------------------------------------

describe('updateLemmaModeUI', () => {
  it('removes the "hidden" class from #importDictRow when mode is "local"', async () => {
    // The import controls must be visible only in "local" mode so the user can
    // supply the dictionary file (AC2).
    const { updateLemmaModeUI } = await import('./popup.js');
    const doc = makePopupDoc();
    updateLemmaModeUI(doc, 'local');
    expect(doc.getElementById('importDictRow').classList.contains('hidden')).toBe(false);
  });

  it('adds the "hidden" class to #importDictRow when mode is "off"', async () => {
    // In "off" mode no dictionary is needed; the import row must be hidden (AC2).
    const { updateLemmaModeUI } = await import('./popup.js');
    const doc = makePopupDoc();
    // Start with hidden absent to verify the function adds it
    doc.getElementById('importDictRow').classList.remove('hidden');
    updateLemmaModeUI(doc, 'off');
    expect(doc.getElementById('importDictRow').classList.contains('hidden')).toBe(true);
  });

  it('adds the "hidden" class to #importDictRow when mode is "server"', async () => {
    // In "server" mode the dictionary is served by the local Python process, not
    // imported in-browser; the import row must remain hidden (AC2).
    const { updateLemmaModeUI } = await import('./popup.js');
    const doc = makePopupDoc();
    doc.getElementById('importDictRow').classList.remove('hidden');
    updateLemmaModeUI(doc, 'server');
    expect(doc.getElementById('importDictRow').classList.contains('hidden')).toBe(true);
  });

  it('toggles back to hidden when called with "off" after being called with "local"', async () => {
    // The function must handle the mode being changed back; switching away from
    // "local" must re-hide the import row (AC2).
    const { updateLemmaModeUI } = await import('./popup.js');
    const doc = makePopupDoc();
    updateLemmaModeUI(doc, 'local');
    expect(doc.getElementById('importDictRow').classList.contains('hidden')).toBe(false);
    updateLemmaModeUI(doc, 'off');
    expect(doc.getElementById('importDictRow').classList.contains('hidden')).toBe(true);
  });
});
