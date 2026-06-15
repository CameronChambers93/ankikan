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
  build({ ...shared, entryPoints: ['content.js'], outfile: 'dist/content.js', format: 'iife' }),
  build({ ...shared, entryPoints: ['background.js'], outfile: 'dist/background.js', format: 'iife' }),
  build({ ...shared, entryPoints: ['popup.js'], outfile: 'dist/popup.js', format: 'esm' }),
  build({ ...shared, entryPoints: ['options.js'], outfile: 'dist/options.js', format: 'esm' }),
]);
