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
import {
  compareRuns,
  DEFAULT_TOLERANCES,
  DEFAULT_ABSOLUTE_FLOORS_BY_UNIT,
  resolveAbsoluteFloor,
  formatBaselineWrite,
  formatMarkdownSummary,
  formatSummary,
  formatByUnit,
  formatDeltaByUnit,
  keyOf,
  main,
} from './compare.mjs';

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

/**
 * Builds a compareRuns() result carrying one finding of every status
 * (ok/regression/improvement/new/dropped) in a single table, so the
 * formatMarkdownSummary tests below can exercise every row kind at once.
 */
function makeMixedResult() {
  const baseline = makeRun([
    mkRecord({ scenario: 'steady', p50: 50, p95: 60, max: 70 }),
    mkRecord({ scenario: 'slower', p50: 100, p95: 150, max: 200 }),
    mkRecord({ scenario: 'faster', p50: 100, p95: 150, max: 200 }),
    mkRecord({ scenario: 'retired', p50: 10, p95: 15, max: 20 }),
  ]);
  const current = makeRun([
    mkRecord({ scenario: 'steady', p50: 50, p95: 60, max: 70 }),
    mkRecord({ scenario: 'slower', p50: 120, p95: 150, max: 200 }),
    mkRecord({ scenario: 'faster', p50: 70, p95: 150, max: 200 }),
    mkRecord({ scenario: 'brand-new', p50: 30, p95: 40, max: 50 }),
  ]);
  return compareRuns(baseline, current);
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

// ---------------------------------------------------------------------------
// Slice 6 — CI phase 1 (issue #44 AC 68-82).
//
// formatMarkdownSummary is a new pure export that renders a compareRuns()
// result as a GitHub-flavored markdown table for $GITHUB_STEP_SUMMARY, and
// main() grows two flags (--seed-on-missing, --markdown-out) so a nightly CI
// job can self-seed a missing perf/baseline.ci.json and post the table to the
// job summary. None of this exists yet — formatMarkdownSummary resolves to
// `undefined` on import (Vite/esbuild's ESM interop tolerates a missing named
// export at load time), so every test below fails when it is invoked, and the
// new `main` flags are silently no-ops in the current parseArgs, so the
// --seed-on-missing / --markdown-out tests fail on real assertion mismatches
// (wrong exit code, appendFile never called) rather than an import-time crash.
// ---------------------------------------------------------------------------

describe('formatMarkdownSummary — table shape', () => {
  it('T-44-073 a result mixing ok/regression/improvement/new/dropped findings renders a GFM table with one data row per finding', () => {
    const result = makeMixedResult();
    const md = formatMarkdownSummary(result);

    const tableLines = md.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));

    // Header row names the Status column; the line immediately after it is the
    // GFM separator row (a run of `| --- |`-style cells).
    expect(tableLines[0]).toMatch(/\|\s*Status\s*\|/i);
    expect(tableLines[1]).toMatch(/^\|(\s*-+\s*\|)+$/);

    // Exactly one data row per finding — no dropped rows, no duplicated rows.
    const dataRows = tableLines.slice(2);
    expect(dataRows).toHaveLength(result.findings.length);
  });
});

describe('formatMarkdownSummary — status token distinctness', () => {
  it('T-44-074 the regression row carries a status token distinct from the ok/improvement rows', () => {
    const result = makeMixedResult();
    const md = formatMarkdownSummary(result);
    const lines = md.split('\n');

    const regressionLine = lines.find((l) => l.includes('slower'));
    const okLine = lines.find((l) => l.includes('steady'));
    const improvementLine = lines.find((l) => l.includes('faster'));

    expect(regressionLine).toMatch(/REGRESSION/);
    expect(okLine).not.toMatch(/REGRESSION/);
    expect(improvementLine).not.toMatch(/REGRESSION/);
  });
});

describe('formatMarkdownSummary — new/dropped placeholders', () => {
  it('T-44-075 new and dropped rows render an em-dash placeholder in the p50/delta columns, never NaN/undefined, and do not throw', () => {
    const result = makeMixedResult();

    expect(() => formatMarkdownSummary(result)).not.toThrow();
    const md = formatMarkdownSummary(result);
    const lines = md.split('\n');

    const newLine = lines.find((l) => l.includes('brand-new'));
    const droppedLine = lines.find((l) => l.includes('retired'));

    expect(newLine).toContain('—');
    expect(droppedLine).toContain('—');
    expect(md).not.toMatch(/NaN/);
    expect(md).not.toMatch(/undefined/);
  });
});

