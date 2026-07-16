/**
 * Unit tests for perf/lib/write-results.js (issue #44 AC 105-109, Slice 9).
 *
 * write-results.js is the pure-assemble + injected-io-write half of Slice 9:
 * `assembleResults` wraps a literal records array in the `{meta, records}`
 * shape every Tier-2/3 harness needs (deliberately narrower than
 * `perf/micro/run.js`'s meta — no top-level `samples`/`node`/`durationMs`,
 * since Tier-2/3 records carry heterogeneous per-record `n` already), and
 * `writeResults` persists it via an injected `io` object so no test here ever
 * touches the real filesystem. `io.mkdir`/`io.writeFile` are `vi.fn()`
 * exactly as the "mock ONLY the injected io" convention requires — nothing
 * else is mocked.
 *
 * RED-phase note: perf/lib/write-results.js does not exist yet, so every
 * import below fails at module-resolution time until the developer
 * implements it. That is the correct starting state for this slice.
 */
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';

import { assembleResults, writeResults } from './write-results.js';

describe('assembleResults — pure shape via injected now', () => {
  it('T-44-107 returns {meta:{tier, timestamp: now().toISOString(), sizes, ...extraMeta}, records} with no samples/node/durationMs keys', () => {
    const fixedNow = () => new Date('2026-07-15T12:34:56.789Z');
    const records = [
      { suite: 'browser-smoke', scenario: 't_total', size: null, variant: null, unit: 'ms', p50: 42, p95: 42, max: 42, mean: 42, n: 1 },
    ];

    const result = assembleResults('e2e', records, {
      sizes: ['L'],
      now: fixedNow,
      extraMeta: { variant: 'dense' },
    });

    expect(result).toEqual({
      meta: {
        tier: 'e2e',
        timestamp: fixedNow().toISOString(),
        sizes: ['L'],
        variant: 'dense',
      },
      records,
    });

    // Deliberately narrower than perf/micro/run.js's meta — Tier-2/3 records
    // already carry heterogeneous per-record `n`, so a run-level `samples`
    // count (or `node`/`durationMs`) would be meaningless/misleading here.
    expect(result.meta).not.toHaveProperty('samples');
    expect(result.meta).not.toHaveProperty('node');
    expect(result.meta).not.toHaveProperty('durationMs');
  });
});

describe('assembleResults — determinism', () => {
  it('T-44-108 two calls with the same injected now produce identical meta.timestamp', () => {
    const fixedNow = () => new Date('2026-07-15T00:00:00.000Z');
    const records = [{ suite: 'stress-spa', scenario: 'heap-growth', size: null, variant: null, unit: 'bytes', p50: 1000, p95: 1000, max: 1000, mean: 1000, n: 1 }];

    const first = assembleResults('stress', records, { now: fixedNow });
    const second = assembleResults('stress', records, { now: fixedNow });

    expect(first.meta.timestamp).toBe(second.meta.timestamp);
    expect(first.meta.timestamp).toBe(fixedNow().toISOString());
  });
});

describe('writeResults — injected io calls', () => {
  it('T-44-109 calls io.mkdir once with resultsDir and io.writeFile exactly twice with byte-identical JSON', async () => {
    const result = {
      meta: { tier: 'e2e', timestamp: '2026-07-15T00:00:00.000Z', sizes: [] },
      records: [{ suite: 'browser-smoke', scenario: 't_total', size: null, variant: null, unit: 'ms', p50: 10, p95: 10, max: 10, mean: 10, n: 1 }],
    };
    const resultsDir = path.join('perf', 'results');
    const io = { mkdir: vi.fn(), writeFile: vi.fn() };

    await writeResults(result, { resultsDir, prefix: 'browser-smoke', io });

    expect(io.mkdir).toHaveBeenCalledTimes(1);
    expect(io.mkdir.mock.calls[0][0]).toBe(resultsDir);

    expect(io.writeFile).toHaveBeenCalledTimes(2);
    const expectedJson = JSON.stringify(result, null, 2);
    const [firstCall, secondCall] = io.writeFile.mock.calls;
    expect(firstCall[1]).toBe(expectedJson);
    expect(secondCall[1]).toBe(expectedJson);

    // One call targets a timestamped path, the other the -latest.json path —
    // neither call may accidentally target the same path twice.
    expect(firstCall[0]).not.toBe(secondCall[0]);
    expect(secondCall[0]).toMatch(/-latest\.json$/);
  });
});

describe('writeResults — timestamp sanitization parity with perf/micro/run.js', () => {
  it('T-44-110 colons and periods in the timestamp are replaced with - exactly like micro/run.js\'s .replace(/[:.]/g, \'-\')', async () => {
    const timestamp = '2026-07-15T00:00:00.000Z';
    const result = {
      meta: { tier: 'stress', timestamp, sizes: [] },
      records: [],
    };
    const resultsDir = path.join('perf', 'results');
    const io = { mkdir: vi.fn(), writeFile: vi.fn() };

    const { outPath } = await writeResults(result, { resultsDir, prefix: 'stress', io });

    // Computed independently via the same literal regex perf/micro/run.js
    // already applies (not a reimplementation of writeResults' own logic —
    // this is the expected-value derivation, mirroring the T-44-072-style
    // "compute expected via the real shared rule" pattern).
    const expectedStamp = timestamp.replace(/[:.]/g, '-');
    const expectedOutPath = path.join(resultsDir, `stress-${expectedStamp}.json`);

    expect(outPath).toBe(expectedOutPath);
    expect(outPath).not.toContain(':');
    // Only the extension's own dot should survive — no other periods from the timestamp.
    expect(outPath.replace(/\.json$/, '')).not.toContain('.');
  });
});

describe('writeResults — return value', () => {
  it('T-44-111 resolves to {outPath, latestPath} matching the two paths passed to io.writeFile', async () => {
    const result = {
      meta: { tier: 'e2e', timestamp: '2026-07-15T08:15:30.500Z', sizes: ['L'] },
      records: [],
    };
    const resultsDir = path.join('perf', 'results');
    const io = { mkdir: vi.fn(), writeFile: vi.fn() };

    const returned = await writeResults(result, { resultsDir, prefix: 'longtask', io });

    expect(io.writeFile.mock.calls[0][0]).toBe(returned.outPath);
    expect(io.writeFile.mock.calls[1][0]).toBe(returned.latestPath);
    expect(returned.outPath).not.toBe(returned.latestPath);
  });
});
