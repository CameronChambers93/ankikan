/**
 * Minimal sampling harness for the perf suite.
 *
 * Deliberately not Tinybench: the suite reports p50/p95/max and diffs them
 * against a committed baseline, which fits a fixed-sample-count model far better
 * than an ops/sec-until-stable one. The key feature is `setupEach` — an untimed
 * per-sample hook that hands `fn` a fresh, unmutated input (e.g. a clean DOM), so
 * destructive operations like segmentAndWrap measure a true cold run every time.
 */

import { performance } from 'node:perf_hooks';

const DEFAULT_WARMUP = Number(process.env.PERF_WARMUP) || 2;

// Read lazily (inside sample(), not at module load) so tests can control the
// default hermetically by deleting process.env.PERF_SAMPLES before calling.
function defaultSamples() {
  return Number(process.env.PERF_SAMPLES) || 25;
}

/**
 * @param {number[]} xs - Durations in ms.
 * @returns {{p50:number,p95:number,max:number,min:number,mean:number,n:number}}
 */
export function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { p50: q(0.5), p95: q(0.95), max: s[s.length - 1], min: s[0], mean, n: s.length };
}

/**
 * Runs `fn` repeatedly and returns timing stats (ms).
 *
 * @param {(arg:any) => any|Promise<any>} fn - The operation under test.
 * @param {object} [opts]
 * @param {number} [opts.samples]
 * @param {number} [opts.warmup]
 * @param {(i:number) => any} [opts.setupEach] - Untimed; its return is passed to fn.
 * @returns {Promise<ReturnType<typeof stats>>}
 */
export async function sample(fn, { samples, warmup = DEFAULT_WARMUP, setupEach } = {}) {
  const nSamples = samples ?? defaultSamples();
  for (let i = 0; i < warmup; i++) {
    const arg = setupEach ? setupEach(-1 - i) : undefined;
    await fn(arg);
  }
  const durations = [];
  for (let i = 0; i < nSamples; i++) {
    const arg = setupEach ? setupEach(i) : undefined;
    const t0 = performance.now();
    await fn(arg);
    durations.push(performance.now() - t0);
  }
  return stats(durations);
}

/**
 * Builds one result record. `extra` carries non-timing metrics (span counts, etc.).
 *
 * @param {object} fields
 * @returns {object}
 */
export function record({ suite, scenario, size, variant, unit = 'ms', stats: st, extra = {} }) {
  return {
    suite, scenario, size: size ?? null, variant: variant ?? null, unit,
    p50: round(st.p50), p95: round(st.p95), max: round(st.max), mean: round(st.mean), n: st.n,
    ...extra,
  };
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}

/**
 * Prints results as an aligned table to stderr (so stdout stays JSON-clean).
 * @param {object[]} records
 */
export function printTable(records) {
  if (!records.length) return;
  const cols = ['suite', 'scenario', 'size', 'variant', 'p50', 'p95', 'max', 'unit'];
  const rows = records.map((r) => cols.map((c) => String(r[c] ?? '')));
  const widths = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => r[i].length)));
  const fmt = (cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join('  ');
  process.stderr.write(fmt(cols) + '\n');
  process.stderr.write(widths.map((w) => '-'.repeat(w)).join('  ') + '\n');
  for (const r of rows) process.stderr.write(fmt(r) + '\n');
}
