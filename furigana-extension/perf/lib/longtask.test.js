/**
 * Unit tests for summarizeLongTasks() (perf/lib/longtask.js), issue #44 AC 88-90.
 *
 * summarizeLongTasks is the pure aggregator behind the Long Tasks observer:
 * it turns a batch of raw PerformanceObserver longtask entries into the
 * {count, totalDurationMs, longestDurationMs} shape the perf harness records.
 * It must stay pure and order-independent since the observer callback can
 * deliver entries in any batching order and the same batch may be summarized
 * more than once during a run.
 */
import { describe, it, expect } from 'vitest';
import { summarizeLongTasks } from './longtask.js';

describe('summarizeLongTasks', () => {
  it('T-44-091 summarizeLongTasks reports exact count, sum, and max regardless of input order', () => {
    // Durations deliberately NOT sorted, and the true max (210) sits in the
    // middle of the array — this catches an implementation that just reads
    // the last element's duration or assumes pre-sorted input instead of
    // doing a real Math.max reduction.
    const entries = [
      { name: 'self', startTime: 0, duration: 60 },
      { name: 'self', startTime: 100, duration: 210 },
      { name: 'self', startTime: 400, duration: 55 },
      { name: 'self', startTime: 600, duration: 120 },
    ];

    const result = summarizeLongTasks(entries);

    expect(result.count).toBe(4);
    expect(result.totalDurationMs).toBe(445); // 60 + 210 + 55 + 120
    expect(result.longestDurationMs).toBe(210);
  });

  it('T-44-092 summarizeLongTasks returns zeros for an empty entry list without throwing', () => {
    // Math.max(...[]) is -Infinity, which would silently corrupt every
    // "no long tasks observed" run (the common case) unless explicitly
    // guarded — this locks the zero-fallback in place.
    expect(() => summarizeLongTasks([])).not.toThrow();
    expect(summarizeLongTasks([])).toEqual({
      count: 0,
      totalDurationMs: 0,
      longestDurationMs: 0,
    });
  });

  it('T-44-093 summarizeLongTasks is pure — deterministic and non-mutating', () => {
    const entries = [
      { name: 'self', startTime: 0, duration: 60 },
      { name: 'self', startTime: 100, duration: 210 },
      { name: 'self', startTime: 400, duration: 55 },
    ];
    const before = structuredClone(entries);

    const first = summarizeLongTasks(entries);
    const second = summarizeLongTasks(entries);

    // Deterministic: calling twice on the same input yields the same result.
    expect(first).toEqual(second);

    // Non-mutating: neither the array (length/order) nor its element objects
    // changed as a side effect of summarizing — a rogue in-place sort would
    // silently break the "any order" guarantee tested above.
    expect(entries.length).toBe(before.length);
    expect(entries).toEqual(before);
  });
});
