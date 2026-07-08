/**
 * Builds a real kuromoji tokenizer for Node-side micro-benchmarks.
 *
 * The extension itself loads kuromoji's internals from gzipped dict files held in
 * IndexedDB (see content.js buildKuromoji). For Tier-1 we don't need that path —
 * we want the same tokenizer output (surface_form / basic_form / reading) with
 * the least ceremony, so we use kuromoji's public builder against the dict that
 * ships in node_modules. Build once per process and reuse.
 */

import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let _tokenizerPromise = null;

/**
 * Resolves the kuromoji dictionary directory inside node_modules (pnpm-hoisted).
 * @returns {string}
 */
function resolveDicPath() {
  const pkg = require.resolve('kuromoji/package.json');
  return path.join(path.dirname(pkg), 'dict');
}

/**
 * Builds (or returns the cached) kuromoji tokenizer.
 * @returns {Promise<{tokenize: (text: string) => Array<object>}>}
 */
export function getTokenizer() {
  if (_tokenizerPromise) return _tokenizerPromise;
  _tokenizerPromise = new Promise((resolve, reject) => {
    const kuromoji = require('kuromoji');
    kuromoji.builder({ dicPath: resolveDicPath() }).build((err, tokenizer) => {
      if (err) reject(err);
      else resolve(tokenizer);
    });
  });
  return _tokenizerPromise;
}
