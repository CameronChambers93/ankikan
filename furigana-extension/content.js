'use strict';

const ext = typeof browser !== 'undefined' ? browser : chrome;

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
};

function isAllowed(settings) {
  const host = location.hostname;
  const isFile = location.protocol === 'file:';

  // Blacklist takes priority over everything
  const blocked = settings.blockedUrls || [];
  if (blocked.some((u) => { const t = u.trim(); return t && host.includes(t); })) {
    return false;
  }

  // file:// URLs bypass the allowlist — always run on local files
  if (isFile) return true;

  // Empty allowlist = all pages; non-empty = must match
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

function hasKanji(str) {
  return /[一-鿿㐀-䶿豈-﫿]/.test(str);
}

function cardTypeToStatus(type) {
  if (type === 0) return 'anki-unlearned';
  if (type === 2) return 'anki-learned';
  return 'anki-learning'; // type 1 (learning) and 3 (relearning)
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

async function scanPage(settings) {
  // Clear previous annotations
  document.querySelectorAll(STATUS_CLASSES.map((c) => '.' + c).join(','))
    .forEach((el) => el.classList.remove(...ALL_CLASSES));

  // Collect spans that contain ruby elements
  const allSpans = Array.from(document.querySelectorAll('span'));
  const candidates = allSpans
    .filter((s) => s.querySelector('ruby'))
    .map((span) => ({ span, word: extractWord(span) }))
    .filter(({ word }) => hasKanji(word));

  if (candidates.length === 0) {
    return { found: 0, matched: 0 };
  }

  const uniqueWords = [...new Set(candidates.map((c) => c.word))];

  // Round trip 1: findCards for all unique words in one multi call
  const multiBody = {
    action: 'multi',
    version: 6,
    params: {
      actions: uniqueWords.map((word) => ({
        action: 'findCards',
        params: { query: `${settings.fieldName}:"${word}"` },
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

  // multiResponse.result[i] is the raw card ID array for uniqueWords[i]
  // (sub-actions without version return raw values)
  const wordToCardIds = {};
  uniqueWords.forEach((word, i) => {
    const raw = multiResponse.result[i];
    // Handle both raw array and wrapped {result, error} (version-aware sub-actions)
    wordToCardIds[word] = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.result) ? raw.result : []);
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

  // Annotate spans
  let matched = 0;
  for (const { span, word } of candidates) {
    const cardIds = wordToCardIds[word];
    if (!cardIds || cardIds.length === 0) continue;

    const statusClass = cardTypeToStatus(cardIdToType[cardIds[0]] ?? 0);
    span.classList.add(statusClass);
    if (cardIds.length > 1) span.classList.add('anki-duplicate');
    applyFurigana(span, statusClass, settings);
    matched++;
  }

  return { found: candidates.length, matched };
}

// Message listener — popup triggers rescan or settings-only furigana refresh
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

// Auto-scan on load
ext.storage.local.get(DEFAULTS).then((settings) => {
  if (!isAllowed(settings)) return;
  scanPage(settings);
});
