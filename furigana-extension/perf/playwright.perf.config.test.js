/**
 * Unit tests for perf/playwright.perf.config.js (Tier-2 Playwright perf harness
 * config), issue #44 AC-55.
 *
 * The Tier-2 harness reuses the same "load the unpacked extension into a real
 * Chromium context" mechanism as e2e/playwright.config.js (see that file's
 * `use.extensionPath` / `headless: false` pair), but points at a dedicated
 * `perf/e2e/` test directory and `*.perf.js` file glob so perf scenarios never
 * get accidentally picked up by `pnpm test:e2e` (and vice versa). These tests
 * import the config module directly and assert its resolved values — no
 * shelling out to the Playwright test runner, since we only care about the
 * config object itself, not an actual browser run.
 *
 * RED-phase note: perf/playwright.perf.config.js does not exist yet, so the
 * import below fails at module-resolution time until the developer implements
 * it. That is the correct starting state for this slice.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import config from './playwright.perf.config.js';

// package.json declares "type": "module", and the sibling playwright.config.js
// (the e2e harness this one is modeled on) uses `import`/`export default`, so
// the perf config is expected to follow the same ES module style.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('playwright.perf.config — testDir/testMatch scoping', () => {
  it('T-44-065 testDir resolves to perf/e2e, testMatch is **/*.perf.js, headless is false, and extensionPath resolves to the furigana-extension root', () => {
    // testDir must point at perf/e2e/ — a directory of its own, sibling to
    // (not the same as) e2e/, so `pnpm test:e2e` and the perf harness never
    // collide over the same test files.
    const expectedTestDir = path.resolve(__dirname, 'e2e');
    // extensionPath must resolve to the extension root: perf/ is one level
    // below furigana-extension/, so this config's own __dirname sits inside
    // it and the extension root is one level up.
    const expectedExtensionPath = path.resolve(__dirname, '..');

    expect(path.resolve(config.testDir)).toBe(expectedTestDir);
    expect(config.testMatch).toBe('**/*.perf.js');
    expect(config.use.headless).toBe(false);
    expect(path.resolve(config.use.extensionPath)).toBe(expectedExtensionPath);
  });
});
