/**
 * Unit tests for generateBrowserSmokeHTML() (perf/fixtures/browser-smoke.js),
 * issue #44 AC-59.
 *
 * The Tier-2 Playwright perf harness needs a minimal, deterministic page whose
 * text content overlaps the real AnkiKan-E2E test deck (see
 * e2e/setup-anki-e2e.js), so a smoke scenario can load it, run a real scan, and
 * assert AnkiConnect status classes land on known words without depending on
 * randomized fixture content. These tests lock the fixture's determinism (a
 * hard baseline-diff requirement carried over from the existing dense/sparse/
 * wide fixtures) and confirm all three seeded deck words are actually present
 * in the rendered page text — parsed via JSDOM rather than raw-string
 * `.includes()`, per this repo's live-DOM-over-string-hacking convention.
 *
 * RED-phase note: perf/fixtures/browser-smoke.js does not exist yet, so the
 * import below fails at module-resolution time until the developer implements
 * it. That is the correct starting state for this slice.
 */
import { describe, it, expect } from 'vitest';

import { generateBrowserSmokeHTML } from './browser-smoke.js';
import { domFromHTML } from '../lib/dom.js';

// The exact three AnkiKan-E2E deck expressions, confirmed against the CARDS
// array in e2e/setup-anki-e2e.js (lines 21-23): けが (new), アニメ (learning),
// 日本語 (review/learned). Not imported — that file's CARDS constant isn't
// exported — so these literals are hardcoded and pinned to that source.
const DECK_WORDS = ['けが', 'アニメ', '日本語'];

describe('generateBrowserSmokeHTML — determinism', () => {
  it('T-44-064 two calls with no arguments return byte-identical HTML', () => {
    // Matches the hard byte-identical requirement already enforced for the
    // dense/sparse/wide fixtures (see perf/fixtures/generate.test.js) — the
    // Tier-2 smoke scenario must be reproducible across CI runs.
    const a = generateBrowserSmokeHTML();
    const b = generateBrowserSmokeHTML();
    expect(b === a).toBe(true);
  });
});

describe('generateBrowserSmokeHTML — deck-word coverage', () => {
  it('T-44-064 the rendered page text contains all three AnkiKan-E2E deck words', () => {
    // Parsed via JSDOM (body.textContent), not a raw-string .includes() on the
    // full HTML, so this reflects what a real scan of the rendered page would
    // actually see rather than markup-incidental substrings (e.g. inside an
    // attribute or a <script> block).
    const html = generateBrowserSmokeHTML();
    const { body } = domFromHTML(html);
    const text = body.textContent;

    for (const word of DECK_WORDS) {
      expect(text).toContain(word);
    }
  });
});
