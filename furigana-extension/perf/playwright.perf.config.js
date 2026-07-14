import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: path.resolve(__dirname, 'e2e'),
  testMatch: '**/*.perf.js',
  timeout: 60_000,
  use: {
    // Extension tests require a headed browser (or headless=new in Chrome 112+)
    headless: false,
    // Point at the extension source directory
    extensionPath: path.resolve(__dirname, '..'),
  },
  // Run serially — each test gets its own browser context with the extension
  workers: 1,
});
