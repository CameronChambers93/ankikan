/**
 * Tier-1: scanPage assembly cost (CPU/DOM only, network excluded).
 *
 * scanPage does an O(spans) querySelectorAll + extractWord walk, builds the lemma
 * map and the AnkiConnect request payloads, then applies status classes and
 * injects furigana. Live AnkiConnect latency is a Tier-2 concern; here we stub
 * ankiRequest with a deterministic, zero-latency responder so the numbers reflect
 * only the extension's own work. Input is a pre-segmented page (spans already
 * present), matching the state scanPage actually runs against.
 */

import { sample, record } from '../lib/bench.js';
import { domFromHTML } from '../lib/dom.js';
import { generateHTML } from '../fixtures/generate.js';
import { segmentAndWrap } from '../../content.segmentation.js';
import { scanPage, isJapanese } from '../../scan-util.js';

const VARIANTS = ['dense', 'sparse'];

const SETTINGS = {
  fieldName: 'Expression',
  furiganaGlobal: true,
  furiganaUnlearned: true,
  furiganaLearning: true,
  furiganaLearned: false,
  furiganaUnknown: true,
  lemmaMode: null,
  useLemma: false,
};

/**
 * Deterministic stand-in for the AnkiConnect bridge: ~1/3 of words "match", each
 * matched word maps to a single card whose type cycles new/learning/review.
 */
function stubAnkiRequest(body) {
  if (body.action === 'multi') {
    return { error: null, result: body.params.actions.map((_, i) => (i % 3 === 0 ? [1000 + i] : [])) };
  }
  if (body.action === 'cardsInfo') {
    return { error: null, result: body.params.cards.map((id) => ({ cardId: id, type: id % 3 })) };
  }
  return { error: null, result: [] };
}

const noopFetchLemmas = async () => ({});

export async function run({ tokenizer, sizes }) {
  const records = [];
  for (const [size, count] of sizes) {
    for (const variant of VARIANTS) {
      // Pre-segment once, then re-parse the segmented HTML per sample so every
      // run starts from clean (un-classified) spans.
      const seed = domFromHTML(generateHTML(count, { variant }));
      segmentAndWrap(seed.body, isJapanese, tokenizer.tokenize.bind(tokenizer));
      const segmentedHtml = seed.dom.serialize();

      let found = 0;
      const st = await sample(
        async (ctx) => {
          const res = await scanPage(SETTINGS, {
            ankiRequest: stubAnkiRequest,
            fetchLemmas: noopFetchLemmas,
            doc: ctx.document,
          });
          found = res.found;
        },
        { setupEach: () => domFromHTML(segmentedHtml) },
      );

      records.push(record({
        suite: 'scan', scenario: 'scanPage', size, variant, stats: st,
        extra: { candidates: found },
      }));
    }
  }
  return records;
}
