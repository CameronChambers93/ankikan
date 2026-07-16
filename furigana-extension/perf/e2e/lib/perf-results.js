/**
 * Per-harness pure-assembly wrappers for the Tier-2/3 Playwright perf
 * harnesses. Each function composes Slice-8's pure record builders
 * (`buildPhaseRecords`, `buildLongTaskRecords`, `buildHeapGrowthRecord`)
 * with Slice-9's `assembleResults` to turn a harness's captured data into a
 * `{meta, records}` result — zero browser dependency.
 */

import { buildPhaseRecords, buildHeapGrowthRecord, buildLongTaskRecords } from '../../lib/build-records.js';
import { record, stats } from '../../lib/bench.js';
import { assembleResults } from '../../lib/write-results.js';

/**
 * @param {{name: string, duration: number}[]} measures
 * @param {object} [opts]
 * @returns {{meta: object, records: object[]}}
 */
export function assembleBrowserSmokeResult(measures, opts = {}) {
  return assembleResults('e2e', buildPhaseRecords(measures, { suite: 'browser-smoke' }), opts);
}

/**
 * @param {{totalDurationMs: number, longestDurationMs: number}} summary
 * @param {object} [opts]
 * @returns {{meta: object, records: object[]}}
 */
export function assembleLongtaskResult(summary, opts = {}) {
  return assembleResults(
    'e2e',
    buildLongTaskRecords(summary, { suite: 'longtask', size: 'L', variant: 'dense' }),
    opts
  );
}

/**
 * @param {{name: string, duration: number}[]} measures
 * @param {object} [opts]
 * @returns {{meta: object, records: object[]}}
 */
export function assembleWideScanResult(measures, opts = {}) {
  return assembleResults(
    'e2e',
    buildPhaseRecords(measures, { suite: 'wide-scan', size: 'L', variant: 'wide' }),
    opts
  );
}

/**
 * @param {{scrollDurations: number[], rescanDurations: number[], heapSamples: number[]}} captures
 * @param {object} [opts]
 * @returns {{meta: object, records: object[]}}
 */
export function assembleStressResult({ scrollDurations, rescanDurations, heapSamples }, opts = {}) {
  const records = [
    record({ suite: 'stress-scroll', scenario: 't_total', unit: 'ms', stats: stats(scrollDurations) }),
    record({ suite: 'stress-rescan', scenario: 't_total', unit: 'ms', stats: stats(rescanDurations) }),
    buildHeapGrowthRecord(heapSamples, { suite: 'stress-spa' }),
  ];
  return assembleResults('stress', records, opts);
}