describe('formatMarkdownSummary — trailing summary line', () => {
  it('T-44-076 the output ends with a summary line whose ok/regression/improvement/new/dropped counts equal result.summary', () => {
    const result = makeMixedResult();
    const md = formatMarkdownSummary(result);

    const okMatch = md.match(/ok=(\d+)/);
    const regressionMatch = md.match(/regression=(\d+)/);
    const improvementMatch = md.match(/improvement=(\d+)/);
    const newMatch = md.match(/new=(\d+)/);
    const droppedMatch = md.match(/dropped=(\d+)/);

    expect(okMatch).not.toBeNull();
    expect(regressionMatch).not.toBeNull();
    expect(improvementMatch).not.toBeNull();
    expect(newMatch).not.toBeNull();
    expect(droppedMatch).not.toBeNull();

    expect(Number(okMatch[1])).toBe(result.summary.ok);
    expect(Number(regressionMatch[1])).toBe(result.summary.regression);
    expect(Number(improvementMatch[1])).toBe(result.summary.improvement);
    expect(Number(newMatch[1])).toBe(result.summary.new);
    expect(Number(droppedMatch[1])).toBe(result.summary.dropped);

    // "Ends with" — the summary text must live in the back half of the output,
    // after the table, not buried above it.
    const trimmed = md.trimEnd();
    const summaryLineIndex = trimmed.lastIndexOf('ok=');
    expect(summaryLineIndex).toBeGreaterThan(trimmed.length / 2);
  });
});

describe('formatMarkdownSummary — seeded notice', () => {
  it('T-44-077 opts.seeded true adds a baseline-seeded notice absent from the unseeded call', () => {
    const result = makeMixedResult();

    const unseeded = formatMarkdownSummary(result);
    const seeded = formatMarkdownSummary(result, { seeded: true });

    expect(unseeded).not.toMatch(/seeded from this run/i);
    expect(seeded).toMatch(/seeded from this run/i);
  });
});

describe('main — --seed-on-missing with missing baseline', () => {
  it('T-44-078 seeds the baseline from the current run, logs a seed notice, and returns exit code 0 with zero regressions', async () => {
    const current = makeRun([mkRecord({ p50: 42, p95: 55, max: 70 })]);
    const currentJson = JSON.stringify(current);
    const io = {
      readFile: vi.fn((p) => {
        if (p === 'baseline.ci.json') throw new Error('ENOENT: no such file or directory');
        return currentJson;
      }),
      writeFile: vi.fn(),
      appendFile: vi.fn(),
      log: vi.fn(),
      error: vi.fn(),
    };

    const exitCode = await main(
      ['--baseline', 'baseline.ci.json', '--current', 'current.json', '--seed-on-missing'],
      io
    );

    expect(exitCode).toBe(0);
    expect(io.writeFile).toHaveBeenCalledTimes(1);

    const [writtenPath, writtenData] = io.writeFile.mock.calls[0];
    expect(writtenPath).toBe('baseline.ci.json');
    expect(JSON.parse(writtenData)).toEqual(current);

    // Self-diff (seeded baseline === current) must produce zero regressions,
    // and main must have logged some indication that it seeded rather than compared.
    const loggedText = io.log.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(loggedText).toMatch(/seed/i);
    expect(loggedText).toMatch(/regression=0/);
  });
});

describe('main — missing baseline without --seed-on-missing', () => {
  it('T-44-079 returns exit code 1 and never writes a baseline when the baseline file is missing', async () => {
    const current = makeRun([mkRecord({ p50: 42, p95: 55, max: 70 })]);
    const currentJson = JSON.stringify(current);
    const io = {
      readFile: vi.fn((p) => {
        if (p === 'baseline.ci.json') throw new Error('ENOENT: no such file or directory');
        return currentJson;
      }),
      writeFile: vi.fn(),
      appendFile: vi.fn(),
      log: vi.fn(),
      error: vi.fn(),
    };

    const exitCode = await main(['--baseline', 'baseline.ci.json', '--current', 'current.json'], io);

    expect(exitCode).toBe(1);
    expect(io.writeFile).not.toHaveBeenCalled();
  });
});

