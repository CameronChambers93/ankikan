import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { STYLE_DEFAULTS, BUILT_IN_STYLE_FALLBACK } from '../shared/style-util.js';

// options.js does not exist yet — dynamic imports below will throw until it is created.
// Using dynamic import inside each test means individual tests fail with a meaningful
// error rather than the entire suite refusing to collect.

// ---------------------------------------------------------------------------
// Helper — build a JSDOM document that mirrors the options.html input contract.
// All input IDs are the DOM contract shared between options.html and options.js.
// Issue #11 adds: #importDictBtn, #dictFileInput, #dictStatus
// Issue #33 adds: #unknown-bg-color-enabled, #unknown-bg-color, #unknown-bg-opacity
// ---------------------------------------------------------------------------

function makeOptionsDoc({
  globalBgColor = '#808080',
  globalBgOpacity = '0.22',
  globalBorderRadius = '3',
  globalOutlineColor = '#808080',
  globalOutlineOpacity = '0.35',
  globalOutlineWidth = '1',
  unlearnedEnabled = false,
  unlearnedBgColor = '#808080',
  unlearnedBgOpacity = '',
  learningEnabled = false,
  learningBgColor = '#808080',
  learningBgOpacity = '',
  learnedEnabled = false,
  learnedBgColor = '#808080',
  learnedBgOpacity = '',
  unknownEnabled = false,
  unknownBgColor = '#808080',
  unknownBgOpacity = '',
} = {}) {
  const { window } = new JSDOM(`<!DOCTYPE html><html><body>
    <input id="global-bg-color"        type="color"   value="${globalBgColor}">
    <input id="global-bg-opacity"      type="number"  value="${globalBgOpacity}">
    <input id="global-border-radius"   type="number"  value="${globalBorderRadius}">
    <input id="global-outline-color"   type="color"   value="${globalOutlineColor}">
    <input id="global-outline-opacity" type="number"  value="${globalOutlineOpacity}">
    <input id="global-outline-width"   type="number"  value="${globalOutlineWidth}">

    <input id="unlearned-bg-color-enabled" type="checkbox" ${unlearnedEnabled ? 'checked' : ''}>
    <input id="unlearned-bg-color"         type="color"   value="${unlearnedBgColor}" ${unlearnedEnabled ? '' : 'disabled'}>
    <input id="unlearned-bg-opacity"       type="number"  value="${unlearnedBgOpacity}">

    <input id="learning-bg-color-enabled"  type="checkbox" ${learningEnabled ? 'checked' : ''}>
    <input id="learning-bg-color"          type="color"   value="${learningBgColor}" ${learningEnabled ? '' : 'disabled'}>
    <input id="learning-bg-opacity"        type="number"  value="${learningBgOpacity}">

    <input id="learned-bg-color-enabled"   type="checkbox" ${learnedEnabled ? 'checked' : ''}>
    <input id="learned-bg-color"           type="color"   value="${learnedBgColor}" ${learnedEnabled ? '' : 'disabled'}>
    <input id="learned-bg-opacity"         type="number"  value="${learnedBgOpacity}">

    <input id="unknown-bg-color-enabled"   type="checkbox" ${unknownEnabled ? 'checked' : ''}>
    <input id="unknown-bg-color"           type="color"   value="${unknownBgColor}" ${unknownEnabled ? '' : 'disabled'}>
    <input id="unknown-bg-opacity"         type="number"  value="${unknownBgOpacity}">

    <button id="resetStylesBtn">Reset to defaults</button>

    <button id="importDictBtn" type="button">Import dictionary…</button>
    <input id="dictFileInput" type="file" accept=".zip" style="display:none">
    <span id="dictStatus"></span>
  </body></html>`);
  return window.document;
}

// ---------------------------------------------------------------------------
// AC4 — loadStyleSettings populates DOM from storage
// ---------------------------------------------------------------------------

