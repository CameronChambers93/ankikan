/**
 * Baseline-diff comparator for the Tier-1 perf suite.
 *
 * Joins a baseline `{meta, records}` result against a current one on
 * (suite, scenario, size, variant) and classifies each joined pair as
 * ok/regression/improvement using a two-gate rule on p50 (a relative %
 * tolerance AND an absolute floor in ms must both trip before a change is
 * reported — this suppresses noise on both near-zero durations and large
 * durations with small relative swings). p95/max deltas are informational
 * only and never affect status. Records present in only one run are
 * reported as new/dropped with null gates.
 *
 *   node perf/compare.mjs --baseline perf/baseline.local.json --current perf/results/micro-latest.json
 *   node perf/compare.mjs --write-baseline
 *   node perf/compare.mjs --check   # exit 1 if any regression found
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_TOLERANCES = {
  micro: { relative: 0.15, absoluteFloorMs: 2 },
  e2e: { relative: 0.35, absoluteFloorMs: 2 },
  stress: { relative: 0.35, absoluteFloorMs: 2 },
};

const FALLBACK_TOLERANCE = { relative: 0.20, absoluteFloorMs: 2 };

/**
 * Join key for a record. Uses a null-sentinel (' ') distinct from any real
 * size/variant string so `variant: null` never collides with `variant: 'null'`.
 *
 * @param {object} r
 * @returns {string}
 */
export function keyOf(r) {
  return `${r.suite}::${r.scenario}::${r.size ?? ' '}::${r.variant ?? ' '}`;
}

function pick(r) {
  return { p50: r.p50, p95: r.p95, max: r.max };
}

/**
 * Compares a baseline run against a current run.
 *
 * @param {{meta: object, records: object[]}} baseline
 * @param {{meta: object, records: object[]}} current
 * @param {{tolerances?: object}} [opts]
 * @returns {{tier: string, tolerance: object, findings: object[], summary: object}}
 */
export function compareRuns(baseline, current, opts = {}) {
  const tier = current.meta.tier;

  const tolerances = { ...DEFAULT_TOLERANCES };
  if (opts.tolerances) {
    for (const t of Object.keys(opts.tolerances)) {
      tolerances[t] = { ...(tolerances[t] ?? FALLBACK_TOLERANCE), ...opts.tolerances[t] };
    }
  }
  const tol = tolerances[tier] ?? FALLBACK_TOLERANCE;

  const baseMap = new Map(baseline.records.map((r) => [keyOf(r), r]));
  const curMap = new Map(current.records.map((r) => [keyOf(r), r]));
  const keys = new Set([...baseMap.keys(), ...curMap.keys()]);

  const findings = [];
  const summary = { ok: 0, regression: 0, improvement: 0, new: 0, dropped: 0 };

  for (const key of keys) {
    const base = baseMap.get(key);
    const cur = curMap.get(key);

    if (base && cur) {
      const deltaMs = cur.p50 - base.p50;
      const deltaPct = base.p50 === 0 ? (deltaMs > 0 ? Infinity : 0) : deltaMs / base.p50;
      const relTripped = Math.abs(deltaPct) > tol.relative;
      const absTripped = Math.abs(deltaMs) > tol.absoluteFloorMs;
      const status = relTripped && absTripped ? (deltaMs > 0 ? 'regression' : 'improvement') : 'ok';

      findings.push({
        status,
        key: { suite: cur.suite, scenario: cur.scenario, size: cur.size, variant: cur.variant },
        gates: {
          relative: { tripped: relTripped, tolerance: tol.relative },
          absolute: { tripped: absTripped, floorMs: tol.absoluteFloorMs },
        },
        baseline: pick(base),
        current: pick(cur),
        delta: {
          p50Ms: deltaMs,
          p50Pct: deltaPct,
          p95Ms: cur.p95 - base.p95,
          maxMs: cur.max - base.max,
        },
      });
      summary[status]++;
    } else if (cur) {
      findings.push({
        status: 'new',
        key: { suite: cur.suite, scenario: cur.scenario, size: cur.size, variant: cur.variant },
        gates: null,
        baseline: null,
        current: pick(cur),
      });
      summary.new++;
    } else {
      findings.push({
        status: 'dropped',
        key: { suite: base.suite, scenario: base.scenario, size: base.size, variant: base.variant },
        gates: null,
        baseline: pick(base),
        current: null,
      });
      summary.dropped++;
    }
  }

  return { tier, tolerance: tol, findings, summary };
}

/**
 * Shapes a current run for baseline storage. Identity today; kept as a named
 * export so a future slice can add provenance metadata without touching call sites.
 *
 * @param {object} current
 * @returns {object}
 */
export function formatBaselineWrite(current) {
  return current;
}

function parseArgs(argv) {
  const args = {
    baseline: 'perf/baseline.local.json',
    current: 'perf/results/micro-latest.json',
    check: false,
    writeBaseline: false,
    seedOnMissing: false,
    markdownOut: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--baseline') args.baseline = argv[++i];
    else if (a === '--current') args.current = argv[++i];
    else if (a === '--check' || a === '--strict') args.check = true;
    else if (a === '--write-baseline') args.writeBaseline = true;
    else if (a === '--seed-on-missing') args.seedOnMissing = true;
    else if (a === '--markdown-out') args.markdownOut = argv[++i];
  }
  return args;
}

