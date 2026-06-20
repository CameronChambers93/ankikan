/**
 * Pure, browser-independent helpers for the MutationObserver re-segmentation
 * feature (issue #18).  Extracted into their own module so they can be unit-tested
 * in JSDOM with Vitest without loading the full content script.
 */

/**
 * Collects the element roots that should be passed to segmentAndWrap from a batch
 * of MutationRecords (or plain objects shaped like them).
 *
 * Rules:
 *  - Only element nodes (nodeType === 1) are included.
 *  - SPAN elements are excluded — they are self-inserted by segmentAndWrap and
 *    including them would trigger an infinite re-segmentation loop.
 *
 * @param {Array<{addedNodes: NodeList|Array}>} records
 * @returns {Set<Element>}
 */
export function collectAddedRoots(records) {
  const roots = new Set();
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.nodeName === 'SPAN') continue;
      roots.add(node);
    }
  }
  return roots;
}

/**
 * Returns a trailing-edge debounced wrapper for `fn`.
 * N calls within `delay` ms result in `fn` being invoked exactly once, with the
 * most recent call's arguments, after the delay has elapsed since the last call.
 *
 * @param {Function} fn
 * @param {number} delay  Milliseconds
 * @returns {Function}
 */
export function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delay);
  };
}