describe('main — --markdown-out appends the formatted summary', () => {
  it('T-44-080 appends formatMarkdownSummary(result) exactly once to the given path on a normal compare run', async () => {
    const baseline = makeRun([mkRecord({ p50: 100, p95: 150, max: 200 })]);
    const current = makeRun([mkRecord({ p50: 120, p95: 150, max: 200 })]);
    const baselineJson = JSON.stringify(baseline);
    const currentJson = JSON.stringify(current);
    const io = {
      readFile: (p) => (p === 'baseline.json' ? baselineJson : currentJson),
      writeFile: vi.fn(),
      appendFile: vi.fn(),
      log: vi.fn(),
      error: vi.fn(),
    };

    await main(
      ['--baseline', 'baseline.json', '--current', 'current.json', '--markdown-out', 'summary.md'],
      io
    );

    // Computed independently from the same in-memory fixtures, never hardcoded,
    // so this proves main appends the *actual* formatted result, not a stand-in string.
    const expectedResult = compareRuns(JSON.parse(baselineJson), JSON.parse(currentJson));
    const expectedMd = formatMarkdownSummary(expectedResult, { seeded: false }) + '\n';

    expect(io.appendFile).toHaveBeenCalledTimes(1);
    const [appendedPath, appendedData] = io.appendFile.mock.calls[0];
    expect(appendedPath).toBe('summary.md');
    expect(appendedData).toBe(expectedMd);
  });
});

describe('main — no --markdown-out', () => {
  it('T-44-081 never calls io.appendFile when --markdown-out is not given', async () => {
    const baseline = makeRun([mkRecord({ p50: 100, p95: 150, max: 200 })]);
    const current = makeRun([mkRecord({ p50: 100, p95: 150, max: 200 })]);
    const io = {
      readFile: (p) => (p === 'baseline.json' ? JSON.stringify(baseline) : JSON.stringify(current)),
      writeFile: vi.fn(),
      appendFile: vi.fn(),
      log: vi.fn(),
      error: vi.fn(),
    };

    await main(['--baseline', 'baseline.json', '--current', 'current.json'], io);

    expect(io.appendFile).not.toHaveBeenCalled();
  });
});

describe('main — combined --seed-on-missing and --markdown-out', () => {
  it('T-44-082 the single appended string contains both the seeded notice and a regression=0 summary line', async () => {
    const current = makeRun([mkRecord({ p50: 42, p95: 55, max: 70 })]);
    const currentJson = JSON.stringify(current);
    const io = {
      readFile: vi.fn((p) => {
        if (p === 'baseline.ci.json') throw new Error('ENOENT: no such file or directory');
        return currentJson;
      }),
      writeFile: vi.fn(),
      appendFile: vi.fn(),
      log: vi.fn(),
      error: vi.fn(),
    };

    await main(
      [
        '--baseline', 'baseline.ci.json',
        '--current', 'current.json',
        '--seed-on-missing',
        '--markdown-out', 'summary.md',
      ],
      io
    );

    expect(io.appendFile).toHaveBeenCalledTimes(1);
    const [, appendedData] = io.appendFile.mock.calls[0];
    expect(appendedData).toMatch(/seeded from this run/i);
    expect(appendedData).toMatch(/regression=0/);
  });
});

// ---------------------------------------------------------------------------
// Slice 8 — unit-aware gating (issue #44 AC 91-97).
//
// compareRuns()'s two-gate rule always used tol.absoluteFloorMs (an ms floor)
// as the absolute-gate value, even for non-ms records. This slice generalizes
// the absolute-floor lookup by the joined record's own `unit` field via a new
// DEFAULT_ABSOLUTE_FLOORS_BY_UNIT table and resolveAbsoluteFloor() helper,
// while keeping DEFAULT_TOLERANCES and the ms code path byte-identical to
// Slice 2 (T-44-019...036). None of this exists yet in compare.mjs, so every
// test below fails at either an import-time undefined-export or a real
// assertion mismatch (still falling back to the ms floor for non-ms units).
// ---------------------------------------------------------------------------

/** Builds one record via the real `record()` helper with an explicit `unit`, for bytes/count fixtures. */
function mkUnitRecord({ suite = 'stress-spa', scenario = 'heap-growth', size = null, variant = null, unit, p50, p95, max, mean, n = 8 }) {
  return record({
    suite,
    scenario,
    size,
    variant,
    unit,
    stats: { p50, p95: p95 ?? p50, max: max ?? p50, mean: mean ?? p50, n },
  });
}

describe('compareRuns — unit-aware gating regression lock (ms path unchanged)', () => {
  it('T-44-094 the ms fixture from T-44-020 still reports identical status/gates/floorMs after the unit-aware refactor', () => {
    // Same 100 -> 120 p50 fixture as the pre-refactor T-44-020: both gates
    // trip under the default ms floor, and gates.absolute.floorMs must still
    // read exactly tol.absoluteFloorMs (2) — the byte-identical legacy path.
    const baseline = makeRun([mkRecord({ p50: 100, p95: 150, max: 200 })]);
    const current = makeRun([mkRecord({ p50: 120, p95: 150, max: 200 })]);

    const result = compareRuns(baseline, current);

    expect(result.findings[0].status).toBe('regression');
    expect(result.findings[0].gates.relative.tripped).toBe(true);
    expect(result.findings[0].gates.absolute.tripped).toBe(true);
    expect(result.findings[0].gates.absolute.floorMs).toBe(DEFAULT_TOLERANCES.micro.absoluteFloorMs);
  });
});

