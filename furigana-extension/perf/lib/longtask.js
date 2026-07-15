/**
 * Pure aggregator for Long Tasks observer entries (issue #44 AC-87).
 *
 * Turns a batch of raw PerformanceObserver longtask entries into the
 * {count, totalDurationMs, longestDurationMs} shape the perf harness
 * records. Must stay pure and order-independent since the observer
 * callback can deliver entries in any batching order.
 */

/**
 * @param {Array<{name?: string, startTime?: number, duration: number}>} entries
 * @returns {{count: number, totalDurationMs: number, longestDurationMs: number}}
 */
export function summarizeLongTasks(entries) {
  const durations = entries.map((e) => e.duration);
  return {
    count: entries.length,
    totalDurationMs: durations.reduce((a, b) => a + b, 0),
    longestDurationMs: durations.length ? Math.max(...durations) : 0,
  };
}
