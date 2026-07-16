/**
 * Unit tests for perf/lib/build-records.js (issue #44 AC 98-103, Slice 8).
 *
 * build-records.js is the pure-builder half of Slice 8: it turns captured
 * browser phase measures, heap-growth samples, and Long Tasks summaries into
 * `{meta, records}`-compatible record objects that flow through the existing
 * `compareRuns` comparator with zero special-casing. Every expected-value
 * computation here reuses real, already-tested helpers (`stats` from
 * perf/lib/bench.js, `summarizeLongTasks` from perf/lib/longtask.js,
 * `PERF_NAMES` from content.timing.js) rather than hand-rolling numbers, and
 * `compareRuns`/`record` are imported directly — none of their logic is
 * reimplemented in this file.
 *
 * RED-phase note: perf/lib/build-records.js does not exist yet, so every
 * import below fails at module-resolution time until the developer
 * implements it. That is the correct starting state for this slice.
 */
import { describe, it, expect } from 'vitest';

import { buildPhaseRecords, buildHeapGrowthRecord, buildLongTaskRecords } from './build-records.js';
import { stats } from './bench.js';
import { summarizeLongTasks } from './longtask.js';
import { compareRuns } from '../compare.mjs';
import { PERF_NAMES } from '../../content.timing.js';

/** Wraps records in the real `{meta, records}` shape perf/micro/run.js writes out. */
function makeRun(records, metaOverrides = {}) {
  return {
    meta: {
      tier: 'stress',
      timestamp: '2026-07-15T00:00:00.000Z',
      samples: 1,
      sizes: ['M'],
      ...metaOverrides,
    },
    records,
  };
}

describe('buildPhaseRecords — one ms record per measure', () => {
  it('T-44-101 each measure built from real PERF_NAMES yields a record with matching p50/p95/max/mean, unit ms, n 1, and an ankikan-prefix-stripped scenario', () => {
    const measures = [
      { name: PERF_NAMES.TOTAL, duration: 42.5 },
      { name: PERF_NAMES.SEGMENT, duration: 10.1 },
      { name: PERF_NAMES.ANKI_FINDCARDS, duration: 5.3 },
      { name: PERF_NAMES.ANKI_CARDSINFO, duration: 8.7 },
      { name: PERF_NAMES.DOM_INJECT, duration: 3.2 },
    ];

    const records = buildPhaseRecords(measures);

    expect(records).toHaveLength(measures.length);
    records.forEach((rec, i) => {
      expect(rec.unit).toBe('ms');
      expect(rec.n).toBe(1);
      expect(rec.p50).toBe(measures[i].duration);
      expect(rec.p95).toBe(measures[i].duration);
      expect(rec.max).toBe(measures[i].duration);
      expect(rec.mean).toBe(measures[i].duration);
      expect(rec.scenario).toBe(measures[i].name.replace('ankikan:', ''));
    });

    // Explicit lock on the PERF_NAMES.TOTAL -> 't_total' example from the spec.
    const totalRecord = records.find((r) => r.scenario === 't_total');
    expect(totalRecord).toBeDefined();
    expect(totalRecord.p50).toBe(42.5);
  });
});

describe('buildPhaseRecords — empty input', () => {
  it('T-44-102 an empty measures array returns an empty array without throwing', () => {
    expect(() => buildPhaseRecords([])).not.toThrow();
    expect(buildPhaseRecords([])).toEqual([]);
  });
});

describe('buildHeapGrowthRecord — matches an independently computed stats() delta', () => {
  it('T-44-103 p50 equals stats(heapSamples.slice(-3)).mean minus stats(heapSamples.slice(0,3)).mean computed via the real stats() helper', () => {
    // 8-sample heap-bytes array mirroring stress.perf.js's SPA-renavigation
    // scenario: later samples meaningfully larger than earlier ones.
    const heapSamples = [
      10_000_000, 10_200_000, 10_100_000,
      12_000_000, 12_500_000,
      13_000_000, 13_200_000, 13_500_000,
    ];

    const rec = buildHeapGrowthRecord(heapSamples);

    // Never hand-computed — reuses the real stats() helper from bench.js,
    // mirroring exactly what T-44-072's inline stress.perf.js math already checks.
    const expectedDelta = stats(heapSamples.slice(-3)).mean - stats(heapSamples.slice(0, 3)).mean;

    expect(rec.unit).toBe('bytes');
    expect(rec.n).toBe(1);
    expect(rec.p50).toBeCloseTo(expectedDelta, 3);
    expect(rec.firstMeanBytes).toBeCloseTo(stats(heapSamples.slice(0, 3)).mean, 3);
    expect(rec.lastMeanBytes).toBeCloseTo(stats(heapSamples.slice(-3)).mean, 3);
    expect(rec.sampleCount).toBe(heapSamples.length);
  });
});

