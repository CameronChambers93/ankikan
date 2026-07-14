import { markStart, markEnd, PERF_NAMES } from './content.timing.js';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'RT', 'RP', 'NOSCRIPT', 'HEAD']);

const HAN_RE = /[一-龯㐀-䶿]/;

/**
 * Converts katakana codepoints (U+30A1–U+30F6) to hiragana; all other characters pass through unchanged.
 * @param {string} str
 * @returns {string}
 */
export function katakanaToHiragana(str) {
  return str.replace(/[ァ-ヶ]/g, (ch) => String.fromCodePoint(ch.codePointAt(0) - 0x60));
}

/**
 * Splits `text` into an array of { text, isKanji } run objects, grouping contiguous Han
 * characters as kanji runs and everything else as non-kanji runs.
 * @param {string} text
 * @returns {Array<{text: string, isKanji: boolean}>}
 */
export function splitKanjiKana(text) {
  const runs = [];
  let current = '';
  let currentIsKanji = null;
  for (const ch of text) {
    const isKanji = HAN_RE.test(ch);
    if (currentIsKanji === null) {
      currentIsKanji = isKanji;
      current = ch;
    } else if (isKanji === currentIsKanji) {
      current += ch;
    } else {
      runs.push({ text: current, isKanji: currentIsKanji });
      current = ch;
      currentIsKanji = isKanji;
    }
  }
  if (current.length > 0) runs.push({ text: current, isKanji: currentIsKanji });
  return runs;
}

/**
 * Injects <ruby>/<rt> furigana markup into `span` using `span.dataset.reading`.
 * No-op when: dataset.reading is absent; span already contains a <ruby> child; or
 * span.textContent has no Han characters.
 * @param {HTMLSpanElement} span
 */
export function injectFurigana(span) {
  if (!span.dataset.reading) return;
  if (span.querySelector('ruby')) return;
  const surface = span.textContent;
  if (!HAN_RE.test(surface)) return;

  const reading = katakanaToHiragana(span.dataset.reading);
  const runs = splitKanjiKana(surface);
  const kanjiRuns = runs.filter((r) => r.isKanji);

  while (span.firstChild) span.removeChild(span.firstChild);

  if (kanjiRuns.length === 1) {
    // Single kanji run: may have leading/trailing kana runs
    const kanjiIdx = runs.findIndex((r) => r.isKanji);
    let readingForKanji = reading;

    // Strip trailing kana run from the reading
    const trailingRuns = runs.slice(kanjiIdx + 1).filter((r) => !r.isKanji);
    const trailingKana = trailingRuns.map((r) => r.text).join('');
    if (trailingKana && reading.endsWith(trailingKana)) {
      readingForKanji = reading.slice(0, reading.length - trailingKana.length);
    }

    // Append leading kana runs as plain text
    for (let i = 0; i < kanjiIdx; i++) {
      span.appendChild(span.ownerDocument.createTextNode(runs[i].text));
    }

    // Build the ruby element
    const ruby = span.ownerDocument.createElement('ruby');
    ruby.appendChild(span.ownerDocument.createTextNode(runs[kanjiIdx].text));
    const rt = span.ownerDocument.createElement('rt');
    rt.textContent = readingForKanji;
    ruby.appendChild(rt);
    span.appendChild(ruby);

    // Append trailing kana runs as plain text
    for (let i = kanjiIdx + 1; i < runs.length; i++) {
      span.appendChild(span.ownerDocument.createTextNode(runs[i].text));
    }
  } else {
    // Multiple kanji runs: fall back to one ruby wrapping the whole surface
    const ruby = span.ownerDocument.createElement('ruby');
    ruby.appendChild(span.ownerDocument.createTextNode(surface));
    const rt = span.ownerDocument.createElement('rt');
    rt.textContent = reading;
    ruby.appendChild(rt);
    span.appendChild(ruby);
  }
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * Returns true if the element is an anki-status span (anki-unlearned, anki-learning, etc.).
 * @param {Element} el
 */
function isAnkiSpan(el) {
  for (const cls of el.classList) {
    if (cls.startsWith('anki-')) return true;
  }
  return false;
}

/**
 * Returns true if the element is a bare word span produced by a previous segmentAndWrap call.
 * A word span has no anki-* class and is a SPAN element.
 * @param {Element} el
 */
function isWordSpan(el) {
  return el.nodeName === 'SPAN' && !isAnkiSpan(el);
}

/**
 * Walks the DOM subtree rooted at `root`, tokenises text nodes that contain Japanese
 * characters, and replaces each such text node with a DocumentFragment whose Japanese
 * tokens are wrapped in `<span>` elements.
 *
 * @param {Element} root - DOM subtree to walk.
 * @param {(s: string) => boolean} isJap - Returns true if the string contains Japanese.
 * @param {(s: string) => Array<{surface_form: string, basic_form: string}>} tokenize - Kuromoji tokenizer.
 * @returns {number} Number of `<span>` elements inserted or already present.
 */
export function segmentAndWrap(root, isJap, tokenize) {
  if (!root || !root.ownerDocument) return 0;

  markStart(PERF_NAMES.SEGMENT);
  try {
    const doc = root.ownerDocument;

    // Collect candidate text nodes to wrap, and count pre-existing word spans.
    // We mutate after collection so live-DOM changes don't invalidate iteration.
    const toWrap = [];
    let preexistingCount = 0;

    function collect(node) {
      if (node.nodeType === ELEMENT_NODE) {
        const tag = node.nodeName;
        if (SKIP_TAGS.has(tag)) return;
        if (isAnkiSpan(node)) return;
        if (isWordSpan(node)) {
          // This span was created by a previous segmentAndWrap call.
          // Count it but do not descend — the text node inside is already wrapped.
          preexistingCount++;
          return;
        }
        for (const child of Array.from(node.childNodes)) {
          collect(child);
        }
      } else if (node.nodeType === TEXT_NODE) {
        if (isJap(node.textContent)) {
          toWrap.push(node);
        }
      }
    }

    for (const child of Array.from(root.childNodes)) {
      collect(child);
    }

    let inserted = 0;

    for (const textNode of toWrap) {
      const text = textNode.textContent;
      const tokens = tokenize(text);
      const fragment = doc.createDocumentFragment();

      for (const token of tokens) {
        const { surface_form, basic_form, reading } = token;
        if (isJap(surface_form)) {
          const span = doc.createElement('span');
          span.textContent = surface_form;
          if (basic_form && basic_form !== '*' && basic_form !== surface_form) {
            span.dataset.lemma = basic_form;
          }
          if (reading && reading !== '*' && HAN_RE.test(surface_form)) {
            span.dataset.reading = reading;
          }
          fragment.appendChild(span);
          inserted++;
        } else {
          fragment.appendChild(doc.createTextNode(surface_form));
        }
      }

      textNode.parentNode.replaceChild(fragment, textNode);
    }

    return inserted + preexistingCount;
  } finally {
    markEnd(PERF_NAMES.SEGMENT);
  }
}
