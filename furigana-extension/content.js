import { BUILT_IN_STYLE_FALLBACK, hexToRgb, resolveCategory, buildStyleSheet, injectStyles, resolveStyleSettings } from './style-util.js';
import { resolveLemmaMode, filterLemmaMap } from './lemma-util.js';
import { segmentAndWrap } from './content.segmentation.js';
import { collectAddedRoots, debounce } from './content.observer.js';
import DynamicDictionaries from 'kuromoji/src/dict/DynamicDictionaries.js';
import Tokenizer from 'kuromoji/src/Tokenizer.js';
import { Zlib } from 'zlibjs/bin/gunzip.min.js';
import { groupCandidates } from './content.grouping.js';
import { isJapanese, extractWord, cardTypeToStatus, applyFurigana, scanPage, STATUS_CLASSES, ALL_CLASSES } from './scan-util.js';

const ext = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);

const DEFAULTS = {
  fieldName: 'Expression',
  allowedUrls: [],
  blockedUrls: [],
  furiganaGlobal: true,
  furiganaUnlearned: true,
  furiganaLearning: true,
  furiganaLearned: false,
  furiganaUnknown: true,
  lemmaMode: null,
  useLemma: false,
  styleSettings: null,
};

/**
 * Returns true if the current page should be scanned based on the allow/block URL lists.
 * Block list is checked first; an empty allow list means all non-blocked pages are allowed.
 * `file:` protocol pages are always allowed once the block check passes.
 *
 * @param {object} settings - Extension settings containing `allowedUrls` and `blockedUrls` arrays.
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
 * Returns the parsed response object from AnkiConnect.
 *
 * @param {object} body - A valid AnkiConnect request body (must include `action` and `version`).
 */
async function ankiRequest(body) {
  return ext.runtime.sendMessage({ action: 'ankiQuery', body });
}

/**
 * Dispatches lemma resolution to the configured backend.
 *
 * @param {{span: HTMLSpanElement, word: string}[]} candidates - Japanese spans with extracted text.
 * @param {'server'|'local'} mode - The resolved lemma mode.
 * @returns {Promise<Object.<string, string>>} Map of `{surface: lemma}`.
 */
async function fetchLemmas(candidates, mode) {
  if (mode === 'server') return fetchLemmasFromServer(candidates);
  if (mode === 'local') return tokenizeLocally(candidates);
  return {};
}

/**
 * Queries the local lemma server (port 7654) via the background service worker.
 * Groups spans by block ancestor so the tokenizer receives full sentence context.
 *
 * @param {{span: HTMLSpanElement, word: string}[]} candidates - Japanese spans with extracted text.
 * @returns {Promise<Object.<string, string>>} Map of `{surface: lemma}`.
 */
async function fetchLemmasFromServer(candidates) {
  const paragraphs = groupCandidates(candidates, extractWord);
  if (!paragraphs.length) return {};

  return ext.runtime.sendMessage({ action: 'lemmaQuery', body: { paragraphs } });
}

let _tokenizerPromise = null;

/**
 * Tokenizes each block's text in-browser with kuromoji and derives surface→lemma mappings.
 *
 * @param {{span: HTMLSpanElement, word: string}[]} candidates - Japanese spans with extracted text.
 * @returns {Promise<Object.<string, string>>} Map of `{surface: lemma}`.
 */
async function tokenizeLocally(candidates) {
  if (!_tokenizerPromise) _tokenizerPromise = buildKuromoji();
  const tokenizer = await _tokenizerPromise;
  if (!tokenizer) return {};

  const lemmaMap = {};
  for (const { text, surfaces } of groupCandidates(candidates, extractWord)) {
    const tokens = tokenizer.tokenize(text);
    Object.assign(lemmaMap, filterLemmaMap(tokens, new Set(surfaces)));
  }
  return lemmaMap;
}

/**
 * Builds a kuromoji tokenizer whose gzipped dictionary files are fetched from the
 * extension-origin IndexedDB via the background service worker (`getDictFile`) and gunzipped
 * in-page. Resolves to null on failure (e.g. no dictionary imported).
 *
 * @returns {Promise<object|null>} The kuromoji tokenizer, or null if the dictionary is absent.
 */
async function buildKuromoji() {
  const fetchFile = (name) =>
    ext.runtime.sendMessage({ action: 'getDictFile', name })
      .then((b64) => {
        if (!b64) throw new Error('dict file not found: ' + name);
        // Background base64-encodes ArrayBuffers to survive Chrome message serialisation.
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

/**
 * Starts a debounced MutationObserver on document.body that re-segments newly
 * added subtrees and re-runs scanPage whenever Japanese content is injected after
 * document_idle (SPA route changes, infinite scroll, lazy-load, etc.).
 *
 * @param {object} tok      - The kuromoji tokenizer (has .tokenize()).
 * @param {object} settings - Extension settings (passed through to scanPage).
 */
function startObserver(tok, settings) {
  let observer;
  const pending = new Set();

  const flush = debounce(() => {
    const roots = [...pending];
    pending.clear();
    observer.disconnect();
    for (const root of roots) {
      if (!document.contains(root)) continue;
      segmentAndWrap(root, isJapanese, tok.tokenize.bind(tok));
    }
    scanPage(settings, { ankiRequest, fetchLemmas }).finally(() => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }, 300);

  observer = new MutationObserver((records) => {
    for (const root of collectAddedRoots(records)) pending.add(root);
    if (pending.size === 0) return;
    flush();
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

if (typeof chrome !== 'undefined' || typeof browser !== 'undefined') {
  ext.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'scan') {
      return ext.storage.local.get(DEFAULTS).then((settings) => scanPage(settings, { ankiRequest, fetchLemmas }));
    }
    if (msg.action === 'refreshFurigana') {
      const settings = msg.settings;
      document.querySelectorAll(STATUS_CLASSES.map((c) => '.' + c).join(','))
        .forEach((span) => {
          span.classList.remove('anki-hide-furigana');
          const status = STATUS_CLASSES.find((c) => span.classList.contains(c));
          if (status) applyFurigana(span, status, settings);
        });
      return Promise.resolve({ ok: true });
    }
    if (msg.action === 'refreshStyles') {
      injectStyles(document, msg.styleSettings);
      return Promise.resolve({ ok: true });
    }
  });

  ext.storage.local.get(DEFAULTS).then(async (settings) => {
    if (!isAllowed(settings)) return;
    injectStyles(document, resolveStyleSettings(settings.styleSettings ?? null));

    const mode = resolveLemmaMode(settings);
    if (mode === 'local' && document.querySelector('span[data-lemma]') === null) {
      if (!_tokenizerPromise) _tokenizerPromise = buildKuromoji();
      const tok = await _tokenizerPromise;
      if (tok) {
        segmentAndWrap(document.body, isJapanese, tok.tokenize.bind(tok));
        startObserver(tok, settings);
      }
    }

    scanPage(settings, { ankiRequest, fetchLemmas });
  });
}