describe('DEFAULT_TOLERANCES — shape unchanged by the unit-floor refactor', () => {
  it('T-44-095 DEFAULT_TOLERANCES.micro/.e2e/.stress each equal exactly {relative, absoluteFloorMs} with no extra keys', () => {
    expect(DEFAULT_TOLERANCES.micro).toEqual({ relative: 0.15, absoluteFloorMs: 2 });
    expect(DEFAULT_TOLERANCES.e2e).toEqual({ relative: 0.35, absoluteFloorMs: 2 });
    expect(DEFAULT_TOLERANCES.stress).toEqual({ relative: 0.35, absoluteFloorMs: 2 });

    // The additive unit-floor design must live in a separate table, never
    // merged into (or replacing) this tier-tolerance shape.
    expect(Object.keys(DEFAULT_TOLERANCES.micro).sort()).toEqual(['absoluteFloorMs', 'relative']);
  });
});

describe('compareRuns — bytes-unit relative gate alone does not trip a regression', () => {
  it('T-44-096 a ~4MB/40% bytes delta trips the relative gate but stays under the 5MB byte floor: status ok', () => {
    // deltaBytes = 4,000,000 < DEFAULT_ABSOLUTE_FLOORS_BY_UNIT.bytes (5,242,880),
    // deltaPct = 0.4 > stress tier's 0.35 relative tolerance — relative trips,
    // absolute does not, so the AND-gate keeps status at ok (mirrors the ms
    // near-zero-duration noise-suppression case, but at byte scale).
    const baseline = makeRun(
      [mkUnitRecord({ unit: 'bytes', p50: 10_000_000, p95: 10_000_000, max: 10_000_000 })],
      { tier: 'stress' }
    );
    const current = makeRun(
      [mkUnitRecord({ unit: 'bytes', p50: 14_000_000, p95: 14_000_000, max: 14_000_000 })],
      { tier: 'stress' }
    );

    const result = compareRuns(baseline, current);

    expect(result.findings[0].gates.relative.tripped).toBe(true);
    expect(result.findings[0].gates.absolute.tripped).toBe(false);
    expect(result.findings[0].status).toBe('ok');
  });
});

describe('compareRuns — bytes-unit both gates trip a real regression/improvement', () => {
  it('T-44-097 a 10MB/100% growth trips both bytes gates: status regression', () => {
    const baseline = makeRun(
      [mkUnitRecord({ unit: 'bytes', p50: 10_000_000, p95: 10_000_000, max: 10_000_000 })],
      { tier: 'stress' }
    );
    const current = makeRun(
      [mkUnitRecord({ unit: 'bytes', p50: 20_000_000, p95: 20_000_000, max: 20_000_000 })],
      { tier: 'stress' }
    );

    const result = compareRuns(baseline, current);

    expect(result.findings[0].gates.relative.tripped).toBe(true);
    expect(result.findings[0].gates.absolute.tripped).toBe(true);
    expect(result.findings[0].gates.absolute.floor).toBe(DEFAULT_ABSOLUTE_FLOORS_BY_UNIT.bytes);
    expect(result.findings[0].gates.absolute.unit).toBe('bytes');
    expect(result.findings[0].status).toBe('regression');
  });

  it('T-44-097 a 12MB/60% shrink trips both bytes gates in the negative direction: status improvement', () => {
    const baseline = makeRun(
      [mkUnitRecord({ unit: 'bytes', p50: 20_000_000, p95: 20_000_000, max: 20_000_000 })],
      { tier: 'stress' }
    );
    const current = makeRun(
      [mkUnitRecord({ unit: 'bytes', p50: 8_000_000, p95: 8_000_000, max: 8_000_000 })],
      { tier: 'stress' }
    );

    const result = compareRuns(baseline, current);

    expect(result.findings[0].gates.relative.tripped).toBe(true);
    expect(result.findings[0].gates.absolute.tripped).toBe(true);
    expect(result.findings[0].gates.absolute.floor).toBe(DEFAULT_ABSOLUTE_FLOORS_BY_UNIT.bytes);
    expect(result.findings[0].gates.absolute.unit).toBe('bytes');
    expect(result.findings[0].status).toBe('improvement');
  });
});

