import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const shared = {
  bundle: true,
  platform: 'browser',
  alias: { path: path.resolve(__dirname, 'path-shim.js') },
};

await Promise.all([
  build({ ...shared, entryPoints: ['src/content/content.js'], outfile: 'dist/content.js', format: 'iife' }),
  build({ ...shared, entryPoints: ['src/background/background.js'], outfile: 'dist/background.js', format: 'iife' }),
  build({ ...shared, entryPoints: ['src/popup/popup.js'], outfile: 'dist/popup.js', format: 'esm' }),
  build({ ...shared, entryPoints: ['src/options/options.js'], outfile: 'dist/options.js', format: 'esm' }),
]);
