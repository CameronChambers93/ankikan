export const REQUIRED_DICT_FILES = [
  'base.dat.gz', 'cc.dat.gz', 'check.dat.gz', 'tid.dat.gz', 'tid_map.dat.gz',
  'tid_pos.dat.gz', 'unk.dat.gz', 'unk_char.dat.gz', 'unk_compat.dat.gz',
  'unk_invoke.dat.gz', 'unk_map.dat.gz', 'unk_pos.dat.gz',
];

/**
 * Resolves the effective lemma mode from stored settings.
 * An explicit `lemmaMode` string always wins; otherwise a legacy `useLemma: true`
 * migrates to `'server'`, and everything else falls back to `'off'`.
 *
 * @param {{lemmaMode?: string, useLemma?: boolean}|null} stored - Stored settings object.
 * @returns {'off'|'server'|'local'} The resolved lemma mode.
 */
export function resolveLemmaMode(stored) {
  if (stored && typeof stored.lemmaMode === 'string') return stored.lemmaMode;
  if (stored && stored.useLemma === true) return 'server';
  return 'off';
}

/**
 * Checks that every required kuromoji dictionary file is present in the given list.
 *
 * @param {string[]} filenames - Filenames available in the imported archive.
 * @returns {{ok: boolean, missing: string[]}} `ok` is true when nothing is missing.
 */
export function validateDictFiles(filenames) {
  const present = new Set(filenames);
  const missing = REQUIRED_DICT_FILES.filter((name) => !present.has(name));
  return { ok: missing.length === 0, missing };
}

/**
 * Builds a `{surface_form: basic_form}` map from kuromoji tokens, keeping only tokens
 * whose surface is a candidate and whose dictionary form is a meaningful, differing value.
 *
 * @param {{surface_form: string, basic_form: string}[]} tokens - kuromoji token objects.
 * @param {Set<string>} surfaceSet - Candidate surface forms to retain.
 * @returns {Object.<string, string>} Map of surface form to dictionary form.
 */
export function filterLemmaMap(tokens, surfaceSet) {
  const map = {};
  for (const { surface_form, basic_form } of tokens) {
    if (!surfaceSet.has(surface_form)) continue;
    if (!basic_form || basic_form === '*' || basic_form === surface_form) continue;
    map[surface_form] = basic_form;
  }
  return map;
}
