/**
 * Unit tests for sample() and stats() (perf/lib/bench.js), issue #44 AC 18-19.
 *
 * These are the two Tier-1 refinements flagged as currently-untested pure
 * functions in this issue: sample()'s default sample count regressed silently
 * once before (hence the plan's DEFAULT_SAMPLES 8→25 bump), and stats() has
 * never had a hand-computed regression lock despite backing every perf baseline
 * diff.
 */
import { describe, it, expect } from 'vitest';
import { sample, stats } from './bench.js';

describe('sample — default sample count', () => {
  it('T-44-017 with no PERF_SAMPLES env override and no explicit samples option, 25 samples are taken', async () => {
    // Asserted indirectly via stats().n, which is the sample count actually fed
    // through the harness — this is exactly what would regress if
    // DEFAULT_SAMPLES silently reverted to 8. Deleting the env var first makes
    // the test hermetic regardless of the shell it runs in.
    delete process.env.PERF_SAMPLES;
    const result = await sample(() => {});
    expect(result.n).toBe(25);
  });
});

describe('stats — percentile/extrema computation', () => {
  it('T-44-018 p50/p95/max/min/mean/n match hand-computed values for a known input array', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = stats(xs);

    // Hand-computed against the documented indexing rule:
    // q(p) = sorted[floor(p * (n - 1))], n = 10 (indices 0..9).
    // p50 -> floor(0.5*9)=4 -> sorted[4] = 5
    // p95 -> floor(0.95*9)=8 -> sorted[8] = 9
    expect(result.p50).toBe(5);
    expect(result.p95).toBe(9);
    expect(result.max).toBe(10);
    expect(result.min).toBe(1);
    expect(result.mean).toBe(5.5);
    expect(result.n).toBe(10);
  });
});
