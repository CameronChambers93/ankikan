/**
 * Assembles and persists Tier-2/3 perf results.
 *
 * `assembleResults` wraps a literal records array in the `{meta, records}`
 * shape every Tier-2/3 harness needs (deliberately narrower than
 * `perf/micro/run.js`'s meta — no top-level `samples`/`node`/`durationMs`,
 * since Tier-2/3 records carry heterogeneous per-record `n` already).
 *
 * `writeResults` persists a result via an injected `io` object so it never
 * touches the real filesystem directly and stays fully Vitest-testable.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {string} tier
 * @param {object[]} records
 * @param {{sizes?: string[], now?: () => Date, extraMeta?: object}} [opts]
 * @returns {{meta: object, records: object[]}}
 */
export function assembleResults(tier, records, { sizes = [], now = () => new Date(), extraMeta = {} } = {}) {
  return { meta: { tier, timestamp: now().toISOString(), sizes, ...extraMeta }, records };
}

/**
 * @param {{meta: object, records: object[]}} result
 * @param {{resultsDir: string, prefix: string, io: {mkdir: Function, writeFile: Function}}} opts
 * @returns {Promise<{outPath: string, latestPath: string}>}
 */
export async function writeResults(result, { resultsDir, prefix, io }) {
  const stamp = result.meta.timestamp.replace(/[:.]/g, '-');
  const outPath = path.join(resultsDir, `${prefix}-${stamp}.json`);
  const latestPath = path.join(resultsDir, `${prefix}-latest.json`);
  await io.mkdir(resultsDir, { recursive: true });
  const json = JSON.stringify(result, null, 2);
  await io.writeFile(outPath, json);
  await io.writeFile(latestPath, json);
  return { outPath, latestPath };
}

export const defaultIo = { mkdir, writeFile };
