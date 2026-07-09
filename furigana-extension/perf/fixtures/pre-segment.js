/**
 * Pre-segmented fixture pages: HTML that already carries the
 * `<span data-lemma data-reading>` markup segmentAndWrap would produce, so
 * Tier-2 scenarios can isolate scanPage's DOM-scan cost from segmentAndWrap's
 * tokenize-and-wrap cost.
 *
 * `tokenize` is a parameter, not a hardcoded kuromoji build, so Vitest can pass
 * a fast stub while build-fixtures.js passes the real tokenizer for
 * byte-accurate `.presegmented.html` files.
 */

import { generateHTML } from './generate.js';
import { segmentAndWrap } from '../../content.segmentation.js';
import { isJapanese } from '../../scan-util.js';
import { domFromHTML } from '../lib/dom.js';

/**
 * Generates a fixture page and runs the real segmentAndWrap over it, so the
 * returned HTML is already in "post-scan" markup state.
 *
 * @param {number} tokenCount
 * @param {(s: string) => Array<{surface_form: string, basic_form: string, reading?: string}>} tokenize
 * @param {object} [opts] - Forwarded to generateHTML (seed, variant, title).
 * @returns {string} A complete HTML document string with spans already inserted.
 */
export function generatePreSegmentedHTML(tokenCount, tokenize, opts = {}) {
  const html = generateHTML(tokenCount, opts);
  const { document, body } = domFromHTML(html);
  segmentAndWrap(body, isJapanese, tokenize);
  return `<!DOCTYPE html>\n${document.documentElement.outerHTML}`;
}