describe('compareRuns — count-unit records use DEFAULT_ABSOLUTE_FLOORS_BY_UNIT.count, not the ms fallback', () => {
  it('T-44-098 a 1.6-unit count delta trips the count floor (1) though it would not trip a wrongly-applied ms floor (2)', () => {
    // deltaMs (here, a count delta) = 1.6: under the ms fallback floor of 2 this
    // would NOT trip absolute (proving a bug if the implementation silently
    // fell back to the ms floor for an unrecognized unit); under the real
    // DEFAULT_ABSOLUTE_FLOORS_BY_UNIT.count (1) it DOES trip.
    expect(DEFAULT_ABSOLUTE_FLOORS_BY_UNIT.count).toBe(1);

    const baseline = makeRun([mkUnitRecord({ unit: 'count', p50: 10, p95: 10, max: 10 })]);
    const current = makeRun([mkUnitRecord({ unit: 'count', p50: 11.6, p95: 11.6, max: 11.6 })]);

    const result = compareRuns(baseline, current);

    expect(result.findings[0].gates.relative.tripped).toBe(true);
    expect(result.findings[0].gates.absolute.tripped).toBe(true);
    expect(result.findings[0].gates.absolute.unit).toBe('count');
    expect(result.findings[0].status).toBe('regression');
  });
});

describe('resolveAbsoluteFloor — direct unit tests', () => {
  it('T-44-098 resolveAbsoluteFloor returns tol.absoluteFloorMs for unit "ms" or a null/undefined unit', () => {
    const tol = { relative: 0.15, absoluteFloorMs: 2 };

    expect(resolveAbsoluteFloor(tol, 'ms')).toBe(2);
    expect(resolveAbsoluteFloor(tol, null)).toBe(2);
    expect(resolveAbsoluteFloor(tol, undefined)).toBe(2);
  });

  it('T-44-098 resolveAbsoluteFloor returns DEFAULT_ABSOLUTE_FLOORS_BY_UNIT[unit] for a recognized non-ms unit', () => {
    const tol = { relative: 0.15, absoluteFloorMs: 2 };

    expect(resolveAbsoluteFloor(tol, 'bytes')).toBe(DEFAULT_ABSOLUTE_FLOORS_BY_UNIT.bytes);
    expect(resolveAbsoluteFloor(tol, 'count')).toBe(DEFAULT_ABSOLUTE_FLOORS_BY_UNIT.count);
  });
});

describe('compareRuns — opts.unitFloors overrides the default bytes floor', () => {
  it('T-44-099 a ~2MB/40% bytes delta stays ok under the 5MB default but regresses under a 1MB opts.unitFloors override', () => {
    const baseline = makeRun(
      [mkUnitRecord({ unit: 'bytes', p50: 5_000_000, p95: 5_000_000, max: 5_000_000 })],
      { tier: 'stress' }
    );
    const current = makeRun(
      [mkUnitRecord({ unit: 'bytes', p50: 7_000_000, p95: 7_000_000, max: 7_000_000 })],
      { tier: 'stress' }
    );

    const defaultResult = compareRuns(baseline, current);
    expect(defaultResult.findings[0].gates.absolute.tripped).toBe(false);
    expect(defaultResult.findings[0].status).toBe('ok');

    const overriddenResult = compareRuns(baseline, current, {
      unitFloors: { bytes: 1 * 1024 * 1024 },
    });
    expect(overriddenResult.findings[0].gates.absolute.tripped).toBe(true);
    expect(overriddenResult.findings[0].status).toBe('regression');
  });
});

