import { isJapanese } from './scan-util.js';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'RT', 'RP', 'NOSCRIPT', 'HEAD']);

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * Shifts full-width katakana codepoints (U+30A1–U+30F6) to their hiragana
 * equivalents (U+3041–U+3096). U+30FC (long vowel mark) is left unchanged.
 * All other codepoints are passed through as-is.
 *
 * @param {string} str
 * @returns {string}
 */
export function katakanaToHiragana(str) {
  return str.replace(/[ァ-ヶ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
}

/**
 * Returns true if the element is an existing anki-* span from a previous scan.
 * @param {Element} el
 */
function isAnkiSpan(el) {
  for (const cls of el.classList) {
    if (cls.startsWith('anki-')) return true;
  }
  return false;
}

/**
 * Walks the DOM subtree rooted at `root`, tokenises Japanese text nodes, and
 * returns one WordRecord per Japanese token. Records carry a live DOM Range
 * whose start/end bound the token's characters in the original text node.
 *
 * @param {Element} root
 * @param {{ isJapanese: Function, tokenize: Function }} deps
 * @returns {Array<{range: Range, surface: string, lemma: string|null, reading: string|null, status: null, duplicate: boolean}>}
 */
export function collectWords(root, { isJapanese: isJap, tokenize }) {
  const doc = root.ownerDocument;
  const records = [];

  function walk(node) {
    if (node.nodeType === ELEMENT_NODE) {
      const tag = node.nodeName;
      if (SKIP_TAGS.has(tag)) return;
      if (isAnkiSpan(node)) return;
      for (const child of Array.from(node.childNodes)) {
        walk(child);
      }
    } else if (node.nodeType === TEXT_NODE) {
      const text = node.textContent;
      if (!isJap(text)) return;

      const tokens = tokenize(text);
      let offset = 0;
      for (const token of tokens) {
        const surface = token.surface_form;
        if (isJap(surface)) {
          const range = doc.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + surface.length);

          const basic = token.basic_form;
          const lemma = (basic && basic !== '*' && basic !== surface) ? basic : null;

          const rawReading = token.reading;
          const reading = (rawReading && rawReading !== '*')
            ? katakanaToHiragana(rawReading)
            : null;

          records.push({ range, surface, lemma, reading, status: null, duplicate: false });
        }
        offset += surface.length;
      }
    }
  }

  for (const child of Array.from(root.childNodes)) {
    walk(child);
  }

  return records;
}

/**
 * Builds WordRecords from existing `span[data-lemma]` elements on pre-annotated pages.
 * Uses the span's data-lemma attribute for the lemma; sets reading to null because the
 * page already carries its own <ruby><rt> markup.
 *
 * @param {Element} root
 * @returns {Array<{range: Range, surface: string, lemma: string|null, reading: null, status: null, duplicate: boolean}>}
 */
export function collectFromSpans(root) {
  const doc = root.ownerDocument;
  const records = [];

  const spans = Array.from(root.querySelectorAll('span'));
  for (const span of spans) {
    const text = span.textContent;
    if (!isJapanese(text)) continue;

    const range = doc.createRange();
    range.selectNodeContents(span);

    const lemma = span.dataset.lemma || null;
    const surface = text;

    records.push({ range, surface, lemma, reading: null, status: null, duplicate: false });
  }

  return records;
}
