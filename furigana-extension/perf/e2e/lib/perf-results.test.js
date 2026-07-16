/**
 * Unit tests for perf/e2e/lib/perf-results.js (issue #44 AC 110-113, Slice 9).
 *
 * perf-results.js is the per-harness pure-assembly-wrapper half of Slice 9:
 * `assembleBrowserSmokeResult`/`assembleLongtaskResult`/`assembleStressResult`
 * compose Slice-8's pure record builders (`buildPhaseRecords`,
 * `buildLongTaskRecords`, `buildHeapGrowthRecord`) with Slice-9's
 * `assembleResults` to turn each Tier-2/3 Playwright harness's captured data
 * into a `{meta, records}` result — zero browser dependency, fully
 * Vitest-testable. Every expected value is derived by calling the *same* real
 * builder/comparator functions the wrappers themselves must call — nothing is
 * hand-rolled or reimplemented here.
 *
 * RED-phase note: perf/e2e/lib/perf-results.js does not exist yet, so every
 * import below fails at module-resolution time until the developer
 * implements it. That is the correct starting state for this slice.
 */
import { describe, it, expect } from 'vitest';

import {
  assembleBrowserSmokeResult,
  assembleLongtaskResult,
  assembleStressResult,
} from './perf-results.js';
import { buildPhaseRecords, buildHeapGrowthRecord, buildLongTaskRecords } from '../../lib/build-records.js';
import { record, stats } from '../../lib/bench.js';
import { summarizeLongTasks } from '../../lib/longtask.js';
import { compareRuns } from '../../compare.mjs';
import { PERF_NAMES } from '../../../content.timing.js';

const fixedNow = () => new Date('2026-07-15T00:00:00.000Z');

/**
 * A literal 5-entry ankikanMeasures array shaped exactly like
 * browser-smoke.perf.js's real `page.evaluate()` capture: real `PERF_NAMES`
 * values paired with plausible durations and startTimes.
 */
function makeBrowserSmokeMeasures() {
  return [
    { name: PERF_NAMES.SEGMENT, duration: 12.4, startTime: 0 },
    { name: PERF_NAMES.DOM_INJECT, duration: 3.1, startTime: 12.4 },
    { name: PERF_NAMES.ANKI_FINDCARDS, duration: 8.6, startTime: 15.5 },
    { name: PERF_NAMES.ANKI_CARDSINFO, duration: 6.2, startTime: 24.1 },
    { name: PERF_NAMES.TOTAL, duration: 31.9, startTime: 0 },
  ];
}

/** A literal longtask entries array, reduced via the real summarizeLongTasks(). */
function makeLongtaskSummary() {
  const entries = [
    { name: 'self', startTime: 0, duration: 62 },
    { name: 'self', startTime: 200, duration: 55 },
  ];
  return summarizeLongTasks(entries);
}

/** Literal stress-harness captures shaped like stress.perf.js's three real accumulators. */
function makeStressCaptures() {
  return {
    scrollDurations: [18.2, 20.1, 19.4, 21.0, 17.8, 19.9],
    rescanDurations: [5.1, 5.4, 5.0, 5.3, 5.2],
    heapSamples: [
      10_000_000, 10_100_000, 10_050_000,
      10_200_000, 10_150_000,
      10_300_000, 10_250_000, 10_400_000,
    ],
  };
}

describe('assembleBrowserSmokeResult — composition of buildPhaseRecords', () => {
  it('T-44-112 records deep-equal buildPhaseRecords(measures, {suite:"browser-smoke"}) and meta.tier is e2e', () => {
    const measures = makeBrowserSmokeMeasures();

    const result = assembleBrowserSmokeResult(measures, { now: fixedNow });

    expect(result.records).toEqual(buildPhaseRecords(measures, { suite: 'browser-smoke' }));
    expect(result.meta.tier).toBe('e2e');
    expect(result.meta.timestamp).toBe(fixedNow().toISOString());
  });
});

describe('assembleLongtaskResult — composition of buildLongTaskRecords', () => {
  it('T-44-113 records deep-equal buildLongTaskRecords(summary, {suite:"longtask", size:"L", variant:"dense"}) and meta.tier is e2e', () => {
    const summary = makeLongtaskSummary();

    const result = assembleLongtaskResult(summary, { now: fixedNow });

    expect(result.records).toEqual(
      buildLongTaskRecords(summary, { suite: 'longtask', size: 'L', variant: 'dense' })
    );
    expect(result.meta.tier).toBe('e2e');
  });
});

describe('assembleStressResult — 3-record composition (2 ms stats records + 1 heap-growth bytes record)', () => {
  it('T-44-114 returns exactly 3 records matching independently-computed stats()/buildHeapGrowthRecord output, meta.tier is stress', () => {
    const { scrollDurations, rescanDurations, heapSamples } = makeStressCaptures();

    const result = assembleStressResult({ scrollDurations, rescanDurations, heapSamples }, { now: fixedNow });

    expect(result.records).toHaveLength(3);
    expect(result.meta.tier).toBe('stress');

    const scrollRecord = result.records.find((r) => r.suite === 'stress-scroll');
    const rescanRecord = result.records.find((r) => r.suite === 'stress-rescan');
    const heapRecord = result.records.find((r) => r.suite === 'stress-spa');

    expect(scrollRecord).toBeDefined();
    expect(rescanRecord).toBeDefined();
    expect(heapRecord).toBeDefined();

    // Computed independently in-test via the real stats()/record() helpers —
    // never hand-rolled — so this proves the wrapper calls the real functions
    // rather than reimplementing their math.
    const expectedScrollStats = stats(scrollDurations);
    const expectedRescanStats = stats(rescanDurations);

    expect(scrollRecord).toEqual(
      record({ suite: 'stress-scroll', scenario: 't_total', unit: 'ms', stats: expectedScrollStats })
    );
    expect(rescanRecord).toEqual(
      record({ suite: 'stress-rescan', scenario: 't_total', unit: 'ms', stats: expectedRescanStats })
    );
    expect(heapRecord).toEqual(buildHeapGrowthRecord(heapSamples, { suite: 'stress-spa' }));

    // Explicit p50/p95/max/n lock beyond the object-equality checks above.
    expect(scrollRecord.p50).toBeCloseTo(expectedScrollStats.p50, 3);
    expect(scrollRecord.n).toBe(scrollDurations.length);
    expect(rescanRecord.p50).toBeCloseTo(expectedRescanStats.p50, 3);
    expect(rescanRecord.n).toBe(rescanDurations.length);
  });
});

describe('assembled results round-trip through compareRuns self-diff', () => {
  it('T-44-115 each of the three assembled runs, self-diffed (baseline = structuredClone of current), yields all findings status ok', () => {
    const browserSmokeCurrent = assembleBrowserSmokeResult(makeBrowserSmokeMeasures(), { now: fixedNow });
    const longtaskCurrent = assembleLongtaskResult(makeLongtaskSummary(), { now: fixedNow });
    const stressCurrent = assembleStressResult(makeStressCaptures(), { now: fixedNow });

    for (const current of [browserSmokeCurrent, longtaskCurrent, stressCurrent]) {
      const baseline = structuredClone(current);
      const result = compareRuns(baseline, current);

      expect(result.findings.length).toBeGreaterThan(0);
      for (const finding of result.findings) {
        expect(finding.status).toBe('ok');
      }
    }
  });
});
