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
"AC-67"). `compare.mjs` is now **unit-aware** — its two-gate rule resolves the
absolute floor per metric unit (`ms`≈2ms, `bytes`≈5MB, `count`≈1) instead of a
single ms floor, so browser (per-phase ms), heap (bytes), and long-task (ms)
numbers can be baseline-diffed on the same footing as the Tier-1 micro numbers;
the pure builders in `lib/build-records.js`
(`buildPhaseRecords`/`buildHeapGrowthRecord`/`buildLongTaskRecords`) turn the
captured browser/heap/long-task objects into `{meta, records}` the comparator
consumes. The live Playwright harnesses now **write** those records out:
`lib/write-results.js` (`assembleResults`/`writeResults`, injected-`io`) and
`e2e/lib/perf-results.js` (`assembleBrowserSmokeResult`/`assembleLongtaskResult`/
`assembleStressResult`) are wired into `e2e/browser-smoke.perf.js`,
`e2e/longtask.perf.js`, and `e2e/stress.perf.js` respectively, so each run now
produces `results/browser-smoke-latest.json`, `results/stress-latest.json`, and
`results/longtask-latest.json` (closes AC-104) alongside their timestamped
siblings. `compare.mjs`'s formatters (`formatSummary`/`formatMarkdownSummary`)
are unit-aware end to end via the now-exported `formatByUnit`/`formatDeltaByUnit`
helpers, rendering ms/bytes/count findings each in their own unit with no
cross-contamination. **Perf-scale live-Anki deck seeding** (`seedAnkiPerfDeck`)
now runs against a real AnkiConnect instance at Tier-2 scale: its I/O shell is
**batched** (`addNotes` → `notesInfo` → `multi`-wrapped `setSpecificValueOfCard`)
and **reset-then-seed idempotent** (it clears the `AnkiKan-Perf` deck before
reseeding), turning what was ~3 round trips per note into a handful of batched
calls, and a new live-only proof spec (`e2e/seed-anki-perf.perf.js`) verifies the
seeded note count, per-card type/queue, duplicate persistence, and idempotency
against real Anki at SIZES.L (closes the previously-deferred live half of AC-17).
**Tier-2 large wide/pre-segmented fixtures and the wide-page `scanPage` scenario
have landed** (`e2e/wide-scan.perf.js`, `e2e/lib/perf-results.js`'s
`assembleWideScanResult`): a key finding from this slice is that the scenario
needs **no kuromoji dict-seed** — the extension's default (unseeded) storage
resolves `lemmaMode` to `'off'`, so `segmentAndWrap` never runs client-side and
`scanPage` is exercised directly against a Node-built pre-segmented wide
fixture, at full Tier-2 scale (8,445 spans / 2,854 distinct lookup words for
SIZES.L), against the live, self-seeded `AnkiKan-Perf` deck. **A second live size
(SIZES.S) for `wide-scan` has since landed** (`assembleWideScanResult(measures,
{size})` now parametrizes the previously-hardcoded `size:'L'`), closing the
"only one live size" risk flagged at the end of that slice. What remains:
`docs/performance-testing.md`, CI phase 2, and CI-markdown mixed-unit
rendering.

## Layout

```
perf/
  fixtures/   generate.js (deterministic JA pages), corpus.js, wide-vocab.js,
              pre-segment.js, build-fixtures.js, browser-smoke.js (Tier-2 smoke page)
  lib/        prng, tokenizer (kuromoji, Node), dom (jsdom), bench (sampling harness),
              build-records (pure record builders), write-results (assemble + injected-io write)
  micro/      tokenize / segment / scan / text-util benchmarks + run.js orchestrator
  e2e/        Tier-2/3 Playwright specs (*.perf.js) + lib/ (kuromoji dict-seed helper,
              longtask-observer, perf-results per-harness assembly wrappers)
  playwright.perf.config.js   Tier-2 Playwright config (perf/e2e, *.perf.js, headed)
  setup-anki-perf.js   perf-scale Anki deck seeder (pure computeDeckPlan + a
                        batched, reset-then-seed, dependency-injected live-Anki shell)
  results/    JSON output (git-ignored); micro-latest.json is the newest run
```

## Running

```bash
pnpm run perf:micro                      # sizes S,M,L (default)
PERF_SIZES=all pnpm run perf:micro       # add XL (heavy)
PERF_SIZES=S,M PERF_SAMPLES=12 pnpm run perf:micro
pnpm run perf:fixtures                   # write HTML pages to fixtures/pages/ (Tier-2)
PERF_PRESEGMENT=1 pnpm run perf:fixtures # also write .presegmented.html (builds real kuromoji, slower)
node perf/setup-anki-perf.js             # manually seed the full-XL perf deck (~11,550 notes; requires Anki + AnkiConnect)
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
- `seedAnkiPerfDeck` is **reset-then-seed**: each call clears the `AnkiKan-Perf`
  deck's existing notes before reseeding, so repeated runs don't accumulate. It
  only ever touches `AnkiKan-Perf` (never the functional `AnkiKan-E2E` deck).
- The automated live proof (`e2e/seed-anki-perf.perf.js`) seeds at **SIZES.L**
  (~2,310 notes) so it stays fast enough to run routinely. The full **XL** target
  (~11,550 notes) is not automated — run it on demand via
  `node perf/setup-anki-perf.js`, which is the occasional full-scale seed path.
