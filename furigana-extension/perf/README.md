# Performance suite

Benchmarks for the extension's hot paths. Plan & rationale live in
`furigana/plans/perf-suite-plan.md`. This directory implements **Tier 1**
(micro-benchmarks) and the shared fixture generator, plus a first slice of
**Tier 2** (Playwright, live AnkiConnect): a `browser-smoke` scenario that
proves the `ankikan:t_*` `performance.measure()` entries emitted by
`content.timing.js` are observable directly from the page's main world via a
plain `page.evaluate()` — the content-script isolated world shares the frame's
User Timing timeline, so no CDP bridge is needed (AC-54) — covering a real
`segmentAndWrap` + live `findCards`/`cardsInfo` run end to end. A **Long Tasks
observer** (`e2e/lib/longtask-observer.js`) registered via `page.addInitScript`
before `document_idle` also captures the synchronous main-thread blocking from
the local-mode kuromoji tokenize + `segmentAndWrap` pass on a dense-L page, and
the pure `lib/longtask.js` `summarizeLongTasks` aggregator reports its
total/longest durations (closes out the capability previously tracked as
"AC-67"). The `compare.mjs` baseline-diff of long-task/heap numbers,
`perf-scale` deck seeding (`seedAnkiPerfDeck`), and larger Tier-2 fixtures are
still to come.

## Layout

```
perf/
  fixtures/   generate.js (deterministic JA pages), corpus.js, wide-vocab.js,
              pre-segment.js, build-fixtures.js, browser-smoke.js (Tier-2 smoke page)
  lib/        prng, tokenizer (kuromoji, Node), dom (jsdom), bench (sampling harness)
  micro/      tokenize / segment / scan / text-util benchmarks + run.js orchestrator
  e2e/        Tier-2 Playwright specs (*.perf.js) + lib/ (kuromoji dict-seed helper)
  playwright.perf.config.js   Tier-2 Playwright config (perf/e2e, *.perf.js, headed)
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
pnpm run build && pnpm run perf:e2e      # Tier-2 Playwright (requires live Anki + AnkiKan-E2E deck)
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

## CI (nightly, advisory)

`.github/workflows/perf-tier1.yml` runs `perf:micro` nightly and compares it
against `perf/baseline.ci.json` — a rolling, **git-ignored** baseline distinct
from the committed `baseline.local.json` (a dev-machine snapshot used for
local `perf:compare`/`perf:baseline` runs). The CI baseline is cached between
runs and self-seeds via `compare.mjs --seed-on-missing` on first use, so the
workflow never fails a build (advisory only — no `--check`). Results are
posted to the job summary via `compare.mjs --markdown-out "$GITHUB_STEP_SUMMARY"`.

`compare.mjs` flags added for this: `--seed-on-missing` (write the baseline
from the current run instead of erroring when it's missing) and
`--markdown-out <path>` (append a GFM table + summary line to the given file).

## Notes

- Fixtures are fully deterministic (fixed seed) — do not swap in `Math.random`.
- `results/` and `fixtures/pages/` are git-ignored; only the committed
  `baseline.local.json` is tracked (`baseline.ci.json` is CI-only and git-ignored).
