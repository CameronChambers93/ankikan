/**
 * Unit tests for perf/compare.mjs (baseline-diff comparator), issue #44 AC 21-36.
 *
 * compare.mjs is the pure baseline-diff half of the Tier-1 perf suite: given a
 * baseline `{meta, records}` result and a current one, it joins records on
 * (suite, scenario, size, variant) and decides ok/regression/improvement/new/
 * dropped per key using a two-gate rule (relative % AND absolute floor ms, both
 * on p50 only — p95/max are informational). These tests build fixtures with the
 * real `record()` helper from perf/lib/bench.js (never hand-rolled literals) and
 * import the comparator itself — none of its logic is reimplemented here.
 *
 * RED-phase note: perf/compare.mjs does not exist yet, so every import below
 * fails at module-resolution time until the developer implements it. That is
 * the correct starting state for this slice.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { record } from './lib/bench.js';
import { compareRuns, DEFAULT_TOLERANCES, formatBaselineWrite, keyOf, main } from './compare.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Wraps records in the real `{meta, records}` shape perf/micro/run.js writes out. */
function makeRun(records, metaOverrides = {}) {
  return {
    meta: {
      tier: 'micro',
      timestamp: '2026-07-09T00:00:00.000Z',
      samples: 25,
      sizes: ['M'],
      ...metaOverrides,
    },
    records,
  };
}

/** Builds one record via the real `record()` helper, defaulting to a plausible tokenize/dense/M row. */
function mkRecord({ suite = 'tokenize', scenario = 'dense', size = 'M', variant = null, p50, p95, max, mean, n = 25 }) {
  return record({
    suite,
    scenario,
    size,
    variant,
    stats: { p50, p95: p95 ?? p50, max: max ?? p50, mean: mean ?? p50, n },
  });
}

describe('compareRuns — identical runs', () => {
  it('T-44-019 identical baseline and current records are all status ok with zero regression/improvement/new/dropped counts', () => {
    const rec = mkRecord({ p50: 100, p95: 150, max: 200 });
    const baseline = makeRun([rec]);
    const current = makeRun([{ ...rec }]);

    const result = compareRuns(baseline, current);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].status).toBe('ok');
    expect(result.summary).toEqual({ ok: 1, regression: 0, improvement: 0, new: 0, dropped: 0 });
  });
});

describe('compareRuns — regression gating (p50 increase)', () => {
  it('T-44-020 p50 100 to 120 trips both the relative and absolute gate: status regression', () => {
    // deltaPct = 20% > 15% tolerance.relative; deltaMs = 20ms > 2ms absoluteFloorMs — both gates trip.
    const baseline = makeRun([mkRecord({ p50: 100, p95: 150, max: 200 })]);
    const current = makeRun([mkRecord({ p50: 120, p95: 150, max: 200 })]);

    const result = compareRuns(baseline, current);

    expect(result.findings[0].status).toBe('regression');
    expect(result.findings[0].gates.relative.tripped).toBe(true);
    expect(result.findings[0].gates.absolute.tripped).toBe(true);
    expect(result.summary.regression).toBe(1);
  });
});

describe('compareRuns — absolute floor suppresses noise on tiny durations', () => {
  it('T-44-021 p50 0.1 to 0.4 trips the relative gate alone: absolute floor suppresses it, status ok', () => {
    // deltaPct = (0.4-0.1)/0.1 = 300% > 15% (relative trips), but deltaMs = 0.3ms < 2ms
    // absoluteFloorMs — the AND-gate means a huge relative swing on a near-zero
    // baseline never surfaces as a regression by itself.
    const baseline = makeRun([mkRecord({ p50: 0.1, p95: 0.1, max: 0.1 })]);
    const current = makeRun([mkRecord({ p50: 0.4, p95: 0.4, max: 0.4 })]);

    const result = compareRuns(baseline, current);

    expect(result.findings[0].gates.absolute.tripped).toBe(false);
    expect(result.findings[0].status).toBe('ok');
  });
});

describe('compareRuns — relative gate not tripped', () => {
  it('T-44-022 p50 100 to 100.5 does not trip the relative gate: status ok', () => {
    // deltaPct = 0.5% well under 15% tolerance.relative.
    const baseline = makeRun([mkRecord({ p50: 100, p95: 150, max: 200 })]);
    const current = makeRun([mkRecord({ p50: 100.5, p95: 150, max: 200 })]);

    const result = compareRuns(baseline, current);

    expect(result.findings[0].gates.relative.tripped).toBe(false);
    expect(result.findings[0].status).toBe('ok');
  });
});

