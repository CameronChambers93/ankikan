const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'RT', 'RP', 'NOSCRIPT', 'HEAD']);

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
      const { surface_form, basic_form } = token;
      if (isJap(surface_form)) {
        const span = doc.createElement('span');
        span.textContent = surface_form;
        if (basic_form && basic_form !== '*' && basic_form !== surface_form) {
          span.dataset.lemma = basic_form;
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
}
