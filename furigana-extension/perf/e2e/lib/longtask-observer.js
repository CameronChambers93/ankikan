/**
 * Test-harness helper for capturing real `longtask` Performance Timeline
 * entries during the Tier-2 browser-perf harness (issue #44, Slice 7).
 *
 * `installLongTaskObserver(page)` must be called BEFORE `page.goto()`. It
 * uses `page.addInitScript()` to register a `PerformanceObserver({entryTypes:
 * ['longtask']})` in the page's MAIN world at document-creation time, so the
 * observer is already live and buffering entries before the extension's
 * content script runs at `document_idle` — the moment `segmentAndWrap` and
 * kuromoji tokenization do their synchronous, potentially-blocking work.
 *
 * The Long Tasks API observes per-frame main-thread work regardless of which
 * JS "world" scheduled it: a content script's isolated world executes on the
 * SAME main thread and blocks the SAME frame's rendering pipeline as
 * page-authored script, so a `longtask` entry fired by kuromoji tokenize (run
 * from the isolated world) is visible to a `PerformanceObserver` registered
 * in the main world just as it would be for page-authored long-running code.
 * This mirrors the already-established fact (see `browser-smoke.perf.js`'s
 * header) that the User Timing buffer is shared per-frame across isolated
 * and main worlds — the Long Tasks entries live on that same shared
 * frame-level Performance Timeline.
 *
 * The observer instance is stashed on `window.__ankikanLongTaskObserver` so
 * it isn't garbage-collected mid-run (a `PerformanceObserver` with no other
 * live reference can be reclaimed, silently stopping delivery).
 */

/**
 * Registers a main-world `longtask` PerformanceObserver via an init script,
 * BEFORE the caller navigates. Must be awaited before `page.goto()`.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function installLongTaskObserver(page) {
  await page.addInitScript(() => {
    window.__ankikanLongTasks = [];
    try {
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__ankikanLongTasks.push({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
          });
        }
      });
      po.observe({ entryTypes: ['longtask'] });
      // Keep a live reference so the observer isn't GC'd before it can
      // deliver buffered entries.
      window.__ankikanLongTaskObserver = po;
    } catch (err) {
      window.__ankikanLongTaskObserverError = String(err);
    }
  });
}

/**
 * Reads the long-task entries captured so far from the page's main world.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Array<{name: string, startTime: number, duration: number}>>}
 */
export async function readLongTasks(page) {
  return page.evaluate(() => window.__ankikanLongTasks ?? []);
}
