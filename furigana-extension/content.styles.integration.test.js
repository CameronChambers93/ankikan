import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  BUILT_IN_STYLE_FALLBACK,
  STYLE_DEFAULTS,
  buildStyleSheet,
  injectStyles,
  resolveStyleSettings,
} from './style-util.js';
import { resetToDefaults } from './popup-style.js';

// ---------------------------------------------------------------------------
// AC6 — injectStyles() creates/replaces a dynamic <style> element
// ---------------------------------------------------------------------------

describe('injectStyles (AC6)', () => {
  it('creates a <style id="anki-dynamic-styles"> element on first call', () => {
    const { window } = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>');
    injectStyles(window.document, {});
    const el = window.document.getElementById('anki-dynamic-styles');
    expect(el).not.toBeNull();
    expect(el.tagName.toLowerCase()).toBe('style');
  });

  it('populates the injected <style> element with CSS text', () => {
    const { window } = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>');
    injectStyles(window.document, {});
    const el = window.document.getElementById('anki-dynamic-styles');
    expect(el.textContent.length).toBeGreaterThan(0);
    expect(el.textContent).toContain('.anki-unlearned');
  });

  it('replaces the existing <style> element on subsequent calls rather than creating a duplicate', () => {
    const { window } = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>');
    const doc = window.document;
    injectStyles(doc, {});
    injectStyles(doc, { default: { backgroundColor: '#ff0000' }, unlearned: {}, learning: {}, learned: {} });
    expect(doc.querySelectorAll('#anki-dynamic-styles').length).toBe(1);
  });

  it('updates the CSS text when called with new settings', () => {
    const { window } = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>');
    const doc = window.document;
    injectStyles(doc, {});
    const firstCss = doc.getElementById('anki-dynamic-styles').textContent;
    injectStyles(doc, { default: { backgroundColor: '#ff0000', backgroundOpacity: 0.5 }, unlearned: {}, learning: {}, learned: {} });
    const secondCss = doc.getElementById('anki-dynamic-styles').textContent;
    expect(secondCss).not.toBe(firstCss);
    expect(secondCss).toMatch(/rgba\(255,\s*0,\s*0,\s*0\.5\)/);
  });

  it('appends the <style> element to <head>, not <body>', () => {
    const { window } = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>');
    const doc = window.document;
    injectStyles(doc, {});
    expect(doc.head.querySelector('#anki-dynamic-styles')).not.toBeNull();
    expect(doc.body.querySelector('#anki-dynamic-styles')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC5 — STYLE_DEFAULTS shape is correct and storage-ready
// ---------------------------------------------------------------------------

describe('STYLE_DEFAULTS shape (AC5)', () => {
  it('has a "styleSettings" key at the top level', () => {
    expect(STYLE_DEFAULTS).toHaveProperty('styleSettings');
  });

  it('styleSettings.default contains all six required properties', () => {
    const d = STYLE_DEFAULTS.styleSettings.default;
    expect(d).toHaveProperty('backgroundColor');
    expect(d).toHaveProperty('backgroundOpacity');
    expect(d).toHaveProperty('borderRadius');
    expect(d).toHaveProperty('outlineColor');
    expect(d).toHaveProperty('outlineOpacity');
    expect(d).toHaveProperty('outlineWidth');
  });

  it('styleSettings contains per-category keys for unlearned, learning, and learned', () => {
    const ss = STYLE_DEFAULTS.styleSettings;
    expect(ss).toHaveProperty('unlearned');
    expect(ss).toHaveProperty('learning');
    expect(ss).toHaveProperty('learned');
  });

  it('per-category default overrides are empty objects', () => {
    const ss = STYLE_DEFAULTS.styleSettings;
    expect(ss.unlearned).toEqual({});
    expect(ss.learning).toEqual({});
    expect(ss.learned).toEqual({});
  });

  it('styleSettings.default.backgroundOpacity is 0.22', () => {
    expect(STYLE_DEFAULTS.styleSettings.default.backgroundOpacity).toBe(0.22);
  });

  it('styleSettings.default.backgroundColor is a valid hex string', () => {
    expect(STYLE_DEFAULTS.styleSettings.default.backgroundColor).toMatch(/^#[0-9a-fA-F]{3,6}$/);
  });
});

// ---------------------------------------------------------------------------
// AC7 & AC10 — refreshStyles message updates spans without re-scanning
// ---------------------------------------------------------------------------

describe('refreshStyles message handler (AC7 and AC10)', () => {
  function handleRefreshStyles(doc, msg, ankiRequestSpy) {
    if (msg.action !== 'refreshStyles') return;
    injectStyles(doc, msg.styleSettings);
  }

  it('injects updated CSS into the document when a refreshStyles message is received', () => {
    const { window } = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>');
    const fakeAnkiRequest = vi.fn();
    handleRefreshStyles(window.document, {
      action: 'refreshStyles',
      styleSettings: { default: { backgroundColor: '#0000ff', backgroundOpacity: 0.22 }, unlearned: {}, learning: {}, learned: {} },
    }, fakeAnkiRequest);
    const el = window.document.getElementById('anki-dynamic-styles');
    expect(el).not.toBeNull();
    expect(el.textContent).toMatch(/rgba\(0,\s*0,\s*255,\s*0\.22\)/);
  });

  it('does not call ankiRequest when handling a refreshStyles message (AC10)', () => {
    const { window } = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>');
    const fakeAnkiRequest = vi.fn();
    handleRefreshStyles(window.document, { action: 'refreshStyles', styleSettings: {} }, fakeAnkiRequest);
    expect(fakeAnkiRequest).not.toHaveBeenCalled();
  });

  it('does not remove or re-classify existing highlighted spans', () => {
    const { window } = new JSDOM(`<!DOCTYPE html>
      <html><head></head><body>
        <span class="anki-unlearned">日本語</span>
        <span class="anki-learned">読む</span>
      </body></html>`);
    const fakeAnkiRequest = vi.fn();
    handleRefreshStyles(window.document, { action: 'refreshStyles', styleSettings: {} }, fakeAnkiRequest);
    expect(window.document.querySelector('.anki-unlearned')).not.toBeNull();
    expect(window.document.querySelector('.anki-learned')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC11 — fallback to built-in defaults when storage is unavailable
// ---------------------------------------------------------------------------

describe('resolveStyleSettings (AC11)', () => {
  it('returns STYLE_DEFAULTS.styleSettings when called with null (storage unavailable)', () => {
    expect(resolveStyleSettings(null)).toEqual(STYLE_DEFAULTS.styleSettings);
  });

  it('returns STYLE_DEFAULTS.styleSettings when called with undefined', () => {
    expect(resolveStyleSettings(undefined)).toEqual(STYLE_DEFAULTS.styleSettings);
  });

  it('merges stored values over the global default when storage is available', () => {
    const stored = { default: { backgroundColor: '#ff0000' }, unlearned: {}, learning: {}, learned: {} };
    const result = resolveStyleSettings(stored);
    expect(result.default.backgroundColor).toBe('#ff0000');
    expect(result.default.backgroundOpacity).toBe(STYLE_DEFAULTS.styleSettings.default.backgroundOpacity);
  });

  it('produces a result whose buildStyleSheet output contains all three status classes', () => {
    const css = buildStyleSheet(resolveStyleSettings(null));
    expect(css).toContain('.anki-unlearned');
    expect(css).toContain('.anki-learning');
    expect(css).toContain('.anki-learned');
  });

  it('does not throw when chrome.storage.local is unavailable (storage is null)', () => {
    expect(() => resolveStyleSettings(null)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC1 (issue #6) — options.html has the Style section with the expected inputs
// Previously this block read popup.html; after extraction it reads options.html.
// ---------------------------------------------------------------------------

describe('popup HTML style section (AC1)', () => {
  let doc;

  beforeEach(async () => {
    const fs = await import('fs');
    const path = await import('path');
    // After extraction the style section lives in options.html, not popup.html.
    const htmlPath = path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), '..', 'options.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    doc = new JSDOM(html, { url: 'http://localhost/' }).window.document;
  });

  it('contains a section or element with a "Style" heading', () => {
    expect(doc.body.textContent.toLowerCase()).toContain('style');
  });

  it('contains a colour input for the global default background colour (#global-bg-color)', () => {
    expect(doc.getElementById('global-bg-color')).not.toBeNull();
    expect(doc.getElementById('global-bg-color').type).toBe('color');
  });

  it('contains #global-bg-opacity, #global-border-radius, #global-outline-color, #global-outline-opacity, #global-outline-width', () => {
    expect(doc.getElementById('global-bg-opacity')).not.toBeNull();
    expect(doc.getElementById('global-border-radius')).not.toBeNull();
    expect(doc.getElementById('global-outline-color')).not.toBeNull();
    expect(doc.getElementById('global-outline-opacity')).not.toBeNull();
    expect(doc.getElementById('global-outline-width')).not.toBeNull();
  });

  it('contains per-category enable checkboxes for all three categories', () => {
    for (const cat of ['unlearned', 'learning', 'learned']) {
      const el = doc.getElementById(`${cat}-bg-color-enabled`);
      expect(el, `${cat}-bg-color-enabled should exist in options.html`).not.toBeNull();
      expect(el.type).toBe('checkbox');
    }
  });

  it('contains per-category colour and opacity inputs for all three categories', () => {
    for (const cat of ['unlearned', 'learning', 'learned']) {
      expect(doc.getElementById(`${cat}-bg-color`), `${cat}-bg-color`).not.toBeNull();
      expect(doc.getElementById(`${cat}-bg-opacity`), `${cat}-bg-opacity`).not.toBeNull();
    }
  });

  it('contains at least four colour inputs (global + three per-category)', () => {
    expect(doc.querySelectorAll('input[type="color"]').length).toBeGreaterThanOrEqual(4);
  });

  it('contains a #resetStylesBtn button', () => {
    expect(doc.getElementById('resetStylesBtn')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Issue #6 — popup.html after extraction: no style inputs, gains #openOptionsBtn
// ---------------------------------------------------------------------------

describe('popup HTML after extraction (issue #6)', () => {
  let doc;

  beforeEach(async () => {
    const fs = await import('fs');
    const path = await import('path');
    const htmlPath = path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), '..', 'popup.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    // Pass a URL so JSDOM does not treat the document as an opaque origin,
    // which would cause localStorage errors when the module script tag is parsed.
    doc = new JSDOM(html, { url: 'http://localhost/' }).window.document;
  });

  it('has zero input[type="color"] elements after the style section is moved to options.html', () => {
    // All colour pickers belong in options.html; popup.html must be lean.
    expect(doc.querySelectorAll('input[type="color"]').length).toBe(0);
  });

  it('has no #resetStylesBtn after extraction', () => {
    // The reset button is now in options.html; popup.html must not contain it.
    expect(doc.getElementById('resetStylesBtn')).toBeNull();
  });

  it('retains #scanBtn so the primary action is still accessible from the popup', () => {
    // Scan is a popup action, not a settings action, so it stays in popup.html.
    expect(doc.getElementById('scanBtn')).not.toBeNull();
  });

  it('has an #openOptionsBtn to open the dedicated options page', () => {
    // The popup must offer a way to reach the extracted options page.
    expect(doc.getElementById('openOptionsBtn')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Issue #6 — manifest.json must declare options_ui pointing to options.html
// ---------------------------------------------------------------------------

describe('manifest.json options_ui (issue #6)', () => {
  let manifest;

  beforeEach(async () => {
    const fs = await import('fs');
    const path = await import('path');
    const manifestPath = path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'), '..', 'manifest.json');
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  });

  it('has an options_ui field', () => {
    // Without options_ui the browser will not know where to open the settings page.
    expect(manifest).toHaveProperty('options_ui');
  });

  it('options_ui.page is "options.html"', () => {
    // The page must point to the correct file name.
    expect(manifest.options_ui.page).toBe('options.html');
  });

  it('options_ui.open_in_tab is true', () => {
    // open_in_tab: true gives the options page enough vertical space for all controls.
    expect(manifest.options_ui.open_in_tab).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC12 — "Reset to defaults" button reverts live inputs and triggers page update
// ---------------------------------------------------------------------------

describe('resetToDefaults (AC12)', () => {
  function makePopupDoc() {
    const { window } = new JSDOM(`<!DOCTYPE html><html><body>
      <input id="global-bg-color"        type="color"  value="#ff0000">
      <input id="global-bg-opacity"      type="number" value="0.99">
      <input id="global-border-radius"   type="number" value="99">
      <input id="global-outline-color"   type="color"  value="#ff0000">
      <input id="global-outline-opacity" type="number" value="0.99">
      <input id="global-outline-width"   type="number" value="99">
    </body></html>`);
    return window.document;
  }

  it('resets the global background colour input to the STYLE_DEFAULTS value', () => {
    const doc = makePopupDoc();
    resetToDefaults(doc, vi.fn(), vi.fn());
    expect(doc.getElementById('global-bg-color').value).toBe(STYLE_DEFAULTS.styleSettings.default.backgroundColor);
  });

  it('resets the global opacity input to the STYLE_DEFAULTS value', () => {
    const doc = makePopupDoc();
    resetToDefaults(doc, vi.fn(), vi.fn());
    expect(Number(doc.getElementById('global-bg-opacity').value)).toBe(STYLE_DEFAULTS.styleSettings.default.backgroundOpacity);
  });

  it('calls storageFn with the default styleSettings on reset', () => {
    const storageSpy = vi.fn();
    resetToDefaults(makePopupDoc(), storageSpy, vi.fn());
    expect(storageSpy).toHaveBeenCalledOnce();
    expect(storageSpy.mock.calls[0][0].styleSettings.default.backgroundColor)
      .toBe(STYLE_DEFAULTS.styleSettings.default.backgroundColor);
  });

  it('calls messageFn with a refreshStyles action so the page updates immediately', () => {
    const messageSpy = vi.fn();
    resetToDefaults(makePopupDoc(), vi.fn(), messageSpy);
    expect(messageSpy).toHaveBeenCalledOnce();
    expect(messageSpy.mock.calls[0][0].action).toBe('refreshStyles');
    expect(messageSpy.mock.calls[0][0]).toHaveProperty('styleSettings');
  });

  it('sends styleSettings whose CSS output contains the default global grey', () => {
    const messageSpy = vi.fn();
    resetToDefaults(makePopupDoc(), vi.fn(), messageSpy);
    const css = buildStyleSheet(messageSpy.mock.calls[0][0].styleSettings);
    expect(css).toContain('128'); // #808080 → rgba(128, 128, 128, ...)
  });
});

// ---------------------------------------------------------------------------
// AC3 — global background colour + opacity are correctly embedded in rgba()
// ---------------------------------------------------------------------------

describe('global colour/opacity end-to-end (AC3)', () => {
  it('global #0000ff + opacity 0.22 produces rgba(0, 0, 255, 0.22) in the injected CSS', () => {
    const { window } = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>');
    const settings = { default: { backgroundColor: '#0000ff', backgroundOpacity: 0.22 }, unlearned: {}, learning: {}, learned: {} };
    injectStyles(window.document, settings);
    expect(window.document.getElementById('anki-dynamic-styles').textContent)
      .toMatch(/rgba\(0,\s*0,\s*255,\s*0\.22\)/);
  });
});

// ---------------------------------------------------------------------------
// AC4 — global default + per-category learned override
// ---------------------------------------------------------------------------

describe('global default with per-category learned override (AC4)', () => {
  it('unlearned and learning use the global default red; learned uses its own green', () => {
    const { window } = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>');
    const settings = {
      default: { backgroundColor: '#ff0000' },
      unlearned: {},
      learning: {},
      learned: { backgroundColor: '#00ff00' },
    };
    injectStyles(window.document, settings);
    const css = window.document.getElementById('anki-dynamic-styles').textContent;

    const unlearnedBlock = css.slice(css.indexOf('.anki-unlearned'), css.indexOf('.anki-learning'));
    const learningBlock  = css.slice(css.indexOf('.anki-learning'),  css.indexOf('.anki-learned'));
    const learnedBlock   = css.slice(css.indexOf('.anki-learned'));

    expect(unlearnedBlock).toContain('255');
    expect(learningBlock).toContain('255');
    expect(learnedBlock).toMatch(/rgba\(0,\s*255,\s*0/);
    expect(learnedBlock).not.toMatch(/rgba\(255,\s*0,\s*0/);
  });
});

// ---------------------------------------------------------------------------
// Issue #4 — resetToDefaults must uncheck and disable the per-category
// "enable override" checkboxes so spurious #000000 writes cannot occur
// ---------------------------------------------------------------------------

describe('resetToDefaults — enable-override checkboxes (issue #4)', () => {
  function makeFullPopupDoc() {
    const { window } = new JSDOM(`<!DOCTYPE html><html><body>
      <input id="global-bg-color"        type="color"  value="#ff0000">
      <input id="global-bg-opacity"      type="number" value="0.99">
      <input id="global-border-radius"   type="number" value="99">
      <input id="global-outline-color"   type="color"  value="#ff0000">
      <input id="global-outline-opacity" type="number" value="0.99">
      <input id="global-outline-width"   type="number" value="99">

      <input id="unlearned-bg-color-enabled" type="checkbox" checked>
      <input id="unlearned-bg-color"         type="color"  value="#ff0000">
      <input id="unlearned-bg-opacity"       type="number" value="0.99">

      <input id="learning-bg-color-enabled"  type="checkbox" checked>
      <input id="learning-bg-color"          type="color"  value="#ff0000">
      <input id="learning-bg-opacity"        type="number" value="0.99">

      <input id="learned-bg-color-enabled"   type="checkbox" checked>
      <input id="learned-bg-color"           type="color"  value="#ff0000">
      <input id="learned-bg-opacity"         type="number" value="0.99">
    </body></html>`);
    return window.document;
  }

  it('unchecks unlearned-bg-color-enabled after reset so the per-category colour is treated as absent', () => {
    const doc = makeFullPopupDoc();
    resetToDefaults(doc, vi.fn(), vi.fn());
    expect(doc.getElementById('unlearned-bg-color-enabled').checked).toBe(false);
  });

  it('unchecks learning-bg-color-enabled after reset', () => {
    const doc = makeFullPopupDoc();
    resetToDefaults(doc, vi.fn(), vi.fn());
    expect(doc.getElementById('learning-bg-color-enabled').checked).toBe(false);
  });

  it('unchecks learned-bg-color-enabled after reset', () => {
    const doc = makeFullPopupDoc();
    resetToDefaults(doc, vi.fn(), vi.fn());
    expect(doc.getElementById('learned-bg-color-enabled').checked).toBe(false);
  });

  it('disables the unlearned-bg-color input after reset so the user cannot accidentally enter a colour while the override is off', () => {
    const doc = makeFullPopupDoc();
    resetToDefaults(doc, vi.fn(), vi.fn());
    expect(doc.getElementById('unlearned-bg-color').disabled).toBe(true);
  });

  it('does not throw when the enable checkboxes are absent (null-guard for documents without the new elements)', () => {
    const { window } = new JSDOM(`<!DOCTYPE html><html><body>
      <input id="global-bg-color"        type="color"  value="#ff0000">
      <input id="global-bg-opacity"      type="number" value="0.99">
      <input id="global-border-radius"   type="number" value="99">
      <input id="global-outline-color"   type="color"  value="#ff0000">
      <input id="global-outline-opacity" type="number" value="0.99">
      <input id="global-outline-width"   type="number" value="99">
    </body></html>`);
    expect(() => resetToDefaults(window.document, vi.fn(), vi.fn())).not.toThrow();
  });
});