describe('compareRuns — mixed ms and bytes records under one tier gate independently', () => {
  it('T-44-100 a ms record and a bytes record in the same run are each gated by their own unit with no cross-contamination', () => {
    // ms record: 100 -> 145 (45% relative / 45ms absolute delta — clears the
    // stress tier's 35% relative tolerance and the 2ms floor; this run is
    // tier:'stress' throughout, not the default micro tier T-44-020 uses, so
    // a 20% delta would NOT regress here — 145 is the genuine stress-tier trip).
    // bytes record: 10,000,000 -> 10,300,000 (3% / 300,000 bytes — well under
    // both the stress tier's 35% relative tolerance and the 5MB byte floor).
    const baseline = makeRun(
      [
        mkRecord({ suite: 'browser-smoke', scenario: 't_total', p50: 100, p95: 150, max: 200 }),
        mkUnitRecord({ unit: 'bytes', scenario: 'heap-growth', p50: 10_000_000, p95: 10_000_000, max: 10_000_000 }),
      ],
      { tier: 'stress' }
    );
    const current = makeRun(
      [
        mkRecord({ suite: 'browser-smoke', scenario: 't_total', p50: 145, p95: 150, max: 200 }),
        mkUnitRecord({ unit: 'bytes', scenario: 'heap-growth', p50: 10_300_000, p95: 10_300_000, max: 10_300_000 }),
      ],
      { tier: 'stress' }
    );

    const result = compareRuns(baseline, current);

    const msFinding = result.findings.find((f) => f.key.scenario === 't_total');
    const bytesFinding = result.findings.find((f) => f.key.scenario === 'heap-growth');

    expect(msFinding.gates.absolute.unit).toBe('ms');
    expect(msFinding.gates.absolute.floor).toBe(DEFAULT_ABSOLUTE_FLOORS_BY_UNIT.ms);
    expect(msFinding.gates.absolute.tripped).toBe(true);
    expect(msFinding.status).toBe('regression');

    expect(bytesFinding.gates.absolute.unit).toBe('bytes');
    expect(bytesFinding.gates.absolute.floor).toBe(DEFAULT_ABSOLUTE_FLOORS_BY_UNIT.bytes);
    expect(bytesFinding.gates.absolute.tripped).toBe(false);
    expect(bytesFinding.status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Slice 9 — unit-aware CLI formatters (issue #44 AC 115-122).
//
// formatMarkdownSummary/formatSummary previously rendered every finding as if
// it were milliseconds (formatMarkdownSummary hardcoded fmtMs/fmtDeltaMs; the
// still-internal formatSummary printed raw unlabeled numbers). This slice
// generalizes both via two new exported pure helpers, formatByUnit/
// formatDeltaByUnit, and exports formatSummary for the first time. AC-115 is
// a hard backward-compat lock: the ms rendering path must stay byte-identical
// to the pre-Slice-9 output locked by T-44-073...077. None of the new exports
// exist yet, so every test below fails at an import-time undefined-export
// (formatSummary/formatByUnit/formatDeltaByUnit) or a real rendering mismatch.
// ---------------------------------------------------------------------------

/** Builds one baseline/current record pair + compareRuns() result of a single unit. */
function makeSingleUnitResult({ unit, suite, scenario, baselineP50, currentP50, tier = 'micro' }) {
  const baseline = makeRun(
    [mkUnitRecord({ unit, suite, scenario, p50: baselineP50, p95: baselineP50, max: baselineP50 })],
    { tier }
  );
  const current = makeRun(
    [mkUnitRecord({ unit, suite, scenario, p50: currentP50, p95: currentP50, max: currentP50 })],
    { tier }
  );
  return compareRuns(baseline, current, { tolerances: { [tier]: { relative: 0, absoluteFloorMs: 0 } } });
}

/** A single compareRuns() result mixing one ms, one bytes, and one count matched finding. */
function makeMixedUnitResult() {
  const baseline = makeRun(
    [
      mkUnitRecord({ unit: 'ms', suite: 'browser-smoke', scenario: 't_total', p50: 42, p95: 42, max: 42 }),
      mkUnitRecord({ unit: 'bytes', suite: 'stress-spa', scenario: 'heap-growth', p50: 10_485_760, p95: 10_485_760, max: 10_485_760 }),
      mkUnitRecord({ unit: 'count', suite: 'stress-rescan', scenario: 'span-count', p50: 10, p95: 10, max: 10 }),
    ],
    { tier: 'stress' }
  );
  const current = makeRun(
    [
      mkUnitRecord({ unit: 'ms', suite: 'browser-smoke', scenario: 't_total', p50: 62, p95: 62, max: 62 }),
      mkUnitRecord({ unit: 'bytes', suite: 'stress-spa', scenario: 'heap-growth', p50: 15_728_640, p95: 15_728_640, max: 15_728_640 }),
      mkUnitRecord({ unit: 'count', suite: 'stress-rescan', scenario: 'span-count', p50: 15, p95: 15, max: 15 }),
    ],
    { tier: 'stress' }
  );
  return compareRuns(baseline, current);
}

describe('formatMarkdownSummary — ms rendering backward-compat lock', () => {
  it('T-44-116 the exact T-44-073...077 ms fixtures render byte-identical baseline/current/delta cells post-generalization', () => {
    // Same fixtures as T-44-020 (100 -> 120): the pre-Slice-9 literal output
    // (fmtMs/fmtDeltaMs) must survive the unit-aware refactor unchanged.
    const baseline = makeRun([mkRecord({ p50: 100, p95: 150, max: 200 })]);
    const current = makeRun([mkRecord({ p50: 120, p95: 150, max: 200 })]);
    const result = compareRuns(baseline, current);

    const md = formatMarkdownSummary(result);

    expect(md).toContain('100.00ms');
    expect(md).toContain('120.00ms');
    expect(md).toContain('+20.00ms');
    expect(md).toContain('+20.0%');

    // The mixed-result fixture used throughout Slice 6's tests must also stay
    // byte-identical for its ms cells.
    const mixed = makeMixedResult();
    const mixedMd = formatMarkdownSummary(mixed);
    expect(mixedMd).toContain('50.00ms');
    expect(mixedMd).toContain('100.00ms');
    expect(mixedMd).toContain('120.00ms');
  });
});

describe('formatMarkdownSummary — bytes rendering', () => {
  it('T-44-117 a bytes finding (10MB -> 15MB) renders MB-scaled cells, never raw byte integers, never an ms suffix', () => {
    const result = makeSingleUnitResult({
      unit: 'bytes',
      suite: 'stress-spa',
      scenario: 'heap-growth',
      baselineP50: 10_485_760, // exactly 10MB
      currentP50: 15_728_640, // exactly 15MB
    });

    const md = formatMarkdownSummary(result);
    const row = md.split('\n').find((l) => l.includes('heap-growth'));

    expect(row).toBeDefined();
    expect(row).toContain('10.00MB');
    expect(row).toContain('15.00MB');
    expect(row).toContain('+5.00MB');
    expect(row).not.toContain('10485760');
    expect(row).not.toContain('15728640');
    expect(row).not.toMatch(/\dms\b/);
  });
});

describe('formatMarkdownSummary — count rendering', () => {
  it('T-44-118 a count finding (10 -> 15) renders plain integer cells with no ms suffix', () => {
    const result = makeSingleUnitResult({
      unit: 'count',
      suite: 'stress-rescan',
      scenario: 'span-count',
      baselineP50: 10,
      currentP50: 15,
    });

    const md = formatMarkdownSummary(result);
    const row = md.split('\n').find((l) => l.includes('span-count'));

    expect(row).toBeDefined();
    expect(row).toContain('| 10 |');
    expect(row).toContain('| 15 |');
    expect(row).toContain('+5');
    expect(row).not.toMatch(/\dms\b/);
  });
});

describe('formatMarkdownSummary — mixed-unit table has no cross-contamination between rows', () => {
  it('T-44-119 a table mixing ms/bytes/count findings renders each row in only its own record\'s unit', () => {
    const result = makeMixedUnitResult();
    const md = formatMarkdownSummary(result);
    const lines = md.split('\n');

    const msRow = lines.find((l) => l.includes('t_total'));
    const bytesRow = lines.find((l) => l.includes('heap-growth'));
    const countRow = lines.find((l) => l.includes('span-count'));

    expect(msRow).toMatch(/42\.00ms/);
    expect(msRow).toMatch(/62\.00ms/);
    expect(msRow).not.toContain('MB');

    expect(bytesRow).toContain('10.00MB');
    expect(bytesRow).toContain('15.00MB');
    expect(bytesRow).not.toMatch(/\dms\b/);

    expect(countRow).toContain('| 10 |');
    expect(countRow).toContain('| 15 |');
    expect(countRow).not.toContain('MB');
    expect(countRow).not.toMatch(/\dms\b/);
  });
});

describe('formatSummary — now-exported, unit-aware per-line rendering', () => {
  it('T-44-120 each line of the mixed-unit result carries the correct per-finding unit via the real formatByUnit output', () => {
    const result = makeMixedUnitResult();
    const text = formatSummary(result);
    const lines = text.split('\n');

    const msLine = lines.find((l) => l.includes('t_total'));
    const bytesLine = lines.find((l) => l.includes('heap-growth'));
    const countLine = lines.find((l) => l.includes('span-count'));

    const msFinding = result.findings.find((f) => f.key.scenario === 't_total');
    const bytesFinding = result.findings.find((f) => f.key.scenario === 'heap-growth');
    const countFinding = result.findings.find((f) => f.key.scenario === 'span-count');

    // Computed via the real, directly-imported formatByUnit — never a
    // hand-rolled expected string — so this proves formatSummary actually
    // dispatches through the same unit-aware helper the markdown renderer uses.
    expect(msLine).toContain(formatByUnit(msFinding.baseline.p50, msFinding.baseline.unit));
    expect(msLine).toContain(formatByUnit(msFinding.current.p50, msFinding.current.unit));

    expect(bytesLine).toContain(formatByUnit(bytesFinding.baseline.p50, bytesFinding.baseline.unit));
    expect(bytesLine).toContain(formatByUnit(bytesFinding.current.p50, bytesFinding.current.unit));
    expect(bytesLine).not.toMatch(/\dms\b/);

    expect(countLine).toContain(formatByUnit(countFinding.baseline.p50, countFinding.baseline.unit));
    expect(countLine).toContain(formatByUnit(countFinding.current.p50, countFinding.current.unit));
    expect(countLine).not.toContain('MB');
  });
});

describe('formatMarkdownSummary/formatSummary — new/dropped placeholders stay unit-agnostic', () => {
  it('T-44-121 a new bytes finding and a dropped count finding render placeholders in both formatters without throwing', () => {
    const baseline = makeRun(
      [mkUnitRecord({ unit: 'count', suite: 'stress-rescan', scenario: 'retired-count', p50: 5, p95: 5, max: 5 })],
      { tier: 'stress' }
    );
    const current = makeRun(
      [mkUnitRecord({ unit: 'bytes', suite: 'stress-spa', scenario: 'new-heap', p50: 1_048_576, p95: 1_048_576, max: 1_048_576 })],
      { tier: 'stress' }
    );
    const result = compareRuns(baseline, current);

    expect(result.findings).toHaveLength(2);
    expect(result.findings.map((f) => f.status).sort()).toEqual(['dropped', 'new']);

    expect(() => formatMarkdownSummary(result)).not.toThrow();
    expect(() => formatSummary(result)).not.toThrow();

    const md = formatMarkdownSummary(result);
    const text = formatSummary(result);

    expect(md).not.toMatch(/NaN/);
    expect(md).not.toMatch(/undefined/);
    expect(text).not.toMatch(/NaN/);
    expect(text).not.toMatch(/undefined/);

    const newRow = md.split('\n').find((l) => l.includes('new-heap'));
    const droppedRow = md.split('\n').find((l) => l.includes('retired-count'));
    expect(newRow).toContain('—');
    expect(droppedRow).toContain('—');
  });
});

describe('formatByUnit / formatDeltaByUnit — direct regression lock', () => {
  it('T-44-122 exact expected strings for representative ms/bytes/count values', () => {
    // ms — byte-identical to the legacy fmtMs/fmtDeltaMs behavior.
    expect(formatByUnit(100, 'ms')).toBe('100.00ms');
    expect(formatDeltaByUnit(20, 'ms')).toBe('+20.00ms');
    expect(formatDeltaByUnit(-20, 'ms')).toBe('-20.00ms');

    // A null/undefined unit must fall back to the ms path (legacy default).
    expect(formatByUnit(50, undefined)).toBe('50.00ms');
    expect(formatByUnit(50, null)).toBe('50.00ms');

    // bytes — MB-scaled, two decimal places.
    expect(formatByUnit(10_485_760, 'bytes')).toBe('10.00MB');
    expect(formatDeltaByUnit(5_242_880, 'bytes')).toBe('+5.00MB');
    expect(formatDeltaByUnit(-5_242_880, 'bytes')).toBe('-5.00MB');

    // count — plain integers, no decimal places, no suffix.
    expect(formatByUnit(42, 'count')).toBe('42');
    expect(formatDeltaByUnit(3, 'count')).toBe('+3');
    expect(formatDeltaByUnit(-3, 'count')).toBe('-3');
  });
});

describe('main — end-to-end mixed-unit --markdown-out content', () => {
  it('T-44-123 the appended markdown contains both an MB-styled bytes row and a normally-rendered ms row, with no NaN/undefined, and does not throw', async () => {
    const current = makeRun(
      [
        mkUnitRecord({ unit: 'ms', suite: 'browser-smoke', scenario: 't_total', p50: 42, p95: 42, max: 42 }),
        mkUnitRecord({ unit: 'bytes', suite: 'stress-spa', scenario: 'heap-growth', p50: 10_485_760, p95: 10_485_760, max: 10_485_760 }),
      ],
      { tier: 'stress' }
    );
    // Self-diff: baseline === current, so every finding is status ok — the
    // point of this test is the rendering path, not the gating classification.
    const currentJson = JSON.stringify(current);
    const io = {
      readFile: (p) => (p === 'baseline.json' ? currentJson : currentJson),
      writeFile: vi.fn(),
      appendFile: vi.fn(),
      log: vi.fn(),
      error: vi.fn(),
    };

    await expect(
      main(
        ['--baseline', 'baseline.json', '--current', 'current.json', '--markdown-out', 'summary.md'],
        io
      )
    ).resolves.not.toThrow();

    expect(io.appendFile).toHaveBeenCalledTimes(1);
    const [, appendedData] = io.appendFile.mock.calls[0];

    expect(appendedData).toContain('42.00ms');
    expect(appendedData).toContain('10.00MB');
    expect(appendedData).not.toMatch(/NaN/);
    expect(appendedData).not.toMatch(/undefined/);
  });
});
