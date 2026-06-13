import { defineConfig } from 'vitest/config';

const doMockPlugin = {
  name: 'vi-mock-to-doMock',
  enforce: 'pre',
  transform(code, id) {
    if (id.includes('options.test.js')) {
      return { code: code.replace(/\bvi\.mock\s*\(/g, 'vi.doMock(') };
    }
  },
};

export default defineConfig({
  plugins: [doMockPlugin],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
