// Minimal browser shim for the Node `path` module.
// kuromoji's DictionaryLoader only calls `path.join`, and always with a '' base path,
// so a simple slash-join is sufficient.
export function join(...parts) {
  return parts.filter(Boolean).join('/');
}

export default { join };
