import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.js',
  timeout: 30_000,
  use: {
    // Extension tests require a headed browser (or headless=new in Chrome 112+)
    headless: false,
    // Point at the extension source directory
    extensionPath: __dirname,
  },
  // Run serially — each test gets its own browser context with the extension
  workers: 1,
});
