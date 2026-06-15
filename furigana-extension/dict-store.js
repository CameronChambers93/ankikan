import Dexie from 'dexie';
import { REQUIRED_DICT_FILES } from './lemma-util.js';

const db = new Dexie('ankikanDict');
db.version(1).stores({ files: 'name' });

/**
 * Atomically replaces the stored dictionary with the given files.
 * Clears the table and bulk-puts all entries in a single read-write transaction.
 *
 * @param {Map<string, Blob>} fileMap - Map of filename to file blob.
 */
export async function saveDictionary(fileMap) {
  const entries = await Promise.all(
    [...fileMap].map(async ([name, blob]) => ({ name, data: await blobToArrayBuffer(blob) }))
  );
  await db.transaction('rw', db.files, async () => {
    await db.files.clear();
    if (entries.length) await db.files.bulkPut(entries);
  });
}

/**
 * Returns true only when every required dictionary file is present in the store.
 *
 * @returns {Promise<boolean>}
 */
export async function hasDictionary() {
  const count = await db.files.where('name').anyOf(REQUIRED_DICT_FILES).count();
  return count === REQUIRED_DICT_FILES.length;
}

/**
 * Reads a single dictionary file as an ArrayBuffer.
 *
 * @param {string} name - The stored filename.
 * @returns {Promise<ArrayBuffer|null>} The file bytes, or null if not found.
 */
export async function readDictFile(name) {
  const record = await db.files.get(name);
  if (!record) return null;
  if (record.data) return toArrayBuffer(record.data);
  if (record.blob) return blobToArrayBuffer(record.blob);
  return null;
}

/**
 * Returns a fresh ArrayBuffer owning a copy of the source's bytes. The copy guarantees the
 * result belongs to the current realm, which matters when the source was rehydrated by
 * IndexedDB's structured clone in a different realm.
 *
 * @param {ArrayBuffer|ArrayBufferView} source
 * @returns {ArrayBuffer}
 */
function toArrayBuffer(source) {
  const view = ArrayBuffer.isView(source) ? source : new Uint8Array(source);
  return Uint8Array.from(view).buffer;
}

/**
 * Reads a Blob to an ArrayBuffer, falling back to FileReader when `Blob#arrayBuffer`
 * is unavailable (e.g. in environments where it is not implemented).
 *
 * @param {Blob} blob - The blob to read.
 * @returns {Promise<ArrayBuffer>}
 */
function blobToArrayBuffer(blob) {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}
