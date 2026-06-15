import 'fake-indexeddb/auto';
import { beforeEach, describe, it, expect, vi } from 'vitest';

// dict-store.js does not exist yet — dynamic imports inside each test will fail
// until the developer creates the module.  vi.resetModules() before each test
// ensures each test gets a fresh module (and therefore a fresh Dexie instance)
// backed by the fake IndexedDB, so Dexie's singleton state does not leak between tests.

const ALL_FILES = [
  'base.dat.gz', 'cc.dat.gz', 'check.dat.gz',
  'tid.dat.gz', 'tid_map.dat.gz', 'tid_pos.dat.gz',
  'unk.dat.gz', 'unk_char.dat.gz', 'unk_compat.dat.gz',
  'unk_invoke.dat.gz', 'unk_map.dat.gz', 'unk_pos.dat.gz',
];

/** Build a Map containing all 12 required files, each with a small Blob payload. */
function makeFullFileMap() {
  return new Map(
    ALL_FILES.map((name) => [name, new Blob([new Uint8Array([1, 2, 3])])])
  );
}

beforeEach(() => {
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// hasDictionary — AC7
// ---------------------------------------------------------------------------

describe('hasDictionary', () => {
  it('returns false when the store is empty (nothing has been saved yet)', async () => {
    // On a fresh install no dictionary has been stored; hasDictionary must
    // return false so the popup prompts the user to import one (AC7).
    const { hasDictionary } = await import('./dict-store.js');
    expect(await hasDictionary()).toBe(false);
  });

  it('returns true after all 12 required files have been saved', async () => {
    // A complete dictionary is the prerequisite for local tokenization;
    // hasDictionary must return true only when every required file is present (AC7).
    const { saveDictionary, hasDictionary } = await import('./dict-store.js');
    await saveDictionary(makeFullFileMap());
    expect(await hasDictionary()).toBe(true);
  });

  it('returns false after saving only 11 of the 12 required files', async () => {
    // An incomplete dictionary cannot initialize kuromoji; hasDictionary must
    // reject a partial save so the UI shows "Not loaded" rather than "Loaded" (AC7).
    const { saveDictionary, hasDictionary } = await import('./dict-store.js');
    const partial = new Map(
      ALL_FILES.slice(0, 11).map((name) => [name, new Blob([new Uint8Array([4, 5, 6])])])
    );
    await saveDictionary(partial);
    expect(await hasDictionary()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// saveDictionary — AC5, AC6 (atomicity)
// ---------------------------------------------------------------------------

describe('saveDictionary', () => {
  it('makes hasDictionary return true when a full 12-file Map is provided', async () => {
    // Saving a valid dictionary map must write all 12 files in a single operation
    // so that hasDictionary immediately returns true (AC5).
    const { saveDictionary, hasDictionary } = await import('./dict-store.js');
    await saveDictionary(makeFullFileMap());
    expect(await hasDictionary()).toBe(true);
  });

  it('replaces all previous files when saved a second time (no stale files remain)', async () => {
    // A second import must atomically replace the first: after saving 12 files and
    // then saving 12 different files, only the new 12 must be present (AC6).
    const { saveDictionary, readDictFile } = await import('./dict-store.js');

    // First save: all 12 files with byte [0xAA]
    const firstMap = new Map(
      ALL_FILES.map((name) => [name, new Blob([new Uint8Array([0xAA])])])
    );
    await saveDictionary(firstMap);

    // Second save: all 12 files with byte [0xBB]
    const secondMap = new Map(
      ALL_FILES.map((name) => [name, new Blob([new Uint8Array([0xBB])])])
    );
    await saveDictionary(secondMap);

    // Every file should now contain 0xBB, not 0xAA
    for (const name of ALL_FILES) {
      const buf = await readDictFile(name);
      expect(new Uint8Array(buf)[0]).toBe(0xBB);
    }
  });

  it('makes hasDictionary return false after saving an empty Map (clears any existing data)', async () => {
    // Saving an empty map is how the store is cleared; it must not leave any
    // previously saved files in place (AC6 atomicity).
    const { saveDictionary, hasDictionary } = await import('./dict-store.js');
    await saveDictionary(makeFullFileMap());
    expect(await hasDictionary()).toBe(true);

    await saveDictionary(new Map());
    expect(await hasDictionary()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// readDictFile — round-trip
// ---------------------------------------------------------------------------

describe('readDictFile', () => {
  it('returns an ArrayBuffer with the same bytes that were saved', async () => {
    // The ArrayBuffer is fed directly to kuromoji; it must contain the exact bytes
    // that were stored without corruption or truncation.
    const { saveDictionary, readDictFile } = await import('./dict-store.js');
    await saveDictionary(makeFullFileMap());

    const buf = await readDictFile('base.dat.gz');
    expect(buf).toBeInstanceOf(ArrayBuffer);
    // makeFullFileMap uses Uint8Array([1, 2, 3]) → 3 bytes
    expect(buf.byteLength).toBe(3);
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('returns null for a filename that was never saved', async () => {
    // Requesting a non-existent file must return null so the caller can surface a
    // clear "dictionary not loaded" error rather than crashing the tokenizer.
    const { readDictFile } = await import('./dict-store.js');
    const result = await readDictFile('nonexistent.dat.gz');
    expect(result).toBeNull();
  });

  it('returns distinct bytes for each of the 12 files (content is not mixed up)', async () => {
    // Each dict file is different; readDictFile must return the bytes that
    // correspond to the requested name, not another file's data.
    const { saveDictionary, readDictFile } = await import('./dict-store.js');

    // Give each file a unique single-byte payload equal to its index + 1
    const fileMap = new Map(
      ALL_FILES.map((name, i) => [name, new Blob([new Uint8Array([i + 1])])])
    );
    await saveDictionary(fileMap);

    for (let i = 0; i < ALL_FILES.length; i++) {
      const buf = await readDictFile(ALL_FILES[i]);
      expect(buf).toBeInstanceOf(ArrayBuffer);
      expect(buf.byteLength).toBe(1);
      expect(new Uint8Array(buf)[0]).toBe(i + 1);
    }
  });
});
