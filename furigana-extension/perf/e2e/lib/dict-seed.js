/**
 * Test-harness helper for seeding the real kuromoji IPAdic dictionary into the
 * extension's `ankikanDict` IndexedDB database, factored out of
 * `e2e/local-lemma.e2e.js`'s inline dict-seeding logic so the Tier-2 perf
 * harness doesn't duplicate it. The mechanism is copied verbatim from that
 * file (base64 round trip across Playwright's evaluate() boundary, raw
 * IndexedDB APIs so there's no dependency on Dexie being globally available
 * in the page context) — `local-lemma.e2e.js` itself is left untouched.
 *
 * `segmentAndWrap` (source of the `ankikan:t_segment` perf measure) only runs
 * in a real browser when `lemmaMode === 'local'` AND a dictionary has been
 * seeded AND no `span[data-lemma]` pre-exists — this is the only way to make
 * that measure fire outside a unit test.
 */

import path from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// perf/e2e/lib/ -> furigana-extension/node_modules/kuromoji/dict (three levels up).
const DICT_DIR = path.resolve(__dirname, '../../../node_modules/kuromoji/dict');
const DICT_FILE_NAMES = [
  'base.dat.gz', 'cc.dat.gz', 'check.dat.gz', 'tid.dat.gz',
  'tid_map.dat.gz', 'tid_pos.dat.gz', 'unk.dat.gz', 'unk_char.dat.gz',
  'unk_compat.dat.gz', 'unk_invoke.dat.gz', 'unk_map.dat.gz', 'unk_pos.dat.gz',
];

/**
 * Reads the real kuromoji IPAdic dictionary files from node_modules and
 * serializes each as base64 (rather than a number[]) — base64 strings cross
 * Playwright's evaluate() boundary an order of magnitude faster than a
 * multi-million-element array, which otherwise blows past per-test timeouts
 * for the ~19 MB IPAdic dictionary.
 *
 * @returns {Array<{name: string, base64: string}>}
 */
export function readKuromojiDictFilesBase64() {
  return DICT_FILE_NAMES.map((name) => ({
    name,
    base64: readFileSync(path.join(DICT_DIR, name)).toString('base64'),
  }));
}

/**
 * Seeds the ankikanDict IndexedDB database with the given serialized dict
 * files using raw IndexedDB APIs.
 *
 * The store must be seeded at the EXTENSION origin (e.g. via the popup page),
 * because the content script reads dictionary files through the background
 * service worker, which holds the Dexie database at the extension origin —
 * not the page's origin.
 *
 * @param {import('@playwright/test').Page} page - Extension-origin page whose origin will own the DB.
 * @param {Array<{name: string, base64: string}>} serializedDictFiles
 */
export async function seedKuromojiDict(page, serializedDictFiles) {
  await page.evaluate(async (dictFiles) => {
    const decode = (b64) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    };

    // Open at whatever version currently exists (the popup's Dexie may have already created
    // the DB). If the `files` store is missing, bump the version once to create it. This
    // avoids a VersionError when racing Dexie's own open at the extension origin.
    const openDb = () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('ankikanDict');
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => reject(req.error);
      });

    let db = await openDb();
    if (!db.objectStoreNames.contains('files')) {
      const nextVersion = db.version + 1;
      db.close();
      db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('ankikanDict', nextVersion);
        req.onupgradeneeded = (e) => {
          e.target.result.createObjectStore('files', { keyPath: 'name' });
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => reject(req.error);
      });
    }

    await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      const store = tx.objectStore('files');
      for (const { name, base64 } of dictFiles) {
        store.put({ name, blob: new Blob([decode(base64)]) });
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, serializedDictFiles);
}
