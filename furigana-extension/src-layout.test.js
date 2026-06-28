/**
 * Structural layout guard for issue #37 — src/ tree reorganisation.
 *
 * This file verifies that the pure-refactor described in issue #37 has been
 * fully applied: every source and test file that was moved out of the flat root
 * now lives under src/<group>/, every old flat-root path is gone, build.js
 * references the new src/ entry points, and root-stable files are untouched.
 *
 * All assertions use real filesystem checks (fs.existsSync / fs.readFileSync)
 * against the actual repo on disk.  No mocks.
 *
 * Place: furigana-extension/src-layout.test.js  (stays at root — is itself a
 * root-stable file and must NOT be moved by the refactor it guards).
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function abs(...parts) {
  return path.join(ROOT, ...parts);
}

// ---------------------------------------------------------------------------
// 1. Every moved file exists at its NEW src/<group>/<file> path
// ---------------------------------------------------------------------------

describe('src/content/ — new locations', () => {
  it('T-37-001 src/content/content.js exists after move', () => {
    expect(fs.existsSync(abs('src', 'content', 'content.js')),
      'src/content/content.js must exist after the refactor').toBe(true);
  });

  it('T-37-002 src/content/content.grouping.js exists after move', () => {
    expect(fs.existsSync(abs('src', 'content', 'content.grouping.js')),
      'src/content/content.grouping.js must exist after the refactor').toBe(true);
  });

  it('T-37-003 src/content/content.observer.js exists after move', () => {
    expect(fs.existsSync(abs('src', 'content', 'content.observer.js')),
      'src/content/content.observer.js must exist after the refactor').toBe(true);
  });

  it('T-37-004 src/content/content.segmentation.js exists after move', () => {
    expect(fs.existsSync(abs('src', 'content', 'content.segmentation.js')),
      'src/content/content.segmentation.js must exist after the refactor').toBe(true);
  });

  it('T-37-005 src/content/scan-util.js exists after move', () => {
    expect(fs.existsSync(abs('src', 'content', 'scan-util.js')),
      'src/content/scan-util.js must exist after the refactor').toBe(true);
  });

  it('T-37-006 src/content/content.test.js exists after move', () => {
    expect(fs.existsSync(abs('src', 'content', 'content.test.js')),
      'src/content/content.test.js must exist after the refactor').toBe(true);
  });

  it('T-37-007 src/content/content.grouping.test.js exists after move', () => {
    expect(fs.existsSync(abs('src', 'content', 'content.grouping.test.js')),
      'src/content/content.grouping.test.js must exist after the refactor').toBe(true);
  });

  it('T-37-008 src/content/content.observer.test.js exists after move', () => {
    expect(fs.existsSync(abs('src', 'content', 'content.observer.test.js')),
      'src/content/content.observer.test.js must exist after the refactor').toBe(true);
  });

  it('T-37-009 src/content/content.segmentation.test.js exists after move', () => {
    expect(fs.existsSync(abs('src', 'content', 'content.segmentation.test.js')),
      'src/content/content.segmentation.test.js must exist after the refactor').toBe(true);
  });
});

describe('src/background/ — new locations', () => {
  it('T-37-010 src/background/background.js exists after move', () => {
    expect(fs.existsSync(abs('src', 'background', 'background.js')),
      'src/background/background.js must exist after the refactor').toBe(true);
  });
});

describe('src/popup/ — new locations', () => {
  it('T-37-011 src/popup/popup.js exists after move', () => {
    expect(fs.existsSync(abs('src', 'popup', 'popup.js')),
      'src/popup/popup.js must exist after the refactor').toBe(true);
  });

  it('T-37-012 src/popup/popup-style.js exists after move', () => {
    expect(fs.existsSync(abs('src', 'popup', 'popup-style.js')),
      'src/popup/popup-style.js must exist after the refactor').toBe(true);
  });

  it('T-37-013 src/popup/popup.test.js exists after move', () => {
    expect(fs.existsSync(abs('src', 'popup', 'popup.test.js')),
      'src/popup/popup.test.js must exist after the refactor').toBe(true);
  });
});

describe('src/options/ — new locations', () => {
  it('T-37-014 src/options/options.js exists after move', () => {
    expect(fs.existsSync(abs('src', 'options', 'options.js')),
      'src/options/options.js must exist after the refactor').toBe(true);
  });

  it('T-37-015 src/options/options.test.js exists after move', () => {
    expect(fs.existsSync(abs('src', 'options', 'options.test.js')),
      'src/options/options.test.js must exist after the refactor').toBe(true);
  });
});

describe('src/shared/ — new locations', () => {
  it('T-37-016 src/shared/style-util.js exists after move', () => {
    expect(fs.existsSync(abs('src', 'shared', 'style-util.js')),
      'src/shared/style-util.js must exist after the refactor').toBe(true);
  });

  it('T-37-017 src/shared/lemma-util.js exists after move', () => {
    expect(fs.existsSync(abs('src', 'shared', 'lemma-util.js')),
      'src/shared/lemma-util.js must exist after the refactor').toBe(true);
  });

  it('T-37-018 src/shared/dict-store.js exists after move', () => {
    expect(fs.existsSync(abs('src', 'shared', 'dict-store.js')),
      'src/shared/dict-store.js must exist after the refactor').toBe(true);
  });

  it('T-37-019 src/shared/style-util.test.js exists (renamed from content.style.test.js)', () => {
    // content.style.test.js is renamed to style-util.test.js and moved to src/shared/
    expect(fs.existsSync(abs('src', 'shared', 'style-util.test.js')),
      'src/shared/style-util.test.js must exist — renamed+moved from root content.style.test.js').toBe(true);
  });

  it('T-37-020 src/shared/content.styles.integration.test.js exists after move', () => {
    expect(fs.existsSync(abs('src', 'shared', 'content.styles.integration.test.js')),
      'src/shared/content.styles.integration.test.js must exist after the refactor').toBe(true);
  });

  it('T-37-021 src/shared/lemma-util.test.js exists after move', () => {
    expect(fs.existsSync(abs('src', 'shared', 'lemma-util.test.js')),
      'src/shared/lemma-util.test.js must exist after the refactor').toBe(true);
  });

  it('T-37-022 src/shared/dict-store.test.js exists after move', () => {
    expect(fs.existsSync(abs('src', 'shared', 'dict-store.test.js')),
      'src/shared/dict-store.test.js must exist after the refactor').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Every moved file is ABSENT from the old flat root path
// ---------------------------------------------------------------------------

describe('old flat-root paths — must be gone after refactor', () => {
  it('T-37-023 content.js is absent from flat root', () => {
    expect(fs.existsSync(abs('content.js')),
      'content.js must not remain at the flat root after being moved to src/content/').toBe(false);
  });

  it('T-37-024 content.grouping.js is absent from flat root', () => {
    expect(fs.existsSync(abs('content.grouping.js')),
      'content.grouping.js must not remain at the flat root').toBe(false);
  });

  it('T-37-025 content.observer.js is absent from flat root', () => {
    expect(fs.existsSync(abs('content.observer.js')),
      'content.observer.js must not remain at the flat root').toBe(false);
  });

  it('T-37-026 content.segmentation.js is absent from flat root', () => {
    expect(fs.existsSync(abs('content.segmentation.js')),
      'content.segmentation.js must not remain at the flat root').toBe(false);
  });

  it('T-37-027 scan-util.js is absent from flat root', () => {
    expect(fs.existsSync(abs('scan-util.js')),
      'scan-util.js must not remain at the flat root').toBe(false);
  });

  it('T-37-028 background.js is absent from flat root', () => {
    expect(fs.existsSync(abs('background.js')),
      'background.js must not remain at the flat root').toBe(false);
  });

  it('T-37-029 popup.js is absent from flat root', () => {
    expect(fs.existsSync(abs('popup.js')),
      'popup.js must not remain at the flat root').toBe(false);
  });

  it('T-37-030 popup-style.js is absent from flat root', () => {
    expect(fs.existsSync(abs('popup-style.js')),
      'popup-style.js must not remain at the flat root').toBe(false);
  });

  it('T-37-031 options.js is absent from flat root', () => {
    expect(fs.existsSync(abs('options.js')),
      'options.js must not remain at the flat root').toBe(false);
  });

  it('T-37-032 style-util.js is absent from flat root', () => {
    expect(fs.existsSync(abs('style-util.js')),
      'style-util.js must not remain at the flat root').toBe(false);
  });

  it('T-37-033 lemma-util.js is absent from flat root', () => {
    expect(fs.existsSync(abs('lemma-util.js')),
      'lemma-util.js must not remain at the flat root').toBe(false);
  });

  it('T-37-034 dict-store.js is absent from flat root', () => {
    expect(fs.existsSync(abs('dict-store.js')),
      'dict-store.js must not remain at the flat root').toBe(false);
  });

  it('T-37-035 content.test.js is absent from flat root', () => {
    expect(fs.existsSync(abs('content.test.js')),
      'content.test.js must not remain at the flat root').toBe(false);
  });

  it('T-37-036 content.grouping.test.js is absent from flat root', () => {
    expect(fs.existsSync(abs('content.grouping.test.js')),
      'content.grouping.test.js must not remain at the flat root').toBe(false);
  });

  it('T-37-037 content.observer.test.js is absent from flat root', () => {
    expect(fs.existsSync(abs('content.observer.test.js')),
      'content.observer.test.js must not remain at the flat root').toBe(false);
  });

  it('T-37-038 content.segmentation.test.js is absent from flat root', () => {
    expect(fs.existsSync(abs('content.segmentation.test.js')),
      'content.segmentation.test.js must not remain at the flat root').toBe(false);
  });

  it('T-37-039 content.style.test.js is absent from flat root (renamed to src/shared/style-util.test.js)', () => {
    expect(fs.existsSync(abs('content.style.test.js')),
      'content.style.test.js must not exist at root — it was renamed to style-util.test.js and moved to src/shared/').toBe(false);
  });

  it('T-37-040 content.styles.integration.test.js is absent from flat root', () => {
    expect(fs.existsSync(abs('content.styles.integration.test.js')),
      'content.styles.integration.test.js must not remain at the flat root').toBe(false);
  });

  it('T-37-041 popup.test.js is absent from flat root', () => {
    expect(fs.existsSync(abs('popup.test.js')),
      'popup.test.js must not remain at the flat root').toBe(false);
  });

  it('T-37-042 options.test.js is absent from flat root', () => {
    expect(fs.existsSync(abs('options.test.js')),
      'options.test.js must not remain at the flat root').toBe(false);
  });

  it('T-37-043 lemma-util.test.js is absent from flat root', () => {
    expect(fs.existsSync(abs('lemma-util.test.js')),
      'lemma-util.test.js must not remain at the flat root').toBe(false);
  });

  it('T-37-044 dict-store.test.js is absent from flat root', () => {
    expect(fs.existsSync(abs('dict-store.test.js')),
      'dict-store.test.js must not remain at the flat root').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. build.js entryPoints reference new src/ paths, not the bare flat form
// ---------------------------------------------------------------------------

describe('build.js — entryPoints updated to src/ paths', () => {
  const buildSrc = fs.readFileSync(abs('build.js'), 'utf8');

  it('T-37-045 build.js references src/content/content.js as an entry point', () => {
    expect(buildSrc).toContain('src/content/content.js');
  });

  it('T-37-046 build.js references src/background/background.js as an entry point', () => {
    expect(buildSrc).toContain('src/background/background.js');
  });

  it('T-37-047 build.js references src/popup/popup.js as an entry point', () => {
    expect(buildSrc).toContain('src/popup/popup.js');
  });

  it('T-37-048 build.js references src/options/options.js as an entry point', () => {
    expect(buildSrc).toContain('src/options/options.js');
  });

  it("T-37-049 build.js no longer uses bare entryPoints: ['content.js'] flat form", () => {
    // The flat form listed only the filename without a src/ prefix.
    // After the refactor the bare string 'content.js' must not appear as an
    // entry point value (it may still appear inside a longer path string, so
    // we check for the standalone quoted flat form).
    expect(buildSrc).not.toMatch(/entryPoints:\s*\[\s*['"]content\.js['"]/);
  });

  it("T-37-050 build.js no longer uses bare entryPoints: ['background.js'] flat form", () => {
    expect(buildSrc).not.toMatch(/entryPoints:\s*\[\s*['"]background\.js['"]/);
  });

  it("T-37-051 build.js no longer uses bare entryPoints: ['popup.js'] flat form", () => {
    expect(buildSrc).not.toMatch(/entryPoints:\s*\[\s*['"]popup\.js['"]/);
  });

  it("T-37-052 build.js no longer uses bare entryPoints: ['options.js'] flat form", () => {
    expect(buildSrc).not.toMatch(/entryPoints:\s*\[\s*['"]options\.js['"]/);
  });
});

// ---------------------------------------------------------------------------
// 4. Root-stable files still exist at root
// ---------------------------------------------------------------------------

describe('root-stable files — must remain at package root', () => {
  it('T-37-053 build.js remains at root', () => {
    expect(fs.existsSync(abs('build.js')),
      'build.js must stay at the package root').toBe(true);
  });

  it('T-37-054 path-shim.js remains at root', () => {
    expect(fs.existsSync(abs('path-shim.js')),
      'path-shim.js must stay at the package root').toBe(true);
  });

  it('T-37-055 vitest.config.js remains at root', () => {
    expect(fs.existsSync(abs('vitest.config.js')),
      'vitest.config.js must stay at the package root').toBe(true);
  });

  it('T-37-056 playwright.config.js remains at root', () => {
    expect(fs.existsSync(abs('playwright.config.js')),
      'playwright.config.js must stay at the package root').toBe(true);
  });

  it('T-37-057 manifest.json remains at root', () => {
    expect(fs.existsSync(abs('manifest.json')),
      'manifest.json must stay at the package root').toBe(true);
  });

  it('T-37-058 popup.html remains at root', () => {
    expect(fs.existsSync(abs('popup.html')),
      'popup.html must stay at the package root').toBe(true);
  });

  it('T-37-059 options.html remains at root', () => {
    expect(fs.existsSync(abs('options.html')),
      'options.html must stay at the package root').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. manifest.json paths unchanged — no src/ paths leaked in
// ---------------------------------------------------------------------------

describe('manifest.json — dist/ paths still intact, no src/ leak', () => {
  const manifest = JSON.parse(fs.readFileSync(abs('manifest.json'), 'utf8'));
  const manifestText = JSON.stringify(manifest);

  it('T-37-060 manifest background service_worker still points to dist/background.js', () => {
    expect(manifest.background.service_worker).toBe('dist/background.js');
  });

  it('T-37-061 manifest content_scripts js entry still points to dist/content.js', () => {
    const contentJs = manifest.content_scripts?.[0]?.js?.[0];
    expect(contentJs).toBe('dist/content.js');
  });

  it('T-37-062 manifest options_ui page still references options.html', () => {
    expect(manifest.options_ui?.page).toBe('options.html');
  });

  it('T-37-063 manifest action default_popup still references popup.html', () => {
    expect(manifest.action?.default_popup).toBe('popup.html');
  });

  it('T-37-064 manifest does not contain any src/ path references', () => {
    expect(manifestText).not.toContain('"src/');
  });
});
