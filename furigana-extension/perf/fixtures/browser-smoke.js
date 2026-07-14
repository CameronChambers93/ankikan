/**
 * Deterministic Tier-2 browser-smoke fixture.
 *
 * A small, fixed HTML page whose text overlaps the real AnkiKan-E2E deck
 * (see e2e/setup-anki-e2e.js): けが (unlearned), アニメ (learning), 日本語
 * (learned). No randomness — byte-identical across calls, per this repo's
 * baseline-diff determinism requirement for perf fixtures.
 */

const HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>AnkiKan browser-smoke fixture</title>
</head>
<body>
<p>今日はけがをしました。</p>
<p>アニメを見るのが好きです。</p>
<p>日本語を勉強しています。</p>
</body>
</html>
`;

/**
 * Returns the fixture's HTML source. Deterministic — always returns the same
 * string.
 * @returns {string}
 */
export function generateBrowserSmokeHTML() {
  return HTML;
}
