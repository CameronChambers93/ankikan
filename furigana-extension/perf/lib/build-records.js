/**
 * Pure builders that turn captured browser phase/heap/longtask data into
 * `{meta, records}`-compatible records. Imports only `record`/`stats` from
 * `./bench.js` — never from `compare.mjs` — so the dependency stays one-way:
 * builders produce records, the comparator consumes them.
 */

import { record, stats } from './bench.js';

function oneSample(value) {
  return { p50: value, p95: value, max: value, mean: value, n: 1 };
}

/**
 * Builds one ms record per phase measure (e.g. from `PerformanceMeasure`
 * entries), stripping the `ankikan:` prefix from `PERF_NAMES` scenario names.
 *
 * @param {{name: string, duration: number}[]} measures
 * @param {{suite?: string, size?: string|null, variant?: string|null}} [opts]
 * @returns {object[]}
 */
export function buildPhaseRecords(measures, { suite = 'browser-smoke', size = null, variant = null } = {}) {
  return measures.map(({ name, duration }) =>
    record({
      suite,
      scenario: name.startsWith('ankikan:') ? name.slice('ankikan:'.length) : name,
      size,
      variant,
      unit: 'ms',
      stats: oneSample(duration),
    })
  );
}

/**
 * Builds a single bytes record capturing heap growth: the delta between the
 * mean of the last 3 samples and the mean of the first 3. Not clamped —
 * a shrinking heap yields a legitimate negative value.
 *
 * @param {number[]} heapSamples
 * @param {{suite?: string, scenario?: string, size?: string|null, variant?: string|null}} [opts]
 * @returns {object}
 */
export function buildHeapGrowthRecord(
  heapSamples,
  { suite = 'stress-spa', scenario = 'heap-growth', size = null, variant = null } = {}
) {
  const firstMean = stats(heapSamples.slice(0, 3)).mean;
  const lastMean = stats(heapSamples.slice(-3)).mean;
  return record({
    suite,
    scenario,
    size,
    variant,
    unit: 'bytes',
    stats: oneSample(lastMean - firstMean),
    extra: { firstMeanBytes: firstMean, lastMeanBytes: lastMean, sampleCount: heapSamples.length },
  });
}

/**
 * Builds the two ms records (`longtask-total`, `longtask-longest`) from a
 * `summarizeLongTasks()` summary.
 *
 * @param {{totalDurationMs: number, longestDurationMs: number}} summary
 * @param {{suite?: string, size?: string|null, variant?: string|null}} [opts]
 * @returns {object[]}
 */
export function buildLongTaskRecords(summary, { suite = 'longtask', size = null, variant = null } = {}) {
  return [
    record({ suite, scenario: 'longtask-total', size, variant, unit: 'ms', stats: oneSample(summary.totalDurationMs) }),
    record({ suite, scenario: 'longtask-longest', size, variant, unit: 'ms', stats: oneSample(summary.longestDurationMs) }),
  ];
}