describe('compareRuns — AND-logic between the two gates', () => {
  it('T-44-023 p50 100 to 103 clears the absolute floor but not the relative tolerance: status ok', () => {
    // deltaMs = 3ms > 2ms absoluteFloorMs (floor cleared), but deltaPct = 3% < 15%
    // relative tolerance (not tripped) — proves both gates must trip, not just one.
    const baseline = makeRun([mkRecord({ p50: 100, p95: 150, max: 200 })]);
    const current = makeRun([mkRecord({ p50: 103, p95: 150, max: 200 })]);

    const result = compareRuns(baseline, current);

    expect(result.findings[0].gates.absolute.tripped).toBe(true);
    expect(result.findings[0].gates.relative.tripped).toBe(false);
    expect(result.findings[0].status).toBe('ok');
  });
});

describe('compareRuns — improvement gating (p50 decrease)', () => {
  it('T-44-024 p50 100 to 70 trips both gates in the negative direction: status improvement', () => {
    // deltaPct = -30%, deltaMs = -30ms — both magnitudes clear their tolerances,
    // and the sign is negative (current faster than baseline).
    const baseline = makeRun([mkRecord({ p50: 100, p95: 150, max: 200 })]);
    const current = makeRun([mkRecord({ p50: 70, p95: 150, max: 200 })]);

    const result = compareRuns(baseline, current);

    expect(result.findings[0].status).toBe('improvement');
    expect(result.summary.improvement).toBe(1);
  });
});

describe('compareRuns — current-only record', () => {
  it('T-44-025 a record present only in current is status new with null gates and counted in summary.new', () => {
    const baseline = makeRun([]);
    const current = makeRun([mkRecord({ scenario: 'brand-new', p50: 50, p95: 60, max: 70 })]);

    const result = compareRuns(baseline, current);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].status).toBe('new');
    expect(result.findings[0].baseline).toBeNull();
    expect(result.findings[0].gates).toBeNull();
    expect(result.summary.new).toBe(1);
  });
});

describe('compareRuns — baseline-only record', () => {
  it('T-44-026 a record present only in baseline is status dropped with null gates and counted in summary.dropped', () => {
    const baseline = makeRun([mkRecord({ scenario: 'retired', p50: 50, p95: 60, max: 70 })]);
    const current = makeRun([]);

    const result = compareRuns(baseline, current);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].status).toBe('dropped');
    expect(result.findings[0].current).toBeNull();
    expect(result.findings[0].gates).toBeNull();
    expect(result.summary.dropped).toBe(1);
  });
});

describe('compareRuns — join key distinguishes null vs named variant', () => {
  it('T-44-027 variant null and variant "dense" are distinct join tuples, not matched against each other', () => {
    const baselineRec = mkRecord({ variant: null, p50: 100, p95: 150, max: 200 });
    const currentRec = mkRecord({ variant: 'dense', p50: 999, p95: 999, max: 999 });

    // Same (suite, scenario, size) but different variant — keyOf must not collapse them.
    expect(keyOf(baselineRec)).not.toBe(keyOf(currentRec));

    const result = compareRuns(makeRun([baselineRec]), makeRun([currentRec]));

    // Because the tuples don't match, this must surface as one dropped row
    // (the null-variant baseline record) and one new row (the dense-variant
    // current record) — never a single ok/regression/improvement row that
    // would wrongly compare unrelated variants against each other.
    expect(result.findings).toHaveLength(2);
    const statuses = result.findings.map((f) => f.status).sort();
    expect(statuses).toEqual(['dropped', 'new']);
  });
});

describe('compareRuns — p95/max are informational only', () => {
  it('T-44-028 flat p50 with p95 up 500% stays status ok while still reporting the p95/max deltas', () => {
    const baseline = makeRun([mkRecord({ p50: 100, p95: 100, max: 100 })]);
    const current = makeRun([mkRecord({ p50: 100, p95: 600, max: 600 })]);

    const result = compareRuns(baseline, current);

    expect(result.findings[0].status).toBe('ok');
    expect(result.findings[0].delta.p95Ms).toBe(500);
    expect(result.findings[0].delta.maxMs).toBe(500);
  });
});

describe('DEFAULT_TOLERANCES', () => {
  it('T-44-029 DEFAULT_TOLERANCES.micro is applied by default: relative 0.15, absoluteFloorMs 2', () => {
    expect(DEFAULT_TOLERANCES.micro).toEqual({ relative: 0.15, absoluteFloorMs: 2 });

    const baseline = makeRun([mkRecord({ p50: 100, p95: 100, max: 100 })]);
    const current = makeRun([mkRecord({ p50: 100, p95: 100, max: 100 })]);
    const result = compareRuns(baseline, current);

    expect(result.tolerance).toEqual({ relative: 0.15, absoluteFloorMs: 2 });
  });
});

describe('compareRuns — opts.tolerances override', () => {
  it('T-44-030 overriding micro.relative to 0.5 flips a 20% p50 delta from regression to ok', () => {
    // Same fixture as T-44-020 (100 -> 120, a 20% delta) which regresses under the
    // default 15% relative tolerance; a caller-supplied 50% tolerance must not trip.
    const baseline = makeRun([mkRecord({ p50: 100, p95: 150, max: 200 })]);
    const current = makeRun([mkRecord({ p50: 120, p95: 150, max: 200 })]);

    const result = compareRuns(baseline, current, {
      tolerances: { micro: { relative: 0.5, absoluteFloorMs: 2 } },
    });

    expect(result.findings[0].gates.relative.tripped).toBe(false);
    expect(result.findings[0].status).toBe('ok');
  });
});