describe('loadStyleSettings (AC4)', () => {
  it('populates the global background colour input from storage', async () => {
    // loadStyleSettings must read the stored value and write it into the DOM so
    // the options page reflects persisted settings on open.
    const { loadStyleSettings } = await import('./options.js');
    const doc = makeOptionsDoc();
    const stored = {
      ...STYLE_DEFAULTS.styleSettings,
      default: { ...STYLE_DEFAULTS.styleSettings.default, backgroundColor: '#ff3300' },
    };
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: stored });
    await loadStyleSettings(doc, storageGet);
    expect(doc.getElementById('global-bg-color').value).toBe('#ff3300');
  });

  it('populates the global background opacity input from storage', async () => {
    // Opacity is a number that must survive a round-trip through storage and
    // appear in the input so the user sees their saved preference.
    const { loadStyleSettings } = await import('./options.js');
    const doc = makeOptionsDoc();
    const stored = {
      ...STYLE_DEFAULTS.styleSettings,
      default: { ...STYLE_DEFAULTS.styleSettings.default, backgroundOpacity: 0.55 },
    };
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: stored });
    await loadStyleSettings(doc, storageGet);
    expect(Number(doc.getElementById('global-bg-opacity').value)).toBe(0.55);
  });

  it('populates the global border radius input from storage', async () => {
    // Border radius is a distinct setting; it must be individually restored.
    const { loadStyleSettings } = await import('./options.js');
    const doc = makeOptionsDoc();
    const stored = {
      ...STYLE_DEFAULTS.styleSettings,
      default: { ...STYLE_DEFAULTS.styleSettings.default, borderRadius: 8 },
    };
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: stored });
    await loadStyleSettings(doc, storageGet);
    expect(Number(doc.getElementById('global-border-radius').value)).toBe(8);
  });

  it('checks the per-category enable checkbox and populates colour when a category override exists', async () => {
    // When storage contains a backgroundColor for a category, the checkbox must
    // be checked and the colour input enabled with the stored value.
    const { loadStyleSettings } = await import('./options.js');
    const doc = makeOptionsDoc();
    const stored = {
      ...STYLE_DEFAULTS.styleSettings,
      unlearned: { backgroundColor: '#aabbcc', backgroundOpacity: 0.4 },
    };
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: stored });
    await loadStyleSettings(doc, storageGet);
    expect(doc.getElementById('unlearned-bg-color-enabled').checked).toBe(true);
    expect(doc.getElementById('unlearned-bg-color').value).toBe('#aabbcc');
    expect(doc.getElementById('unlearned-bg-color').disabled).toBe(false);
  });

  it('leaves per-category enable checkbox unchecked when storage has no backgroundColor for that category', async () => {
    // An absent backgroundColor key means no override; the checkbox must
    // remain unchecked so the global default is used.
    const { loadStyleSettings } = await import('./options.js');
    const doc = makeOptionsDoc();
    const stored = { ...STYLE_DEFAULTS.styleSettings, learning: {} };
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: stored });
    await loadStyleSettings(doc, storageGet);
    expect(doc.getElementById('learning-bg-color-enabled').checked).toBe(false);
    expect(doc.getElementById('learning-bg-color').disabled).toBe(true);
  });

  it('falls back to STYLE_DEFAULTS when storage returns no styleSettings', async () => {
    // A fresh install has nothing in storage; defaults must be applied so the
    // page is not blank or broken.
    const { loadStyleSettings } = await import('./options.js');
    const doc = makeOptionsDoc({ globalBgColor: '#000000', globalBgOpacity: '0' });
    const storageGet = vi.fn().mockResolvedValue({});
    await loadStyleSettings(doc, storageGet);
    expect(doc.getElementById('global-bg-color').value).toBe(STYLE_DEFAULTS.styleSettings.default.backgroundColor);
    expect(Number(doc.getElementById('global-bg-opacity').value)).toBe(STYLE_DEFAULTS.styleSettings.default.backgroundOpacity);
  });

  it('T-33-020: loadStyleSettings with unknown:{backgroundColor:"#808080"} → unknown enable checkbox checked and colour #808080 (issue #33 AC-23)', async () => {
    // When storage contains a backgroundColor for the unknown category, the
    // checkbox must be checked and the colour input must show the stored value.
    const { loadStyleSettings } = await import('./options.js');
    const doc = makeOptionsDoc();
    const stored = {
      ...STYLE_DEFAULTS.styleSettings,
      unknown: { backgroundColor: '#808080' },
    };
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: stored });
    await loadStyleSettings(doc, storageGet);
    expect(doc.getElementById('unknown-bg-color-enabled').checked).toBe(true);
    expect(doc.getElementById('unknown-bg-color').value).toBe('#808080');
    expect(doc.getElementById('unknown-bg-color').disabled).toBe(false);
  });

  it('T-33-021: loadStyleSettings with unknown:{} → unknown enable checkbox unchecked and colour input disabled (issue #33 AC-24)', async () => {
    // An empty unknown override means "inherit from global default"; the checkbox
    // must be unchecked and the input disabled so no spurious override is stored.
    const { loadStyleSettings } = await import('./options.js');
    const doc = makeOptionsDoc();
    const stored = { ...STYLE_DEFAULTS.styleSettings, unknown: {} };
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: stored });
    await loadStyleSettings(doc, storageGet);
    expect(doc.getElementById('unknown-bg-color-enabled').checked).toBe(false);
    expect(doc.getElementById('unknown-bg-color').disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC5 — currentStyleSettings reads DOM and returns correct shape
// ---------------------------------------------------------------------------

describe('currentStyleSettings (AC5)', () => {
  it('returns an object with a "default" key containing all six global fields', async () => {
    // The returned shape must be ready to pass directly to chrome.storage.local.set.
    const { currentStyleSettings } = await import('./options.js');
    const doc = makeOptionsDoc();
    const result = currentStyleSettings(doc);
    expect(result).toHaveProperty('default');
    expect(result.default).toHaveProperty('backgroundColor');
    expect(result.default).toHaveProperty('backgroundOpacity');
    expect(result.default).toHaveProperty('borderRadius');
    expect(result.default).toHaveProperty('outlineColor');
    expect(result.default).toHaveProperty('outlineOpacity');
    expect(result.default).toHaveProperty('outlineWidth');
  });

  it('returns per-category keys for unlearned, learning, and learned', async () => {
    // All three category keys must always be present even when overrides are empty.
    const { currentStyleSettings } = await import('./options.js');
    const doc = makeOptionsDoc();
    const result = currentStyleSettings(doc);
    expect(result).toHaveProperty('unlearned');
    expect(result).toHaveProperty('learning');
    expect(result).toHaveProperty('learned');
  });

  it('reads the global background colour from the DOM input', async () => {
    // The value the user sees must be exactly what gets persisted.
    const { currentStyleSettings } = await import('./options.js');
    const doc = makeOptionsDoc({ globalBgColor: '#112233' });
    const result = currentStyleSettings(doc);
    expect(result.default.backgroundColor).toBe('#112233');
  });

  it('reads backgroundOpacity as a Number, not a string', async () => {
    // Storage consumers (buildStyleSheet) expect a numeric opacity; a string
    // would produce NaN in rgba() calculations.
    const { currentStyleSettings } = await import('./options.js');
    const doc = makeOptionsDoc({ globalBgOpacity: '0.44' });
    const result = currentStyleSettings(doc);
    expect(typeof result.default.backgroundOpacity).toBe('number');
    expect(result.default.backgroundOpacity).toBe(0.44);
  });

  it('includes backgroundColor in the category object when the enable checkbox is checked', async () => {
    // A checked override means the user has explicitly chosen a per-category
    // colour; it must appear in the returned object so it can be persisted.
    const { currentStyleSettings } = await import('./options.js');
    const doc = makeOptionsDoc({ unlearnedEnabled: true, unlearnedBgColor: '#ff0000' });
    const result = currentStyleSettings(doc);
    expect(result.unlearned).toHaveProperty('backgroundColor', '#ff0000');
  });

  it('omits backgroundColor from the category object when the enable checkbox is unchecked', async () => {
    // An unchecked override means the category inherits from the global default;
    // including a backgroundColor key would override the inheritance.
    const { currentStyleSettings } = await import('./options.js');
    const doc = makeOptionsDoc({ unlearnedEnabled: false, unlearnedBgColor: '#ff0000' });
    const result = currentStyleSettings(doc);
    expect(result.unlearned).not.toHaveProperty('backgroundColor');
  });

  it('includes backgroundOpacity in the category object when the opacity input is non-empty', async () => {
    // A non-empty opacity input is an intentional per-category override.
    const { currentStyleSettings } = await import('./options.js');
    const doc = makeOptionsDoc({ learningEnabled: true, learningBgOpacity: '0.7' });
    const result = currentStyleSettings(doc);
    expect(result.learning).toHaveProperty('backgroundOpacity', 0.7);
  });

  it('omits backgroundOpacity from the category object when the opacity input is empty', async () => {
    // An empty input means "no override"; including it would erroneously write
    // 0 or NaN into storage.
    const { currentStyleSettings } = await import('./options.js');
    const doc = makeOptionsDoc({ learningBgOpacity: '' });
    const result = currentStyleSettings(doc);
    expect(result.learning).not.toHaveProperty('backgroundOpacity');
  });

  it('T-33-022: currentStyleSettings with #unknown-bg-color-enabled checked and value #334455 → result.unknown.backgroundColor === "#334455" (issue #33 AC-25)', async () => {
    // When the unknown override checkbox is checked, the colour value must be
    // captured in the returned settings object so it can be persisted correctly.
    const { currentStyleSettings } = await import('./options.js');
    const doc = makeOptionsDoc({ unknownEnabled: true, unknownBgColor: '#334455' });
    const result = currentStyleSettings(doc);
    expect(result.unknown).toHaveProperty('backgroundColor', '#334455');
  });

  it('T-33-023: currentStyleSettings with #unknown-bg-color-enabled unchecked → result.unknown has no backgroundColor (issue #33 AC-26)', async () => {
    // An unchecked unknown enable means no override; storing backgroundColor
    // would prevent the fallback from ever being used.
    const { currentStyleSettings } = await import('./options.js');
    const doc = makeOptionsDoc({ unknownEnabled: false, unknownBgColor: '#334455' });
    const result = currentStyleSettings(doc);
    expect(result.unknown).not.toHaveProperty('backgroundColor');
  });
});

// ---------------------------------------------------------------------------
// AC6 — onStyleChange persists to storage with correct shape
// ---------------------------------------------------------------------------

describe('onStyleChange (AC6)', () => {
  it('calls storageSet with a { styleSettings } object', async () => {
    // Persistence must use the same top-level key as the rest of the extension
    // so storage reads in content.js and popup.js continue to work.
    const { onStyleChange } = await import('./options.js');
    const doc = makeOptionsDoc();
    const storageSet = vi.fn().mockResolvedValue(undefined);
    await onStyleChange(doc, storageSet, vi.fn());
    expect(storageSet).toHaveBeenCalledOnce();
    const arg = storageSet.mock.calls[0][0];
    expect(arg).toHaveProperty('styleSettings');
  });

  it('persists the exact global background colour that is in the DOM', async () => {
    // There must be no transformation between the colour picker value and storage.
    const { onStyleChange } = await import('./options.js');
    const doc = makeOptionsDoc({ globalBgColor: '#123456' });
    const storageSet = vi.fn().mockResolvedValue(undefined);
    await onStyleChange(doc, storageSet, vi.fn());
    const { styleSettings } = storageSet.mock.calls[0][0];
    expect(styleSettings.default.backgroundColor).toBe('#123456');
  });

  it('calls messageFn with { action: "refreshStyles", styleSettings } so the page updates immediately', async () => {
    // The active tab must receive the new settings in real time without a reload.
    const { onStyleChange } = await import('./options.js');
    const doc = makeOptionsDoc();
    const messageSpy = vi.fn();
    await onStyleChange(doc, vi.fn().mockResolvedValue(undefined), messageSpy);
    expect(messageSpy).toHaveBeenCalledOnce();
    const msg = messageSpy.mock.calls[0][0];
    expect(msg.action).toBe('refreshStyles');
    expect(msg).toHaveProperty('styleSettings');
  });

  it('the styleSettings passed to messageFn matches the styleSettings passed to storageSet', async () => {
    // Storage and the live tab must always receive identical data to prevent
    // the options page and highlighted page drifting out of sync.
    const { onStyleChange } = await import('./options.js');
    const doc = makeOptionsDoc({ globalBgColor: '#abcdef', globalBgOpacity: '0.33' });
    const storageSet = vi.fn().mockResolvedValue(undefined);
    const messageSpy = vi.fn();
    await onStyleChange(doc, storageSet, messageSpy);
    expect(storageSet.mock.calls[0][0].styleSettings)
      .toEqual(messageSpy.mock.calls[0][0].styleSettings);
  });
});

// ---------------------------------------------------------------------------
// AC7 — per-category enable checkbox unchecked removes backgroundColor from storage
// ---------------------------------------------------------------------------

describe('per-category enable checkbox unchecked (AC7)', () => {
  it('styleSettings.unlearned has no backgroundColor key when unlearned-bg-color-enabled is unchecked', async () => {
    // The absence of the key signals "inherit from global default"; writing
    // #000000 (the unchecked colour-picker default) would silently break styling.
    const { onStyleChange } = await import('./options.js');
    const doc = makeOptionsDoc({
      unlearnedEnabled: false,
      unlearnedBgColor: '#ff0000',
    });
    const storageSet = vi.fn().mockResolvedValue(undefined);
    await onStyleChange(doc, storageSet, vi.fn());
    const { styleSettings } = storageSet.mock.calls[0][0];
    expect(styleSettings.unlearned).not.toHaveProperty('backgroundColor');
  });

  it('styleSettings.learning has no backgroundColor key when learning-bg-color-enabled is unchecked', async () => {
    // Same guard for the learning category.
    const { onStyleChange } = await import('./options.js');
    const doc = makeOptionsDoc({
      learningEnabled: false,
      learningBgColor: '#00ff00',
    });
    const storageSet = vi.fn().mockResolvedValue(undefined);
    await onStyleChange(doc, storageSet, vi.fn());
    const { styleSettings } = storageSet.mock.calls[0][0];
    expect(styleSettings.learning).not.toHaveProperty('backgroundColor');
  });

  it('styleSettings.learned has no backgroundColor key when learned-bg-color-enabled is unchecked', async () => {
    // Same guard for the learned category.
    const { onStyleChange } = await import('./options.js');
    const doc = makeOptionsDoc({
      learnedEnabled: false,
      learnedBgColor: '#0000ff',
    });
    const storageSet = vi.fn().mockResolvedValue(undefined);
    await onStyleChange(doc, storageSet, vi.fn());
    const { styleSettings } = storageSet.mock.calls[0][0];
    expect(styleSettings.learned).not.toHaveProperty('backgroundColor');
  });

  it('styleSettings.unlearned retains backgroundColor when unlearned-bg-color-enabled is checked', async () => {
    // When the override is active the colour must be present in storage.
    const { onStyleChange } = await import('./options.js');
    const doc = makeOptionsDoc({
      unlearnedEnabled: true,
      unlearnedBgColor: '#cc0000',
    });
    const storageSet = vi.fn().mockResolvedValue(undefined);
    await onStyleChange(doc, storageSet, vi.fn());
    const { styleSettings } = storageSet.mock.calls[0][0];
    expect(styleSettings.unlearned).toHaveProperty('backgroundColor', '#cc0000');
  });
});

// ---------------------------------------------------------------------------
// AC8 — reset handler restores defaults
// ---------------------------------------------------------------------------

describe('options.js reset handler (AC8)', () => {
  it('resets global-bg-color to STYLE_DEFAULTS value after reset is triggered', async () => {
    // The reset must write the STYLE_DEFAULTS values back into the DOM so the
    // user sees the canonical defaults immediately.
    const { resetOptionsToDefaults } = await import('./options.js');
    const doc = makeOptionsDoc({ globalBgColor: '#ff0000', globalBgOpacity: '0.99' });
    const storageSet = vi.fn().mockResolvedValue(undefined);
    await resetOptionsToDefaults(doc, storageSet, vi.fn());
    expect(doc.getElementById('global-bg-color').value).toBe(STYLE_DEFAULTS.styleSettings.default.backgroundColor);
  });

  it('persists STYLE_DEFAULTS to storage on reset', async () => {
    // The reset must not just update the DOM; it must also write defaults to
    // storage so other extension pages and the content script pick up the change.
    const { resetOptionsToDefaults } = await import('./options.js');
    const doc = makeOptionsDoc({ globalBgColor: '#ff0000' });
    const storageSet = vi.fn().mockResolvedValue(undefined);
    await resetOptionsToDefaults(doc, storageSet, vi.fn());
    expect(storageSet).toHaveBeenCalledOnce();
    expect(storageSet.mock.calls[0][0].styleSettings.default.backgroundColor)
      .toBe(STYLE_DEFAULTS.styleSettings.default.backgroundColor);
  });

  it('unchecks all per-category enable checkboxes on reset', async () => {
    // Defaults have no per-category overrides; the checkboxes must reflect this.
    const { resetOptionsToDefaults } = await import('./options.js');
    const doc = makeOptionsDoc({
      unlearnedEnabled: true,
      learningEnabled: true,
      learnedEnabled: true,
    });
    await resetOptionsToDefaults(doc, vi.fn().mockResolvedValue(undefined), vi.fn());
    expect(doc.getElementById('unlearned-bg-color-enabled').checked).toBe(false);
    expect(doc.getElementById('learning-bg-color-enabled').checked).toBe(false);
    expect(doc.getElementById('learned-bg-color-enabled').checked).toBe(false);
  });

  it('sends a refreshStyles message after reset so the active tab updates immediately', async () => {
    // Without this message the page keeps the old highlight colours until
    // the user triggers a re-scan.
    const { resetOptionsToDefaults } = await import('./options.js');
    const doc = makeOptionsDoc();
    const messageSpy = vi.fn();
    await resetOptionsToDefaults(doc, vi.fn().mockResolvedValue(undefined), messageSpy);
    expect(messageSpy).toHaveBeenCalledOnce();
    expect(messageSpy.mock.calls[0][0].action).toBe('refreshStyles');
  });

  it('T-33-024: resetOptionsToDefaults unchecks #unknown-bg-color-enabled and disables #unknown-bg-color (issue #33 AC-27)', async () => {
    // The reset must also clear the unknown override checkbox and disable the
    // colour input so the unknown category falls back to its built-in grey.
    const { resetOptionsToDefaults } = await import('./options.js');
    const doc = makeOptionsDoc({ unknownEnabled: true, unknownBgColor: '#aabbcc' });
    await resetOptionsToDefaults(doc, vi.fn().mockResolvedValue(undefined), vi.fn());
    expect(doc.getElementById('unknown-bg-color-enabled').checked).toBe(false);
    expect(doc.getElementById('unknown-bg-color').disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC4 (popup.js) — clicking #openOptionsBtn calls chrome.runtime.openOptionsPage
// ---------------------------------------------------------------------------

describe('popup.js openOptionsBtn click (AC4 popup)', () => {
  it('openOptionsPage is called when #openOptionsBtn is clicked', async () => {
    // The popup must delegate to the browser API rather than navigating directly
    // so it works in both Chrome and Firefox (WebExtension API parity).
    const { window } = new JSDOM(`<!DOCTYPE html><html><body>
      <button id="openOptionsBtn">Highlight Style settings</button>
    </body></html>`);
    const doc = window.document;
    const openOptionsPageSpy = vi.fn();

    // Wire the handler the same way popup.js will: click → openOptionsPage()
    doc.getElementById('openOptionsBtn').addEventListener('click', () => {
      openOptionsPageSpy();
    });

    doc.getElementById('openOptionsBtn').click();
    expect(openOptionsPageSpy).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Issue #11 — onImportDict is exported from options.js and handles zip import
//
// The dictionary import flow moves from popup.js to options.js so that the
// file dialog can open without closing the popup (Firefox bug).
// ---------------------------------------------------------------------------

describe('onImportDict (Issue #11)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('sets #dictStatus to "Loaded" when zip contains all required files and save succeeds', async () => {
    // A fully valid zip archive must result in a visible "Loaded" status so the
    // user has confirmation that the dictionary was imported successfully.
    vi.mock('../shared/dict-store.js', () => ({
      saveDictionary: vi.fn().mockResolvedValue(undefined),
      hasDictionary: vi.fn().mockResolvedValue(true),
    }));

    // All 12 required kuromoji filenames present in the zip
    const REQUIRED = [
      'base.dat.gz', 'cc.dat.gz', 'check.dat.gz', 'tid.dat.gz', 'tid_map.dat.gz',
      'tid_pos.dat.gz', 'unk.dat.gz', 'unk_char.dat.gz', 'unk_compat.dat.gz',
      'unk_invoke.dat.gz', 'unk_map.dat.gz', 'unk_pos.dat.gz',
    ];
    const fakeEntries = REQUIRED.map((name) => ({
      directory: false,
      filename: name,
      getData: vi.fn().mockResolvedValue(new Blob(['data'])),
    }));

    vi.mock('@zip.js/zip.js', () => ({
      ZipReader: vi.fn().mockImplementation(() => ({
        getEntries: vi.fn().mockResolvedValue(fakeEntries),
        close: vi.fn().mockResolvedValue(undefined),
      })),
      BlobReader: vi.fn(),
      BlobWriter: vi.fn(),
    }));

    const { onImportDict } = await import('./options.js');
    const doc = makeOptionsDoc();
    const fakeFile = new Blob(['zip content'], { type: 'application/zip' });
    await onImportDict(doc, fakeFile);
    expect(doc.getElementById('dictStatus').textContent).toBe('Loaded');
  });

  it('sets #dictStatus to "Missing: unk_pos.dat.gz" and does not call saveDictionary when unk_pos.dat.gz is absent', async () => {
    // An incomplete archive must be rejected before writing to IndexedDB; the
    // status must name the specific missing file so the user can diagnose the problem.
    const saveDictionaryMock = vi.fn().mockResolvedValue(undefined);
    vi.mock('../shared/dict-store.js', () => ({
      saveDictionary: saveDictionaryMock,
      hasDictionary: vi.fn().mockResolvedValue(false),
    }));

    // All required files EXCEPT unk_pos.dat.gz
    const INCOMPLETE = [
      'base.dat.gz', 'cc.dat.gz', 'check.dat.gz', 'tid.dat.gz', 'tid_map.dat.gz',
      'tid_pos.dat.gz', 'unk.dat.gz', 'unk_char.dat.gz', 'unk_compat.dat.gz',
      'unk_invoke.dat.gz', 'unk_map.dat.gz',
      // unk_pos.dat.gz deliberately absent
    ];
    const fakeEntries = INCOMPLETE.map((name) => ({
      directory: false,
      filename: name,
      getData: vi.fn().mockResolvedValue(new Blob(['data'])),
    }));

    vi.mock('@zip.js/zip.js', () => ({
      ZipReader: vi.fn().mockImplementation(() => ({
        getEntries: vi.fn().mockResolvedValue(fakeEntries),
        close: vi.fn().mockResolvedValue(undefined),
      })),
      BlobReader: vi.fn(),
      BlobWriter: vi.fn(),
    }));

    const { onImportDict } = await import('./options.js');
    const doc = makeOptionsDoc();
    const fakeFile = new Blob(['zip content'], { type: 'application/zip' });
    await onImportDict(doc, fakeFile);
    expect(doc.getElementById('dictStatus').textContent).toBe('Missing: unk_pos.dat.gz');
    expect(saveDictionaryMock).not.toHaveBeenCalled();
  });

  it('sets #dictStatus to "Import failed" when ZipReader throws', async () => {
    // A corrupt or unreadable archive must not crash the options page; instead
    // the failure must be surfaced as a human-readable status message.
    vi.mock('../shared/dict-store.js', () => ({
      saveDictionary: vi.fn(),
      hasDictionary: vi.fn().mockResolvedValue(false),
    }));

    vi.mock('@zip.js/zip.js', () => ({
      ZipReader: vi.fn().mockImplementation(() => ({
        getEntries: vi.fn().mockRejectedValue(new Error('bad zip')),
        close: vi.fn().mockResolvedValue(undefined),
      })),
      BlobReader: vi.fn(),
      BlobWriter: vi.fn(),
    }));

    const { onImportDict } = await import('./options.js');
    const doc = makeOptionsDoc();
    const fakeFile = new Blob(['not a zip'], { type: 'application/zip' });
    await onImportDict(doc, fakeFile);
    expect(doc.getElementById('dictStatus').textContent).toBe('Import failed');
  });

  it('does not throw when #dictStatus element is absent from the document', async () => {
    // The function must be safe to call even if the element is missing so that
    // partial renders or programmatic calls from other contexts do not crash.
    vi.mock('../shared/dict-store.js', () => ({
      saveDictionary: vi.fn().mockResolvedValue(undefined),
      hasDictionary: vi.fn().mockResolvedValue(false),
    }));

    vi.mock('@zip.js/zip.js', () => ({
      ZipReader: vi.fn().mockImplementation(() => ({
        getEntries: vi.fn().mockResolvedValue([]),
        close: vi.fn().mockResolvedValue(undefined),
      })),
      BlobReader: vi.fn(),
      BlobWriter: vi.fn(),
    }));

    const { onImportDict } = await import('./options.js');
    // Build a doc with no #dictStatus element
    const { window } = new JSDOM(`<!DOCTYPE html><html><body></body></html>`);
    const doc = window.document;
    const fakeFile = new Blob(['zip content'], { type: 'application/zip' });
    await expect(onImportDict(doc, fakeFile)).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Issue #11 — refreshDictStatus is exported from options.js
//
// The status-display helper moves to options.js along with the import flow.
// ---------------------------------------------------------------------------

describe('refreshDictStatus (Issue #11)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('sets #dictStatus.textContent to "Loaded" when hasDictionary resolves true', async () => {
    // A loaded dictionary must be visible to the user on the options page so they
    // know the import was successful and the local tokenizer is ready to use.
    vi.mock('../shared/dict-store.js', () => ({
      saveDictionary: vi.fn(),
      hasDictionary: vi.fn().mockResolvedValue(true),
    }));

    const { refreshDictStatus } = await import('./options.js');
    const doc = makeOptionsDoc();
    await refreshDictStatus(doc);
    expect(doc.getElementById('dictStatus').textContent).toBe('Loaded');
  });

  it('sets #dictStatus.textContent to "Not loaded" when hasDictionary resolves false', async () => {
    // An absent dictionary must be indicated clearly so the user knows they need
    // to import one before the local tokenizer can function.
    vi.mock('../shared/dict-store.js', () => ({
      saveDictionary: vi.fn(),
      hasDictionary: vi.fn().mockResolvedValue(false),
    }));

    const { refreshDictStatus } = await import('./options.js');
    const doc = makeOptionsDoc();
    await refreshDictStatus(doc);
    expect(doc.getElementById('dictStatus').textContent).toBe('Not loaded');
  });

  it('sets #dictStatus.textContent to "Not loaded" when hasDictionary rejects', async () => {
    // An IndexedDB error must not propagate to the caller; the status must fall
    // back to "Not loaded" so the UI remains usable even when storage is broken.
    vi.mock('../shared/dict-store.js', () => ({
      saveDictionary: vi.fn(),
      hasDictionary: vi.fn().mockRejectedValue(new Error('IDB unavailable')),
    }));

    const { refreshDictStatus } = await import('./options.js');
    const doc = makeOptionsDoc();
    await refreshDictStatus(doc);
    expect(doc.getElementById('dictStatus').textContent).toBe('Not loaded');
  });
});

// ---------------------------------------------------------------------------
// Issue #28 — Per-category colour swatches show correct built-in defaults
//
// When a category has no backgroundColor override in storage the swatch must
// display the category's BUILT_IN_STYLE_FALLBACK colour, not a generic grey.
// loadStyleSettings() and resetOptionsToDefaults() are both affected.
// ---------------------------------------------------------------------------

describe('Issue #28 — per-category swatch defaults', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('T-28-001: loadStyleSettings sets each swatch to BUILT_IN_STYLE_FALLBACK colour when no backgroundColor override is stored', async () => {
    // Without this fix the swatches show #808080 (generic grey) even though the
    // actual highlight renders the per-category BUILT_IN_STYLE_FALLBACK colour,
    // causing a visible mismatch between the options preview and the live page.
    const { loadStyleSettings } = await import('./options.js');
    const doc = makeOptionsDoc();
    // Storage returns per-category objects with NO backgroundColor key, meaning no user override.
    const stored = {
      ...STYLE_DEFAULTS.styleSettings,
      unlearned: {},
      learning: {},
      learned: {},
    };
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: stored });
    await loadStyleSettings(doc, storageGet);

    expect(doc.getElementById('unlearned-bg-color').value).toBe(BUILT_IN_STYLE_FALLBACK.unlearned.backgroundColor);
    expect(doc.getElementById('learning-bg-color').value).toBe(BUILT_IN_STYLE_FALLBACK.learning.backgroundColor);
    expect(doc.getElementById('learned-bg-color').value).toBe(BUILT_IN_STYLE_FALLBACK.learned.backgroundColor);
  });

  it('T-28-002: resetOptionsToDefaults sets each swatch to BUILT_IN_STYLE_FALLBACK colour', async () => {
    // resetOptionsToDefaults() was setting colorEl.value = '' which left the
    // swatch as an empty string / browser default rather than the built-in colour.
    // After reset the user must see the canonical per-category preview colour.
    const { resetOptionsToDefaults } = await import('./options.js');
    const doc = makeOptionsDoc({
      unlearnedBgColor: '#ffffff',
      learningBgColor: '#ffffff',
      learnedBgColor: '#ffffff',
    });
    const storageSet = vi.fn().mockResolvedValue(undefined);
    await resetOptionsToDefaults(doc, storageSet, vi.fn());

    expect(doc.getElementById('unlearned-bg-color').value).toBe(BUILT_IN_STYLE_FALLBACK.unlearned.backgroundColor);
    expect(doc.getElementById('learning-bg-color').value).toBe(BUILT_IN_STYLE_FALLBACK.learning.backgroundColor);
    expect(doc.getElementById('learned-bg-color').value).toBe(BUILT_IN_STYLE_FALLBACK.learned.backgroundColor);
  });

  it('T-28-003: loadStyleSettings shows the stored colour when a category has an explicit backgroundColor override', async () => {
    // The fallback must not fire when an explicit user override is present; this
    // guards the fix from inadvertently clobbering real user-saved colours.
    const { loadStyleSettings } = await import('./options.js');
    const doc = makeOptionsDoc();
    const stored = {
      ...STYLE_DEFAULTS.styleSettings,
      unlearned: { backgroundColor: '#123456' },
      learning:  { backgroundColor: '#abcdef' },
      learned:   { backgroundColor: '#fedcba' },
    };
    const storageGet = vi.fn().mockResolvedValue({ styleSettings: stored });
    await loadStyleSettings(doc, storageGet);

    expect(doc.getElementById('unlearned-bg-color').value).toBe('#123456');
    expect(doc.getElementById('learning-bg-color').value).toBe('#abcdef');
    expect(doc.getElementById('learned-bg-color').value).toBe('#fedcba');
  });

  it('T-28-004: after resetOptionsToDefaults, currentStyleSettings returns no backgroundColor key for any category', async () => {
    // The swatch value after reset is purely cosmetic; writing it into storage as
    // a backgroundColor override would cause categories to ignore the global default
    // and BUILT_IN_STYLE_FALLBACK would never be reached in resolveCategory().
    const { resetOptionsToDefaults, currentStyleSettings } = await import('./options.js');
    const doc = makeOptionsDoc({
      unlearnedEnabled: true, unlearnedBgColor: '#ff0000',
      learningEnabled:  true, learningBgColor:  '#00ff00',
      learnedEnabled:   true, learnedBgColor:   '#0000ff',
    });
    const storageSet = vi.fn().mockResolvedValue(undefined);
    await resetOptionsToDefaults(doc, storageSet, vi.fn());

    const settings = currentStyleSettings(doc);
    expect(settings.unlearned).not.toHaveProperty('backgroundColor');
    expect(settings.learning).not.toHaveProperty('backgroundColor');
    expect(settings.learned).not.toHaveProperty('backgroundColor');
  });
});

// ---------------------------------------------------------------------------
// Issue #33 — options.html contains unknown-category inputs  (T-33-025)
// ---------------------------------------------------------------------------

describe('options.html unknown-category inputs (issue #33 AC-22)', () => {
  let doc;

  beforeEach(async () => {
    const fs = await import('fs');
    const path = await import('path');
    const htmlPath = path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), '..', '..', '..', 'options.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    doc = new JSDOM(html, { url: 'http://localhost/' }).window.document;
  });

  it('T-33-025: options.html contains #unknown-bg-color-enabled, #unknown-bg-color, and #unknown-bg-opacity (issue #33 AC-22)', () => {
    // The options page must expose controls for the new unknown category so the
    // user can customise its highlight colour; absent inputs mean the category
    // cannot be configured through the UI.
    const enabledEl = doc.getElementById('unknown-bg-color-enabled');
    const colorEl   = doc.getElementById('unknown-bg-color');
    const opacityEl = doc.getElementById('unknown-bg-opacity');
    expect(enabledEl, '#unknown-bg-color-enabled must exist in options.html').not.toBeNull();
    expect(enabledEl.type).toBe('checkbox');
    expect(colorEl, '#unknown-bg-color must exist in options.html').not.toBeNull();
    expect(colorEl.type).toBe('color');
    expect(opacityEl, '#unknown-bg-opacity must exist in options.html').not.toBeNull();
  });
});
