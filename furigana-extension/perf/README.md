# Performance suite

Benchmarks for the extension's hot paths. Plan & rationale live in
`furigana/plans/perf-suite-plan.md`. This directory currently implements **Tier 1**
(micro-benchmarks) and the shared fixture generator; Tier 2 (Playwright, live
AnkiConnect) and the baseline-diff step are still to come.

## Layout

```
perf/
  fixtures/   generate.js (deterministic JA pages), corpus.js, build-fixtures.js
  lib/        prng, tokenizer (kuromoji, Node), dom (jsdom), bench (sampling harness)
  micro/      tokenize / segment / scan benchmarks + run.js orchestrator
  results/    JSON output (git-ignored); micro-latest.json is the newest run
```

## Running

```bash
pnpm run perf:micro                      # sizes S,M,L (default)
PERF_SIZES=all pnpm run perf:micro       # add XL (heavy)
PERF_SIZES=S,M PERF_SAMPLES=12 pnpm run perf:micro
pnpm run perf:fixtures                   # write HTML pages to fixtures/pages/ (Tier-2)
```

Env knobs: `PERF_SIZES` (`S,M,L,XL` | `all` | `default`), `PERF_SAMPLES`,
`PERF_WARMUP`. The table prints to stderr; a full result record (incl. span/token
counts) is written to `results/micro-<timestamp>.json` and `results/micro-latest.json`.

## What each micro-benchmark isolates

| Suite | Measures | Network / tokeniser handling |
|-------|----------|------------------------------|
| `tokenize` | kuromoji `tokenize()` throughput (tokens/sec) | real kuromoji, raw text, no DOM |
| `segment` | `segmentAndWrap` DOM walk + span creation | tokenisation pre-cached so only DOM cost is timed |
| `scan` | `scanPage` querySelectorAll + extractWord + payload build | `ankiRequest` stubbed zero-latency — CPU only; live latency is Tier-2 |

Every sample runs against a freshly parsed DOM (untimed `setupEach`), so
destructive operations measure a true cold run.

## Notes

- Fixtures are fully deterministic (fixed seed) — do not swap in `Math.random`.
- `results/` and `fixtures/pages/` are git-ignored; only the (future) committed
  `baseline.json` is tracked.
