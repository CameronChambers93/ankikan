/**
 * Tier-1 micro-benchmark runner.
 *
 * Builds the kuromoji tokenizer once, runs every *.bench.js suite, prints a table
 * to stderr, and writes a machine-readable results file to perf/results/ for the
 * baseline-diff step. Sizes default to S,M,L; override with PERF_SIZES (e.g.
 * "all" or "S,M,L,XL"). Sample count via PERF_SAMPLES.
 *
 *   node perf/micro/run.js
 *   PERF_SIZES=all PERF_SAMPLES=12 node perf/micro/run.js
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { getTokenizer } from '../lib/tokenizer.js';
import { resolveSizes } from '../fixtures/generate.js';
import { printTable } from '../lib/bench.js';

import { run as runTokenize } from './tokenize.bench.js';
import { run as runSegment } from './segment.bench.js';
import { run as runScan } from './scan.bench.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, '..', 'results');

const SUITES = [
  ['tokenize', runTokenize],
  ['segment', runSegment],
  ['scan', runScan],
];

async function main() {
  const sizes = resolveSizes(process.env.PERF_SIZES);
  const t0 = performance.now();

  process.stderr.write(`Building kuromoji tokenizer…\n`);
  const tokenizer = await getTokenizer();

  const ctx = { tokenizer, sizes };
  const records = [];
  for (const [name, run] of SUITES) {
    process.stderr.write(`Running ${name} (sizes: ${sizes.map((s) => s[0]).join(',')})…\n`);
    records.push(...(await run(ctx)));
  }

  printTable(records);

  const result = {
    meta: {
      tier: 'micro',
      timestamp: new Date().toISOString(),
      node: process.version,
      samples: Number(process.env.PERF_SAMPLES) || 8,
      sizes: sizes.map(([name]) => name),
      durationMs: Math.round(performance.now() - t0),
    },
    records,
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  const stamp = result.meta.timestamp.replace(/[:.]/g, '-');
  const outPath = path.join(RESULTS_DIR, `micro-${stamp}.json`);
  await writeFile(outPath, JSON.stringify(result, null, 2));
  await writeFile(path.join(RESULTS_DIR, 'micro-latest.json'), JSON.stringify(result, null, 2));
  process.stderr.write(`\nWrote ${outPath}\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
