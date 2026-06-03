import { BUILT_IN_STYLE_FALLBACK, hexToRgb, resolveCategory, buildStyleSheet } from './style-util.js';

const ext = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);

function isJapanese(word) {
  return /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(word);
}

const STATUS_CLASSES = ['anki-unlearned', 'anki-learning', 'anki-learned'];
const ALL_CLASSES = [...STATUS_CLASSES, 'anki-duplicate', 'anki-hide-furigana'];

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

function extractWord(span) {
  let word = '';
  for (const node of span.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      word += node.textContent;
    } else if (node.nodeName === 'RUBY') {
      for (const ch of node.childNodes) {
        if (ch.nodeName !== 'RT' && ch.nodeName !== 'RP') {
          word += ch.textContent;
        }
      }
    }
  }
  return word.trim();
}

function cardTypeToStatus(type) {
  if (type === 0) return 'anki-unlearned';
  if (type === 2) return 'anki-learned';
  return 'anki-learning';
}

function applyFurigana(span, statusClass, settings) {
  if (!settings.furiganaGlobal) {
    span.classList.add('anki-hide-furigana');
    return;
  }
  const show = {
    'anki-unlearned': settings.furiganaUnlearned,
    'anki-learning': settings.furiganaLearning,
    'anki-learned': settings.furiganaLearned,
  }[statusClass] ?? true;
  span.classList.toggle('anki-hide-furigana', !show);
}

async function ankiRequest(body) {
  return ext.runtime.sendMessage({ action: 'ankiQuery', body });
}

// Fetch lemmas from the local lemma server using sentence context for accuracy.
// Groups ruby spans by their nearest block ancestor so the tokenizer sees full
// sentence context rather than isolated fragments (which can be mis-classified).
async function fetchLemmas(candidates) {
  const blocks = new Map();
  for (const { span, word } of candidates) {
    const block = span.closest('p, li, td, th, dd, dt, blockquote') || span.parentElement;
    if (!blocks.has(block)) blocks.set(block, new Set());
    blocks.get(block).add(word);
  }

  const paragraphs = [];
  for (const [block, surfaceSet] of blocks) {
    const allSpans = Array.from(block.querySelectorAll('span'));
    const text = allSpans.map(extractWord).join('');
    if (text) {
      paragraphs.push({ text, surfaces: [...surfaceSet] });
    }
  }

  if (paragraphs.length === 0) return {};

  return ext.runtime.sendMessage({ action: 'lemmaQuery', body: { paragraphs } });
}

async function scanPage(settings) {
  document.querySelectorAll(STATUS_CLASSES.map((c) => '.' + c).join(','))
    .forEach((el) => el.classList.remove(...ALL_CLASSES));

  const allSpans = Array.from(document.querySelectorAll('span'));
  const candidates = allSpans
    .map((span) => ({ span, word: extractWord(span) }))
    .filter(({ word }) => isJapanese(word));

  if (candidates.length === 0) {
    return { found: 0, matched: 0 };
  }

  // Build lemma map: surface → dictionary form.
  // Priority: lemma server (live, context-aware) > data-lemma attribute (pre-annotated HTML).
  const lemmaMap = {};
  for (const { span, word } of candidates) {
    if (span.dataset.lemma) lemmaMap[word] = span.dataset.lemma;
  }
  if (settings.useLemma) {
    try {
      const serverLemmas = await fetchLemmas(candidates);
      Object.assign(lemmaMap, serverLemmas);
    } catch {
      // Server not running; fall back to data-lemma / surface form.
    }
  }

  const lookupWord = (word) => lemmaMap[word] || word;
  const uniqueLookupWords = [...new Set(candidates.map(({ word }) => lookupWord(word)))];

  // Round trip 1: findCards for all unique lookup words
  const multiBody = {
    action: 'multi',
    version: 6,
    params: {
      actions: uniqueLookupWords.map((lw) => ({
        action: 'findCards',
        params: { query: `${settings.fieldName}:"${lw}"` },
      })),
    },
  };

  let multiResponse;
  try {
    multiResponse = await ankiRequest(multiBody);
  } catch {
    return { found: candidates.length, matched: 0, error: 'connection' };
  }

  if (multiResponse.error || !Array.isArray(multiResponse.result)) {
    return { found: candidates.length, matched: 0, error: multiResponse.error || 'unknown' };
  }

  const wordToCardIds = {};
  uniqueLookupWords.forEach((lw, i) => {
    const raw = multiResponse.result[i];
    wordToCardIds[lw] = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.result) ? raw.result : []);
  });

  const allCardIds = [...new Set(Object.values(wordToCardIds).flat())];

  if (allCardIds.length === 0) {
    return { found: candidates.length, matched: 0 };
  }

  // Round trip 2: cardsInfo for all found card IDs
  let cardsResponse;
  try {
    cardsResponse = await ankiRequest({
      action: 'cardsInfo',
      version: 6,
      params: { cards: allCardIds },
    });
  } catch {
    return { found: candidates.length, matched: 0, error: 'connection' };
  }

  const cardIdToType = {};
  if (cardsResponse.result) {
    for (const card of cardsResponse.result) {
      cardIdToType[card.cardId] = card.type;
    }
  }

  let matched = 0;
  for (const { span, word } of candidates) {
    const cardIds = wordToCardIds[lookupWord(word)];
    if (!cardIds || cardIds.length === 0) continue;

    const statusClass = cardTypeToStatus(cardIdToType[cardIds[0]] ?? 0);
    span.classList.add(statusClass);
    if (cardIds.length > 1) span.classList.add('anki-duplicate');
    applyFurigana(span, statusClass, settings);
    matched++;
  }

  return { found: candidates.length, matched };
}

if (typeof chrome !== 'undefined' || typeof browser !== 'undefined') {
  ext.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'scan') {
      return ext.storage.local.get(DEFAULTS).then((settings) => scanPage(settings));
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
  });

  ext.storage.local.get(DEFAULTS).then((settings) => {
    if (!isAllowed(settings)) return;
    scanPage(settings);
  });
}

