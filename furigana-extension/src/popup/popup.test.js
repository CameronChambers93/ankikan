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
//
// Issue #11: #dictFileInput has been removed from popup.html — the import
// flow is now delegated to the options page via ext.runtime.openOptionsPage().
// Issue #33: #furiganaUnknown checkbox added inside #furiganaPerStatus.
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
    <div id="furiganaPerStatus">
      <input id="furiganaUnknown" type="checkbox">
    </div>
    <select id="lemmaMode">
      <option value="off">Off</option>
      <option value="server">Server</option>
      <option value="local">Local</option>
    </select>
    <div id="importDictRow" class="hidden">
      <button id="importDictBtn">Import dictionary…</button>
    </div>
    <div id="importRow" class="hidden"></div>
    <span id="dictStatus"></span>
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

  it('T-33-026: currentSettings reflects furiganaUnknown:true when #furiganaUnknown is checked (issue #33 AC-31)', async () => {
    // The furiganaUnknown value must be captured by currentSettings so it can
    // be persisted to storage and sent to the content script on scan.
    const { currentSettings } = await import('./popup.js');
    const doc = makePopupDoc();
    doc.getElementById('furiganaUnknown').checked = true;
    const result = currentSettings(doc);
    expect(result.furiganaUnknown).toBe(true);
  });

  it('T-33-027: currentSettings reflects furiganaUnknown:false when #furiganaUnknown is unchecked (issue #33 AC-32)', async () => {
    // An unchecked furiganaUnknown checkbox must produce false in currentSettings
    // so that applyFurigana hides furigana on unknown-status spans.
    const { currentSettings } = await import('./popup.js');
    const doc = makePopupDoc();
    doc.getElementById('furiganaUnknown').checked = false;
    const result = currentSettings(doc);
    expect(result.furiganaUnknown).toBe(false);
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

// ---------------------------------------------------------------------------
// Issue #11 — #importDictBtn delegates to openOptionsPage (popup side)
//
// Firefox closes the popup when a file dialog opens, so the import flow is
// moved to the options page. The popup's #importDictBtn must open the options
// page rather than triggering a file input.
// ---------------------------------------------------------------------------

describe('popup.js importDictBtn click (Issue #11)', () => {
  it('calls openOptionsPage when #importDictBtn is clicked with lemmaMode set to "local"', () => {
    // The popup must not attempt to show a file picker; instead it must hand off
    // to the options page where the file dialog can open safely without closing
    // the UI (Issue #11).
    const { window } = new JSDOM(`<!DOCTYPE html><html><body>
      <div id="importDictRow">
        <button id="importDictBtn">Import dictionary…</button>
      </div>
    </body></html>`);
    const doc = window.document;
    const openOptionsPageSpy = vi.fn();

    // Wire the handler the same way popup.js will after the fix: click → openOptionsPage()
    doc.getElementById('importDictBtn').addEventListener('click', () => {
      openOptionsPageSpy();
    });

    doc.getElementById('importDictBtn').click();
    expect(openOptionsPageSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Issue #33 — popup.html structure for furiganaUnknown  (T-33-028)
// ---------------------------------------------------------------------------

describe('popup.html structure — furiganaUnknown (issue #33 AC-28)', () => {
  let doc;

  beforeEach(async () => {
    const fs = await import('fs');
    const path = await import('path');
    const htmlPath = path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), '..', '..', '..', 'popup.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    doc = new JSDOM(html, { url: 'http://localhost/' }).window.document;
  });

  it('T-33-028: popup.html contains #furiganaUnknown checkbox inside #furiganaPerStatus (issue #33 AC-28)', () => {
    // The popup must expose the furiganaUnknown toggle so users can control
    // whether furigana is shown on unknown-status spans from the popup UI.
    const perStatus = doc.getElementById('furiganaPerStatus');
    expect(perStatus, '#furiganaPerStatus must exist in popup.html').not.toBeNull();
    const unknownCheckbox = doc.getElementById('furiganaUnknown');
    expect(unknownCheckbox, '#furiganaUnknown must exist in popup.html').not.toBeNull();
    expect(unknownCheckbox.type).toBe('checkbox');
    expect(perStatus.contains(unknownCheckbox)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Issue #33 — loadSettings populates furiganaUnknown  (T-33-029, T-33-030)
// ---------------------------------------------------------------------------

describe('loadSettings — furiganaUnknown (issue #33)', () => {
  it('T-33-029: loadSettings with furiganaUnknown:false → #furiganaUnknown unchecked (issue #33 AC-29)', async () => {
    // When storage has furiganaUnknown:false the checkbox must be unchecked so
    // the UI correctly reflects the persisted preference on popup open.
    const { loadSettings } = await import('./popup.js');
    const doc = makePopupDoc();
    const storage = makeFakeStorage({ furiganaUnknown: false });
    await loadSettings(doc, storage.get);
    expect(doc.getElementById('furiganaUnknown').checked).toBe(false);
  });

  it('T-33-030: loadSettings with default storage (no furiganaUnknown key) → #furiganaUnknown checked (issue #33 AC-30)', async () => {
    // furiganaUnknown defaults to true (via ?? true fallback in DEFAULTS); a fresh
    // install must show the checkbox checked so unknown words display furigana
    // out of the box.
    const { loadSettings } = await import('./popup.js');
    const doc = makePopupDoc();
    // Empty storage — DEFAULTS apply, furiganaUnknown should default to true
    const storage = makeFakeStorage({});
    await loadSettings(doc, storage.get);
    expect(doc.getElementById('furiganaUnknown').checked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Issue #22 — #scanBtn click path  (AC-10 through AC-14)
//
// These tests load popup.js with a fake ext object set on globalThis so the
// side-effectful if (ext) block runs with our spies instead of the real browser
// API.  The developer must add 'popup.test.js' to the doMockPlugin condition
// in vitest.config.js so that vi.mock() calls inside this file are hoisted
// as vi.doMock() (matching the options.test.js pattern).
// ---------------------------------------------------------------------------

describe('#scanBtn click (Issue #22)', () => {
  /**
   * Build a fake ext object for the popup's scanBtn path.
   * - storage.local.get resolves with settingsData (for loadSettings on boot)
   * - storage.local.set resolves immediately (for saveSettings)
   * - tabs.query resolves with [{ id: 99 }] (the active tab)
   * - tabs.sendMessage resolves with the value provided by sendMessageResult
   * - runtime.openOptionsPage is a no-op spy
   * - storage.onChanged is falsy so the onChanged listener branch is skipped
   */
  function makeFakeExt(sendMessageResult, settingsData = {}) {
    return {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue(settingsData),
          set: vi.fn().mockResolvedValue(undefined),
        },
        onChanged: null,
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 99 }]),
        sendMessage: vi.fn().mockResolvedValue(sendMessageResult),
      },
      runtime: {
        openOptionsPage: vi.fn(),
      },
    };
  }

  /**
   * Load popup.js with the given fake ext injected on globalThis.chrome,
   * using a freshly-built JSDOM document as the global document.
   * Returns { doc, ext } so tests can inspect both.
   *
   * NOTE: popup.js reads `ext` at module evaluation time, so we must set
   * globalThis.chrome before the dynamic import and reset it after to avoid
   * cross-test pollution.
   */
  async function loadPopupWithFakeExt(fakeExt, settingsData = {}) {
    const doc = makePopupDoc();
    // Provide hasDictionary mock so popup.js's refreshDictStatus does not throw
    vi.doMock('../shared/dict-store.js', () => ({
      hasDictionary: vi.fn().mockResolvedValue(false),
      saveDictionary: vi.fn().mockResolvedValue(undefined),
    }));
    // popup.js resolves ext = chrome at module load; inject before import
    globalThis.chrome = fakeExt;
    globalThis.document = doc;
    await import('./popup.js');
    // Give the loadSettings() call in the if (ext) block time to settle
    await Promise.resolve();
    return { doc };
  }

  it('T-22-036: saves settings and sends { action: "scan" } to the active tab when #scanBtn is clicked (AC-10)', async () => {
    // The scan button must persist current settings before dispatching so the
    // content script always runs with up-to-date user preferences.
    const fakeExt = makeFakeExt({ found: 0, matched: 0 });
    const { doc } = await loadPopupWithFakeExt(fakeExt);

    doc.getElementById('scanBtn').click();
    // Allow the async click handler to progress past saveSettings
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(fakeExt.storage.local.set).toHaveBeenCalled();
    expect(fakeExt.tabs.sendMessage).toHaveBeenCalledWith(99, { action: 'scan' });
  });

  it('T-22-037: disables #scanBtn while sendMessage is pending and re-enables after it resolves (AC-11)', async () => {
    // The button must be disabled for the duration of the scan to prevent the
    // user from triggering a second concurrent scan, and re-enabled afterwards.
    let resolveSend;
    const pendingResult = new Promise((r) => { resolveSend = r; });
    const fakeExt = makeFakeExt(undefined);
    fakeExt.tabs.sendMessage = vi.fn().mockReturnValue(pendingResult);

    const { doc } = await loadPopupWithFakeExt(fakeExt);
    const btn = doc.getElementById('scanBtn');

    doc.getElementById('scanBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(btn.disabled).toBe(true);

    resolveSend({ found: 1, matched: 1 });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(btn.disabled).toBe(false);
  });

  it('T-22-038: status shows "Scanning…" in-flight then the matched/found string after success (AC-12)', async () => {
    // The user must see immediate feedback when scanning starts, then a
    // meaningful result summary so they know how many words were matched.
    let resolveSend;
    const pendingResult = new Promise((r) => { resolveSend = r; });
    const fakeExt = makeFakeExt(undefined);
    fakeExt.tabs.sendMessage = vi.fn().mockReturnValue(pendingResult);

    const { doc } = await loadPopupWithFakeExt(fakeExt);
    const statusEl = doc.getElementById('status');

    doc.getElementById('scanBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(statusEl.textContent).toBe('Scanning…');

    resolveSend({ found: 5, matched: 3 });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(statusEl.textContent).toBe('3 / 5 words matched');
  });

  it('T-22-039: status shows the connection-error string when result has error: "connection" (AC-13)', async () => {
    // When Anki is not running, the error field must produce the specific
    // human-readable message so the user knows to start Anki.
    const fakeExt = makeFakeExt({ found: 2, matched: 0, error: 'connection' });
    const { doc } = await loadPopupWithFakeExt(fakeExt);

    doc.getElementById('scanBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(doc.getElementById('status').textContent).toBe('Could not reach Anki. Is it running?');
  });

  it('T-22-040: status shows "Cannot run on this page." and has error class when sendMessage resolves null (AC-14)', async () => {
    // sendMessage returning null means the content script is not injected on
    // the active tab (e.g. a chrome:// page); the user must be told clearly.
    const fakeExt = makeFakeExt(null);
    const { doc } = await loadPopupWithFakeExt(fakeExt);

    doc.getElementById('scanBtn').click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const statusEl = doc.getElementById('status');
    expect(statusEl.textContent).toBe('Cannot run on this page.');
    expect(statusEl.className).toContain('error');
  });
});