function formatSummary(result) {
  const lines = [`Tier: ${result.tier} (tolerance ${JSON.stringify(result.tolerance)})`];
  for (const f of result.findings) {
    const k = `${f.key.suite}/${f.key.scenario}/${f.key.size ?? '-'}/${f.key.variant ?? '-'}`;
    if (f.status === 'new' || f.status === 'dropped') {
      lines.push(`  ${f.status.toUpperCase().padEnd(10)}${k}`);
    } else {
      const pct = (f.delta.p50Pct * 100).toFixed(1);
      lines.push(`  ${f.status.toUpperCase().padEnd(10)}${k}  p50 ${f.baseline.p50} -> ${f.current.p50} (${pct}%)`);
    }
  }
  lines.push(
    `Summary: ok=${result.summary.ok} regression=${result.summary.regression} ` +
    `improvement=${result.summary.improvement} new=${result.summary.new} dropped=${result.summary.dropped}`
  );
  return lines.join('\n');
}

function fmtMs(ms) {
  return `${ms.toFixed(2)}ms`;
}

function fmtDeltaMs(ms) {
  const sign = ms > 0 ? '+' : '';
  return `${sign}${ms.toFixed(2)}ms`;
}

function fmtPct(pct) {
  if (!Number.isFinite(pct)) return pct > 0 ? '+∞%' : '-∞%';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${(pct * 100).toFixed(1)}%`;
}

/**
 * Renders a compareRuns() result as a GitHub-flavored markdown table, suitable
 * for appending to $GITHUB_STEP_SUMMARY. Pure — takes no fs/process dependency.
 *
 * @param {object} result - Output of compareRuns().
 * @param {{seeded?: boolean}} [opts]
 * @returns {string}
 */
export function formatMarkdownSummary(result, opts = {}) {
  const lines = ['## Tier-1 Performance Summary', ''];
  if (opts.seeded) {
    lines.push('> Baseline seeded from this run (no prior baseline found).', '');
  }
  lines.push('| Status | Suite/Scenario/Size/Variant | Baseline p50 | Current p50 | Δ p50 | Δ % |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const f of result.findings) {
    const k = `${f.key.suite}/${f.key.scenario}/${f.key.size ?? '-'}/${f.key.variant ?? '-'}`;
    const status = f.status.toUpperCase();
    if (f.status === 'new' || f.status === 'dropped') {
      lines.push(`| ${status} | ${k} | — | — | — | — |`);
    } else {
      lines.push(
        `| ${status} | ${k} | ${fmtMs(f.baseline.p50)} | ${fmtMs(f.current.p50)} | ` +
        `${fmtDeltaMs(f.delta.p50Ms)} | ${fmtPct(f.delta.p50Pct)} |`
      );
    }
  }
  lines.push('');
  lines.push(
    `**Summary:** ok=${result.summary.ok} regression=${result.summary.regression} ` +
    `improvement=${result.summary.improvement} new=${result.summary.new} dropped=${result.summary.dropped}`
  );
  return lines.join('\n');
}

const defaultIo = {
  readFile: (p) => fs.readFileSync(p, 'utf-8'),
  writeFile: (p, data) => fs.writeFileSync(p, data),
  appendFile: (p, data) => fs.appendFileSync(p, data),
  log: (...a) => console.log(...a),
  error: (...a) => console.error(...a),
};

/**
 * CLI shell. `io` is injected so callers (and tests) never touch fs/process directly.
 *
 * @param {string[]} [argv]
 * @param {{readFile: Function, writeFile: Function, log: Function, error: Function}} [io]
 * @returns {Promise<number>} process exit code
 */
export async function main(argv = [], io = defaultIo) {
  const {
    baseline: baselinePath,
    current: currentPath,
    check,
    writeBaseline,
    seedOnMissing,
    markdownOut,
  } = parseArgs(argv);

  try {
    if (writeBaseline) {
      const currentRaw = await io.readFile(currentPath);
      const current = JSON.parse(currentRaw);
      await io.writeFile(baselinePath, JSON.stringify(formatBaselineWrite(current), null, 2));
      io.log(`Wrote baseline to ${baselinePath}`);
      return 0;
    }

    const currentRaw = await io.readFile(currentPath);
    const current = JSON.parse(currentRaw);

    let baseline;
    let seeded = false;
    try {
      const baselineRaw = await io.readFile(baselinePath);
      baseline = JSON.parse(baselineRaw);
    } catch (err) {
      if (!seedOnMissing) throw err;
      seeded = true;
      baseline = current;
      await io.writeFile(baselinePath, JSON.stringify(formatBaselineWrite(current), null, 2));
      io.log(`No baseline found at ${baselinePath}; seeding from this run.`);
    }

    const result = compareRuns(baseline, current);
    io.log(formatSummary(result));

    if (markdownOut) {
      await io.appendFile(markdownOut, formatMarkdownSummary(result, { seeded }) + '\n');
    }

    return check && result.summary.regression > 0 ? 1 : 0;
  } catch (err) {
    io.error(err);
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