describe('buildHeapGrowthRecord — negative growth is a valid, non-clamped value', () => {
  it('T-44-104 a shrinking heap yields a negative p50, and embedding it as a baseline against a meaningfully larger positive-growth current run classifies as a real regression', () => {
    // Shrinking heap: last-3 mean is well below the first-3 mean.
    const shrinkingSamples = [
      15_000_000, 14_800_000, 14_700_000,
      10_000_000, 9_800_000,
      9_500_000, 9_400_000, 9_300_000,
    ];
    // Growing heap: last-3 mean is well above the first-3 mean.
    const growingSamples = [
      10_000_000, 10_100_000, 10_200_000,
      30_000_000, 31_000_000,
      32_000_000, 33_000_000, 34_000_000,
    ];

    const baselineRec = buildHeapGrowthRecord(shrinkingSamples);
    expect(baselineRec.p50).toBeLessThan(0);

    const currentRec = buildHeapGrowthRecord(growingSamples);
    expect(currentRec.p50).toBeGreaterThan(0);

    const baseline = makeRun([baselineRec]);
    const current = makeRun([currentRec]);

    const result = compareRuns(baseline, current);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].gates.relative.tripped).toBe(true);
    expect(result.findings[0].gates.absolute.tripped).toBe(true);
    expect(result.findings[0].status).toBe('regression');
  });
});

describe('buildLongTaskRecords — real summarizeLongTasks() output', () => {
  it('T-44-105 returns exactly two ms records, longtask-total and longtask-longest, matching summary.totalDurationMs and summary.longestDurationMs', () => {
    // Never hand-rolled — the summary comes from the real summarizeLongTasks()
    // aggregator applied to a literal entries array.
    const entries = [
      { name: 'self', startTime: 0, duration: 60 },
      { name: 'self', startTime: 100, duration: 210 },
      { name: 'self', startTime: 400, duration: 55 },
    ];
    const summary = summarizeLongTasks(entries);

    const records = buildLongTaskRecords(summary);

    expect(records).toHaveLength(2);

    const total = records.find((r) => r.scenario === 'longtask-total');
    const longest = records.find((r) => r.scenario === 'longtask-longest');

    expect(total).toBeDefined();
    expect(longest).toBeDefined();
    expect(total.unit).toBe('ms');
    expect(longest.unit).toBe('ms');
    expect(total.n).toBe(1);
    expect(longest.n).toBe(1);
    expect(total.p50).toBe(summary.totalDurationMs);
    expect(longest.p50).toBe(summary.longestDurationMs);
  });
});

describe('build-records — builder-only runs round-trip through compareRuns end-to-end', () => {
  it('T-44-106 two {meta, records} runs built only via buildPhaseRecords/buildHeapGrowthRecord/buildLongTaskRecords classify regression/ok exactly as any other record shape would', () => {
    const baselineMeasures = [
      { name: PERF_NAMES.TOTAL, duration: 40 },
      { name: PERF_NAMES.SEGMENT, duration: 10 },
    ];
    const currentMeasures = [
      { name: PERF_NAMES.TOTAL, duration: 90 }, // big regression
      { name: PERF_NAMES.SEGMENT, duration: 10.2 }, // effectively unchanged
    ];

    // Flat-ish baseline heap vs a meaningfully-growing current heap.
    const baselineHeap = [
      10_000_000, 10_100_000, 10_050_000,
      10_200_000, 10_150_000,
      10_300_000, 10_250_000, 10_400_000,
    ];
    const currentHeap = [
      10_000_000, 10_100_000, 10_050_000,
      20_000_000, 20_500_000,
      21_000_000, 21_500_000, 22_000_000,
    ];

    // Small, tolerance-suppressed long-task delta (should stay ok).
    const baselineLongtaskEntries = [{ name: 'self', startTime: 0, duration: 30 }];
    const currentLongtaskEntries = [{ name: 'self', startTime: 0, duration: 32 }];

    const baselineRecords = [
      ...buildPhaseRecords(baselineMeasures),
      buildHeapGrowthRecord(baselineHeap),
      ...buildLongTaskRecords(summarizeLongTasks(baselineLongtaskEntries)),
    ];
    const currentRecords = [
      ...buildPhaseRecords(currentMeasures),
      buildHeapGrowthRecord(currentHeap),
      ...buildLongTaskRecords(summarizeLongTasks(currentLongtaskEntries)),
    ];

    const baseline = makeRun(baselineRecords);
    const current = makeRun(currentRecords);

    const result = compareRuns(baseline, current);

    const totalFinding = result.findings.find((f) => f.key.scenario === 't_total');
    const segmentFinding = result.findings.find((f) => f.key.scenario === 't_segment');
    const heapFinding = result.findings.find((f) => f.key.scenario === 'heap-growth');
    const longtaskFinding = result.findings.find((f) => f.key.scenario === 'longtask-total');

    expect(totalFinding).toBeDefined();
    expect(segmentFinding).toBeDefined();
    expect(heapFinding).toBeDefined();
    expect(longtaskFinding).toBeDefined();

    expect(totalFinding.status).toBe('regression');
    expect(segmentFinding.status).toBe('ok');
    expect(heapFinding.status).toBe('regression');
    expect(longtaskFinding.status).toBe('ok');
  });
});
