const NS = 'ankikan';

export const PERF_NAMES = Object.freeze({
  SEGMENT: `${NS}:t_segment`,
  DOM_INJECT: `${NS}:t_dom_inject`,
  ANKI_FINDCARDS: `${NS}:t_anki_findcards`,
  ANKI_CARDSINFO: `${NS}:t_anki_cardsinfo`,
  TOTAL: `${NS}:t_total`,
});

function perfAvailable() {
  return typeof performance !== 'undefined'
    && typeof performance.mark === 'function'
    && typeof performance.measure === 'function';
}

export function markStart(name) {
  if (!perfAvailable()) return;
  try {
    performance.clearMarks(`${name}:start`);
    performance.mark(`${name}:start`);
  } catch { /* never break the caller */ }
}

export function markEnd(name) {
  if (!perfAvailable()) return;
  try {
    performance.clearMarks(`${name}:end`);
    performance.mark(`${name}:end`);
    performance.clearMeasures(name);
    performance.measure(name, `${name}:start`, `${name}:end`);
  } catch { /* start mark missing, or measure() rejected — swallow */ }
}
