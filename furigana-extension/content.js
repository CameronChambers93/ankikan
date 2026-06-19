import { BUILT_IN_STYLE_FALLBACK, hexToRgb, resolveCategory, buildStyleSheet, injectStyles, resolveStyleSettings } from './style-util.js';
import { resolveLemmaMode, filterLemmaMap } from './lemma-util.js';
import DynamicDictionaries from 'kuromoji/src/dict/DynamicDictionaries.js';
import Tokenizer from 'kuromoji/src/Tokenizer.js';
import { Zlib } from 'zlibjs/bin/gunzip.min.js';
import { groupCandidates } from './content.grouping.js';
import { isJapanese, extractWord, cardTypeToStatus, furiganaVisible, scanPage, STATUS_CLASSES, ALL_CLASSES } from './scan-util.js';
import { collectWords, collectFromSpans } from './word-collect.js';
import { renderOverlay, clearOverlay, reposition, attachRepositionListeners } from './overlay-render.js';

const ext = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);

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
  styleSettings: null,
};

/**
 * Returns true if the current page should be scanned based on the allow/block URL lists.
 */
function isAllowed(settings) {
  const host = location.hostname;
  const isFile = location.protocol === 'file:';

  const blocked = settings.blockedUrls || [];
  if (blocked.some((u) => { const t = u.trim(); return t && host.includes(t); })) {
    return false;
  }

  if (isFile) return true;

  if (!settings.allowedUrls || settings.allowedUrls.length === 0) return true;
  return settings.allowedUrls.some((u) => { const t = u.trim(); return t && host.includes(t); });
}

/**
 * Sends an AnkiConnect JSON-RPC request through the background service worker.
 */
async function ankiRequest(body) {
  return ext.runtime.sendMessage({ action: 'ankiQuery', body });
}

/**
 * Fetches lemmas from the configured backend. In local mode this is a no-op
 * because collectWords already extracts lemmas from kuromoji tokens directly.
 */
async function fetchLemmas(candidates, mode) {
  if (mode === 'server') return fetchLemmasFromServer(candidates);
  return {};
}

/**
 * Queries the local lemma server via the background service worker.
 */
async function fetchLemmasFromServer(candidates) {
  const paragraphs = groupCandidates(candidates, extractWord);
  if (!paragraphs.length) return {};
  return ext.runtime.sendMessage({ action: 'lemmaQuery', body: { paragraphs } });
}

let _tokenizerPromise = null;

/**
 * Builds a kuromoji tokenizer using dictionary files from IndexedDB.
 */
async function buildKuromoji() {
  const fetchFile = (name) =>
    ext.runtime.sendMessage({ action: 'getDictFile', name })
      .then((b64) => {
        if (!b64) throw new Error('dict file not found: ' + name);
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new Zlib.Gunzip(bytes).decompress().buffer;
      });

  try {
    const [trieBuffers, tokenInfoBuffers, [ccBuf], unkBuffers] = await Promise.all([
      Promise.all(['base.dat.gz', 'check.dat.gz'].map(fetchFile)),
      Promise.all(['tid.dat.gz', 'tid_pos.dat.gz', 'tid_map.dat.gz'].map(fetchFile)),
      Promise.all(['cc.dat.gz'].map(fetchFile)),
      Promise.all(['unk.dat.gz', 'unk_pos.dat.gz', 'unk_map.dat.gz', 'unk_char.dat.gz', 'unk_compat.dat.gz', 'unk_invoke.dat.gz'].map(fetchFile)),
    ]);
    const dic = new DynamicDictionaries();
    dic.loadTrie(new Int32Array(trieBuffers[0]), new Int32Array(trieBuffers[1]));
    dic.loadTokenInfoDictionaries(new Uint8Array(tokenInfoBuffers[0]), new Uint8Array(tokenInfoBuffers[1]), new Uint8Array(tokenInfoBuffers[2]));
    dic.loadConnectionCosts(new Int16Array(ccBuf));
    dic.loadUnknownDictionaries(new Uint8Array(unkBuffers[0]), new Uint8Array(unkBuffers[1]), new Uint8Array(unkBuffers[2]), new Uint8Array(unkBuffers[3]), new Uint32Array(unkBuffers[4]), new Uint8Array(unkBuffers[5]));
    return new Tokenizer(dic);
  } catch {
    return null;
  }
}

if (typeof chrome !== 'undefined' || typeof browser !== 'undefined') {
  // Module-level state shared across message handlers.
  let _records = [];
  let _cleanup = null;
  let _settings = { ...DEFAULTS };

  function doAttach(settings) {
    if (_cleanup) _cleanup();
    _cleanup = attachRepositionListeners(document, () => {
      reposition(document, _records, settings);
    });
  }

  async function collect(settings) {
    const mode = resolveLemmaMode(settings);
    const hasAnnotatedSpans = document.querySelector('span[data-lemma]') !== null;

    if (mode === 'local' && !hasAnnotatedSpans) {
      if (!_tokenizerPromise) _tokenizerPromise = buildKuromoji();
      const tok = await _tokenizerPromise;
      if (tok) {
        return collectWords(document.body, { isJapanese, tokenize: tok.tokenize.bind(tok) });
      }
      return [];
    }

    return collectFromSpans(document.body);
  }

  ext.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'scan') {
      return ext.storage.local.get(DEFAULTS).then(async (settings) => {
        _settings = settings;
        if (_cleanup) _cleanup();
        clearOverlay(document);
        _records = await collect(settings);
        await scanPage(_records, settings, { ankiRequest, fetchLemmas: (cands, mode) => fetchLemmas(cands, mode) });
        renderOverlay(document, _records, settings);
        doAttach(settings);
        return { ok: true };
      });
    }

    if (msg.action === 'refreshFurigana') {
      const settings = { ..._settings, ...msg.settings };
      renderOverlay(document, _records, settings);
      return Promise.resolve({ ok: true });
    }

    if (msg.action === 'refreshStyles') {
      injectStyles(document, msg.styleSettings);
      reposition(document, _records, _settings);
      return Promise.resolve({ ok: true });
    }
  });

  ext.storage.local.get(DEFAULTS).then(async (settings) => {
    if (!isAllowed(settings)) return;
    _settings = settings;
    injectStyles(document, resolveStyleSettings(settings.styleSettings ?? null));

    _records = await collect(settings);
    await scanPage(_records, settings, { ankiRequest, fetchLemmas: (cands, mode) => fetchLemmas(cands, mode) });
    renderOverlay(document, _records, settings);
    doAttach(settings);
  });
}
