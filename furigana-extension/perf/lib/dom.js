/**
 * jsdom helpers for the Tier-1 micro-benchmarks.
 *
 * segmentAndWrap / scanPage / extractWord operate on a live DOM, so each timed
 * sample needs a fresh, unmutated document. Re-parsing from an HTML string is the
 * cleanest reset (cloneNode can subtly share state via ownerDocument), and the
 * parse itself happens in the harness's untimed setup phase, never inside fn.
 */

import { JSDOM } from 'jsdom';

let _nodeInstalled = false;

/**
 * scan-util's extractWord references the global `Node` for nodeType constants.
 * Those constants (TEXT_NODE === 3, ELEMENT_NODE === 1) are identical across
 * JSDOM realms, so installing any one window's Node globally is safe and lets the
 * source modules run unmodified under Node.
 * @param {JSDOM} dom
 */
function ensureGlobalNode(dom) {
  if (_nodeInstalled) return;
  globalThis.Node = dom.window.Node;
  _nodeInstalled = true;
}

/**
 * Parses an HTML document string into a fresh JSDOM document.
 * @param {string} html
 * @returns {{ dom: JSDOM, document: Document, body: HTMLElement }}
 */
export function domFromHTML(html) {
  const dom = new JSDOM(html);
  ensureGlobalNode(dom);
  return { dom, document: dom.window.document, body: dom.window.document.body };
}
