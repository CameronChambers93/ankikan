# Performance suite

Benchmarks for the extension's hot paths. Plan & rationale live in
`furigana/plans/perf-suite-plan.md`. This directory currently implements **Tier 1**
(micro-benchmarks) and the shared fixture generator; Tier 2 (Playwright, live
AnkiConnect) and the baseline-diff step are still to come.

## Layout

```
perf/
  fixtures/   generate.js (deterministic JA pages), corpus.js, wide-vocab.js,
              pre-segment.js, build-fixtures.js
  lib/        prng, tokenizer (kuromoji, Node), dom (jsdom), bench (sampling harness)
  micro/      tokenize / segment / scan / text-util benchmarks + run.js orchestrator
  setup-anki-perf.js   deck-planning module for a perf-scale Anki deck (pure
                        computeDeckPlan + a thin, dependency-injected live-Anki shell)
  results/    JSON output (git-ignored); micro-latest.json is the newest run
```

## Running

```bash
pnpm run perf:micro                      # sizes S,M,L (default)
PERF_SIZES=all pnpm run perf:micro       # add XL (heavy)
PERF_SIZES=S,M PERF_SAMPLES=12 pnpm run perf:micro
pnpm run perf:fixtures                   # write HTML pages to fixtures/pages/ (Tier-2)
PERF_PRESEGMENT=1 pnpm run perf:fixtures # also write .presegmented.html (builds real kuromoji, slower)
node perf/setup-anki-perf.js             # seed a perf-scale deck (requires Anki + AnkiConnect running)
```

Env knobs: `PERF_SIZES` (`S,M,L,XL` | `all` | `default`), `PERF_SAMPLES`,
`PERF_WARMUP`, `PERF_PRESEGMENT` (`1` to build `.presegmented.html` fixtures).
The table prints to stderr; a full result record (incl. span/token
counts) is written to `results/micro-<timestamp>.json` and `results/micro-latest.json`.

## What each micro-benchmark isolates

| Suite | Measures | Network / tokeniser handling |
|-------|----------|------------------------------|
| `tokenize` | kuromoji `tokenize()` throughput (tokens/sec) | real kuromoji, raw text, no DOM |
| `segment` | `segmentAndWrap` DOM walk + span creation | tokenisation pre-cached so only DOM cost is timed |
| `scan` | `scanPage` querySelectorAll + extractWord + payload build | `ankiRequest` stubbed zero-latency — CPU only; live latency is Tier-2 |
| `text-util` | `splitKanjiKana`/`isJapanese`/`extractWord` on pathological inputs (max run-switching, long non-Japanese scans, many-`<ruby>` spans) | timing-only; correctness is covered by `content.segmentation.test.js` |

Every sample runs against a freshly parsed DOM (untimed `setupEach`), so
destructive operations measure a true cold run.

## Fixture variants

- **`dense`** — mostly kanji compounds, minimal markup; maximum span count.
- **`sparse`** — Japanese interleaved with Latin words and inline markup;
  stresses `segmentAndWrap`'s text-node walk/skip logic.
- **`wide`** — noun slots draw from `wide-vocab.js`'s effectively-unbounded,
  deterministic, prefix-consistent vocabulary (a base-N digit encoding over a
  seeded-shuffled 60-character pool) instead of the small ~65-word
  `KANJI_NOUNS`/`KANJI_SINGLE` pools, so a page's distinct lookup-word count
  actually scales with page size — `dense`/`sparse` plateau at ~65 regardless
  of size, which understates `scanPage`'s real network payload on large pages.
  Wide noun slots are wrapped in a bare `<span>` at generation time, bypassing
  the tokenizer entirely: these compounds have no kuromoji dictionary entry, so
  a real tokenizer would shred each one into single-character UNK tokens.
  `segmentAndWrap`'s pre-existing-span skip logic then leaves them untouched
  when segmenting the rest of the page.

`pre-segment.js`'s `generatePreSegmentedHTML(tokenCount, tokenize, opts)` runs
a fixture page through the real `segmentAndWrap` up front, producing pages
already in "post-scan" markup state — used to isolate `scanPage`'s cost from
`segmentAndWrap`'s in Tier-2 scenarios. It takes `tokenize` as a parameter so
tests can pass a fast stub while `build-fixtures.js` passes the real tokenizer.

## Notes

- Fixtures are fully deterministic (fixed seed) — do not swap in `Math.random`.
- `results/` and `fixtures/pages/` are git-ignored; only the (future) committed
  `baseline.json` is tracked.
