/**
 * Writes generated HTML fixture pages to perf/fixtures/pages/ for reuse by the
 * Tier-2 Playwright suite (which loads real pages in Chromium). Tier-1 generates
 * its inputs in-memory and does not need these files.
 *
 *   node perf/fixtures/build-fixtures.js            # sizes S,M,L
 *   PERF_SIZES=all node perf/fixtures/build-fixtures.js
 *   PERF_PRESEGMENT=1 node perf/fixtures/build-fixtures.js   # also write .presegmented.html
 *
 * Pre-segmented fixtures are opt-in via PERF_PRESEGMENT: building them requires
 * a real kuromoji tokenizer and tokenizes up to XL-sized text across every
 * variant/size combo, which can take tens of seconds — skipped by default so
 * the common case (plain fixture pages) stays fast.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateHTML, resolveSizes } from './generate.js';
import { generatePreSegmentedHTML } from './pre-segment.js';
import { getTokenizer } from '../lib/tokenizer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGES_DIR = path.join(__dirname, 'pages');
const VARIANTS = ['dense', 'sparse', 'wide'];

async function main() {
  const sizes = resolveSizes(process.env.PERF_SIZES);
  await mkdir(PAGES_DIR, { recursive: true });

  for (const [size, count] of sizes) {
    for (const variant of VARIANTS) {
      const html = generateHTML(count, { variant });
      const file = path.join(PAGES_DIR, `${variant}-${size}.html`);
      await writeFile(file, html);
      process.stderr.write(`wrote ${path.relative(process.cwd(), file)} (${html.length} bytes)\n`);
    }
  }

  if (!process.env.PERF_PRESEGMENT) {
    process.stderr.write('Skipping pre-segmented fixtures (set PERF_PRESEGMENT=1 to build them).\n');
    return;
  }

  process.stderr.write('Building kuromoji tokenizer for pre-segmented fixtures…\n');
  const tokenizer = await getTokenizer();
  const tokenize = tokenizer.tokenize.bind(tokenizer);

  for (const [size, count] of sizes) {
    for (const variant of VARIANTS) {
      const html = generatePreSegmentedHTML(count, tokenize, { variant });
      const file = path.join(PAGES_DIR, `${variant}-${size}.presegmented.html`);
      await writeFile(file, html);
      process.stderr.write(`wrote ${path.relative(process.cwd(), file)} (${html.length} bytes)\n`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
