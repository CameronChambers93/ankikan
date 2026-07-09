/**
 * Tier-1: pathological-input timing for splitKanjiKana / isJapanese / extractWord.
 *
 * These three functions are already correctness-covered by
 * content.segmentation.test.js; this suite adds timing-only coverage against
 * adversarial inputs (maximal run-switching, long non-Japanese scans, and a
 * span with many nested <ruby> children) so a future accidental O(n^2) doesn't
 * regress silently. No pass/fail threshold — timing is hardware-dependent.
 */

import { sample, record } from '../lib/bench.js';
import { domFromHTML } from '../lib/dom.js';
import { splitKanjiKana } from '../../content.segmentation.js';
import { isJapanese, extractWord } from '../../scan-util.js';
import { WIDE_KANJI_POOL } from '../fixtures/corpus.js';

const LONG_LEN = 50000;
const RUBY_COUNT = 500;

/** Alternates a single kanji char with a single kana char — worst case for splitKanjiKana's run grouping (one run per character). */
function buildAlternating(len) {
  const kanji = WIDE_KANJI_POOL[0];
  const kana = 'あ';
  let out = '';
  for (let i = 0; i < len; i++) out += i % 2 === 0 ? kanji : kana;
  return out;
}

/** A long string with no Japanese at all — isJapanese must scan the full length before returning false. */
function buildNonJapanese(len) {
  return 'x'.repeat(len);
}

/** A span with many <ruby><rt> children — worst case for extractWord's childNodes walk. */
function buildRubySpan(document, rubyCount) {
  const span = document.createElement('span');
  for (let i = 0; i < rubyCount; i++) {
    const ruby = document.createElement('ruby');
    ruby.appendChild(document.createTextNode(WIDE_KANJI_POOL[i % WIDE_KANJI_POOL.length]));
    const rt = document.createElement('rt');
    rt.textContent = 'てすと';
    ruby.appendChild(rt);
    span.appendChild(ruby);
  }
  return span;
}

export async function run() {
  const records = [];

  const alternating = buildAlternating(LONG_LEN);
  const splitStats = await sample(() => { splitKanjiKana(alternating); });
  records.push(record({
    suite: 'text-util', scenario: 'splitKanjiKana-alternating', stats: splitStats,
    extra: { chars: alternating.length },
  }));

  const nonJapanese = buildNonJapanese(LONG_LEN);
  const isJapaneseStats = await sample(() => { isJapanese(nonJapanese); });
  records.push(record({
    suite: 'text-util', scenario: 'isJapanese-non-japanese', stats: isJapaneseStats,
    extra: { chars: nonJapanese.length },
  }));

  const { document } = domFromHTML('<!DOCTYPE html><html><body></body></html>');
  const rubySpan = buildRubySpan(document, RUBY_COUNT);
  const extractWordStats = await sample(() => { extractWord(rubySpan); });
  records.push(record({
    suite: 'text-util', scenario: 'extractWord-many-ruby', stats: extractWordStats,
    extra: { rubyCount: RUBY_COUNT },
  }));

  return records;
}