describe('formatBaselineWrite', () => {
  it('T-44-031 formatBaselineWrite(current) deep-equals current unchanged', () => {
    const current = makeRun([mkRecord({ p50: 42, p95: 55, max: 70 })]);

    expect(formatBaselineWrite(current)).toEqual(current);
  });
});

describe('perf/baseline.local.json — committed schema', () => {
  it('T-44-032 the committed baseline file parses as JSON and matches the results-contract schema', () => {
    // Deliberately reads the real file with fs, no mock — this is a schema
    // check on the actual committed dev-machine baseline, not a fixture.
    // Expected RED: the file does not exist yet in this slice.
    const baselinePath = path.join(__dirname, 'baseline.local.json');
    const raw = fs.readFileSync(baselinePath, 'utf-8');
    const parsed = JSON.parse(raw);

    expect(parsed.meta).toBeTypeOf('object');
    expect(typeof parsed.meta.tier).toBe('string');
    expect(typeof parsed.meta.timestamp).toBe('string');
    expect(typeof parsed.meta.samples).toBe('number');
    expect(Array.isArray(parsed.meta.sizes)).toBe(true);
    expect(Array.isArray(parsed.records)).toBe(true);
    expect(parsed.records.length).toBeGreaterThan(0);
    for (const rec of parsed.records) {
      expect(typeof rec.suite).toBe('string');
      expect(typeof rec.scenario).toBe('string');
      expect(typeof rec.p50).toBe('number');
      expect(typeof rec.p95).toBe('number');
      expect(typeof rec.max).toBe('number');
      expect(typeof rec.mean).toBe('number');
      expect(typeof rec.n).toBe('number');
    }
  });
});

describe('main — no --check flag', () => {
  it('T-44-033 a regression with no --check flag returns exit code 0', async () => {
    const baseline = makeRun([mkRecord({ p50: 100, p95: 150, max: 200 })]);
    const current = makeRun([mkRecord({ p50: 120, p95: 150, max: 200 })]);
    const io = {
      readFile: (p) => (p === 'baseline.json' ? JSON.stringify(baseline) : JSON.stringify(current)),
      writeFile: vi.fn(),
      log: vi.fn(),
      error: vi.fn(),
    };

    const exitCode = await main(['--baseline', 'baseline.json', '--current', 'current.json'], io);

    expect(exitCode).toBe(0);
  });
});

describe('main — --check flag', () => {
  it('T-44-034 a regression with --check returns exit code 1', async () => {
    const baseline = makeRun([mkRecord({ p50: 100, p95: 150, max: 200 })]);
    const current = makeRun([mkRecord({ p50: 120, p95: 150, max: 200 })]);
    const io = {
      readFile: (p) => (p === 'baseline.json' ? JSON.stringify(baseline) : JSON.stringify(current)),
      writeFile: vi.fn(),
      log: vi.fn(),
      error: vi.fn(),
    };

    const exitCode = await main(['--baseline', 'baseline.json', '--current', 'current.json', '--check'], io);

    expect(exitCode).toBe(1);
  });
});

describe('compareRuns — zero-baseline edge cases', () => {
  it('T-44-035 baseline p50 of 0 with current p50 of 1ms stays under the absolute floor: status ok', () => {
    // deltaMs = 1ms < 2ms absoluteFloorMs — the absolute gate alone suppresses
    // the otherwise-infinite relative delta from a zero baseline.
    const baseline = makeRun([mkRecord({ p50: 0, p95: 0, max: 0 })]);
    const current = makeRun([mkRecord({ p50: 1, p95: 1, max: 1 })]);

    const result = compareRuns(baseline, current);

    expect(result.findings[0].gates.absolute.tripped).toBe(false);
    expect(result.findings[0].status).toBe('ok');
  });

  it('T-44-036 baseline p50 of 0 with current p50 of 5ms clears the absolute floor: status regression', () => {
    // deltaMs = 5ms > 2ms absoluteFloorMs, and a zero baseline auto-trips the
    // relative gate per spec (deltaPct = Infinity when deltaMs > 0) — both gates trip.
    const baseline = makeRun([mkRecord({ p50: 0, p95: 0, max: 0 })]);
    const current = makeRun([mkRecord({ p50: 5, p95: 5, max: 5 })]);

    const result = compareRuns(baseline, current);

    expect(result.findings[0].gates.absolute.tripped).toBe(true);
    expect(result.findings[0].gates.relative.tripped).toBe(true);
    expect(result.findings[0].status).toBe('regression');
  });
});
