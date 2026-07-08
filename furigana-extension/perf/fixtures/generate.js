/**
 * Deterministic Japanese fixture generator.
 *
 * Produces graded-size pages with a realistic kanji/kana distribution so the
 * same seed always yields the same bytes — a hard requirement for baseline
 * diffing. Two variants stress different code paths:
 *   - 'dense'  : mostly kanji compounds, minimal markup → maximum span count,
 *                worst case for splitKanjiKana / injectFurigana.
 *   - 'sparse' : Japanese interleaved with Latin words and inline markup → worst
 *                case for segmentAndWrap's text-node walk and skip logic.
 */

import { mulberry32, pick, chance } from '../lib/prng.js';
import {
  KANJI_NOUNS, KANJI_SINGLE, VERBS, ADJECTIVES, PARTICLES,
  ADVERBS, CONJUNCTIONS, PUNCT, LATIN_WORDS,
} from './corpus.js';

/** Canonical fixture sizes, in approximate Japanese token counts. */
export const SIZES = { S: 100, M: 1000, L: 10000, XL: 50000 };

/** Default seed — change deliberately, never per-run. */
export const DEFAULT_SEED = 0x4b414e; // "KAN"

const KANJI_BIAS = { dense: 0.85, sparse: 0.45 };

/**
 * Emits one clause as an array of word tokens (no surrounding markup).
 * Token count is variable; the caller stops once the page target is reached.
 *
 * @param {() => number} rng
 * @param {'dense'|'sparse'} variant
 * @returns {string[]}
 */
function clause(rng, variant) {
  const out = [];
  const kanjiBias = KANJI_BIAS[variant];

  if (chance(rng, 0.15)) out.push(pick(rng, CONJUNCTIONS));
  if (chance(rng, 0.2)) out.push(pick(rng, ADVERBS));

  // Subject
  out.push(chance(rng, kanjiBias) ? pick(rng, KANJI_NOUNS) : pick(rng, KANJI_SINGLE));
  out.push(pick(rng, PARTICLES));

  // Optional object with adjective
  if (chance(rng, 0.6)) {
    if (chance(rng, 0.4)) out.push(pick(rng, ADJECTIVES));
    out.push(chance(rng, kanjiBias) ? pick(rng, KANJI_NOUNS) : pick(rng, KANJI_SINGLE));
    out.push(pick(rng, PARTICLES));
  }

  // Predicate
  out.push(pick(rng, VERBS));
  out.push(pick(rng, PUNCT));
  return out;
}

/**
 * Generates a flat string of Japanese text with roughly `tokenCount` tokens.
 * Used by the tokenize micro-benchmark, which wants raw text, not DOM.
 *
 * @param {number} tokenCount
 * @param {object} [opts]
 * @param {number} [opts.seed]
 * @param {'dense'|'sparse'} [opts.variant]
 * @returns {string}
 */
export function generateText(tokenCount, { seed = DEFAULT_SEED, variant = 'dense' } = {}) {
  const rng = mulberry32(seed);
  const tokens = [];
  while (tokens.length < tokenCount) tokens.push(...clause(rng, variant));
  return tokens.join('');
}

/**
 * Generates a full HTML document whose body contains ~`tokenCount` Japanese
 * tokens spread across many block elements, mimicking a real article. The
 * 'sparse' variant scatters Latin words and inline markup between the Japanese.
 *
 * @param {number} tokenCount
 * @param {object} [opts]
 * @param {number} [opts.seed]
 * @param {'dense'|'sparse'} [opts.variant]
 * @param {string} [opts.title]
 * @returns {string} A complete HTML document string.
 */
export function generateHTML(tokenCount, { seed = DEFAULT_SEED, variant = 'dense', title } = {}) {
  const rng = mulberry32(seed);
  const TOKENS_PER_PARA = 30;
  const paragraphs = [];
  let emitted = 0;

  while (emitted < tokenCount) {
    const paraTokens = [];
    while (paraTokens.length < TOKENS_PER_PARA && emitted < tokenCount) {
      const c = clause(rng, variant);
      paraTokens.push(...c);
      emitted += c.length;
    }
    paragraphs.push(renderParagraph(rng, paraTokens, variant));
  }

  const label = title || `perf-${variant}-${tokenCount}`;
  return [
    '<!DOCTYPE html>',
    '<html lang="ja"><head><meta charset="utf-8">',
    `<title>${label}</title></head>`,
    '<body>',
    `<h1>${pick(mulberry32(seed), KANJI_NOUNS)}について</h1>`,
    ...paragraphs,
    '</body></html>',
  ].join('\n');
}

/**
 * Wraps a clause's tokens in block markup. For 'sparse', injects Latin words and
 * inline <a>/<em> elements so the generated text node boundaries vary.
 */
function renderParagraph(rng, tokens, variant) {
  if (variant !== 'sparse') {
    return `<p>${tokens.join('')}</p>`;
  }
  const parts = [];
  for (const tok of tokens) {
    parts.push(tok);
    if (chance(rng, 0.12)) parts.push(` ${pick(rng, LATIN_WORDS)} `);
    if (chance(rng, 0.06)) parts.push(`<em>${pick(rng, LATIN_WORDS)}</em>`);
    if (chance(rng, 0.04)) parts.push(`<a href="#">${pick(rng, KANJI_SINGLE)}</a>`);
  }
  return `<p>${parts.join('')}</p>`;
}

/**
 * Resolves a sizes spec ("S,M,L" | "all" | undefined) to ordered [name, count] pairs.
 * @param {string} [spec]
 * @returns {Array<[string, number]>}
 */
export function resolveSizes(spec) {
  if (!spec || spec === 'default') return [['S', SIZES.S], ['M', SIZES.M], ['L', SIZES.L]];
  if (spec === 'all') return Object.entries(SIZES);
  return spec.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).map((name) => {
    if (!(name in SIZES)) throw new Error(`Unknown size '${name}'. Valid: ${Object.keys(SIZES).join(', ')}`);
    return [name, SIZES[name]];
  });
}
