/**
 * Tier-1: kuromoji tokenize throughput.
 *
 * The single heaviest synchronous operation in the extension — it runs on the
 * main thread inside segmentAndWrap and blocks paint. We measure it in isolation
 * (raw text in, tokens out, no DOM) to get a clean tokens/sec figure per size and
 * variant.
 */

import { sample, record } from '../lib/bench.js';
import { generateText } from '../fixtures/generate.js';

const VARIANTS = ['dense', 'sparse'];

export async function run({ tokenizer, sizes }) {
  const records = [];
  for (const [size, count] of sizes) {
    for (const variant of VARIANTS) {
      const text = generateText(count, { variant });
      let tokenCount = 0;
      const st = await sample(() => { tokenCount = tokenizer.tokenize(text).length; });
      const tokensPerSec = Math.round((tokenCount / st.p50) * 1000);
      records.push(record({
        suite: 'tokenize', scenario: 'tokenize', size, variant, stats: st,
        extra: { chars: text.length, tokens: tokenCount, tokensPerSec },
      }));
    }
  }
  return records;
}
