/**
 * Writes generated HTML fixture pages to perf/fixtures/pages/ for reuse by the
 * Tier-2 Playwright suite (which loads real pages in Chromium). Tier-1 generates
 * its inputs in-memory and does not need these files.
 *
 *   node perf/fixtures/build-fixtures.js            # sizes S,M,L
 *   PERF_SIZES=all node perf/fixtures/build-fixtures.js
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateHTML, resolveSizes } from './generate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGES_DIR = path.join(__dirname, 'pages');
const VARIANTS = ['dense', 'sparse'];

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
}

main().catch((err) => { console.error(err); process.exit(1); });
