/**
 * Tier-1: segmentAndWrap DOM cost.
 *
 * segmentAndWrap walks a subtree, tokenises each Japanese text node, and replaces
 * it with a fragment of per-token <span>s. To measure the *DOM* cost rather than
 * the tokeniser, tokenisation is pre-computed into a cache during setup so the
 * injected tokenize() is a pure lookup inside the timed region. Each sample runs
 * against a freshly parsed document (untimed) so it always measures a cold walk.
 */

import { sample, record } from '../lib/bench.js';
import { domFromHTML } from '../lib/dom.js';
import { generateHTML } from '../fixtures/generate.js';
import { segmentAndWrap } from '../../content.segmentation.js';
import { isJapanese } from '../../scan-util.js';

const VARIANTS = ['dense', 'sparse'];
const TEXT_NODE = 3;

/** Pre-tokenises every Japanese text node under `body` into a Map keyed by exact text. */
function buildTokenCache(body, tokenizer) {
  const cache = new Map();
  const walk = (node) => {
    if (node.nodeType === TEXT_NODE) {
      const t = node.textContent;
      if (isJapanese(t) && !cache.has(t)) cache.set(t, tokenizer.tokenize(t));
      return;
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(body);
  return cache;
}

export async function run({ tokenizer, sizes }) {
  const records = [];
  for (const [size, count] of sizes) {
    for (const variant of VARIANTS) {
      const html = generateHTML(count, { variant });

      // Build the tokenize cache once from a throwaway parse.
      const seed = domFromHTML(html);
      const cache = buildTokenCache(seed.body, tokenizer);
      const tokenize = (t) => cache.get(t) ?? tokenizer.tokenize(t);

      let spans = 0;
      const st = await sample(
        (doc) => { spans = segmentAndWrap(doc.body, isJapanese, tokenize); },
        { setupEach: () => domFromHTML(html) },
      );

      records.push(record({
        suite: 'segment', scenario: 'segmentAndWrap', size, variant, stats: st,
        extra: { spans, spansPerSec: Math.round((spans / st.p50) * 1000) },
      }));
    }
  }
  return records;
}
