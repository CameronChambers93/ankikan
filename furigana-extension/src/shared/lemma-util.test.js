import { describe, it, expect } from 'vitest';

// lemma-util.js does not exist yet — dynamic imports inside each test will fail
// until the developer creates the module.  Each test uses a local dynamic import
// so that collection succeeds and individual tests produce meaningful failure
// messages rather than a whole-suite ImportError.

// ---------------------------------------------------------------------------
// resolveLemmaMode — AC3, AC4
// ---------------------------------------------------------------------------

describe('resolveLemmaMode', () => {
  it('returns "off" when stored is an empty object (no relevant keys present)', async () => {
    // A fresh install with nothing stored must default to "off" so no lemma
    // lookup is triggered without an explicit opt-in.
    const { resolveLemmaMode } = await import('./lemma-util.js');
    expect(resolveLemmaMode({})).toBe('off');
  });

  it('returns "off" when stored.useLemma is false and lemmaMode is absent', async () => {
    // Legacy installations with useLemma: false must migrate cleanly to "off"
    // without any manual intervention from the user.
    const { resolveLemmaMode } = await import('./lemma-util.js');
    expect(resolveLemmaMode({ useLemma: false })).toBe('off');
  });

  it('returns "server" when stored.useLemma is true and lemmaMode is absent (legacy migration)', async () => {
    // An existing user who had useLemma: true was using the server path; the
    // migration must preserve that intent by resolving to "server" (AC3).
    const { resolveLemmaMode } = await import('./lemma-util.js');
    expect(resolveLemmaMode({ useLemma: true })).toBe('server');
  });

  it('returns "off" when stored.lemmaMode is "off" (stored value wins over migration logic)', async () => {
    // Once lemmaMode has been explicitly persisted, it must take precedence so
    // the user's deliberate choice is not overridden (AC4).
    const { resolveLemmaMode } = await import('./lemma-util.js');
    expect(resolveLemmaMode({ lemmaMode: 'off' })).toBe('off');
  });

  it('returns "server" when stored.lemmaMode is "server"', async () => {
    // A stored lemmaMode of "server" must be returned directly (AC4).
    const { resolveLemmaMode } = await import('./lemma-util.js');
    expect(resolveLemmaMode({ lemmaMode: 'server' })).toBe('server');
  });

  it('returns "local" when stored.lemmaMode is "local"', async () => {
    // The new "local" path must round-trip through storage without being
    // overridden by migration rules (AC4).
    const { resolveLemmaMode } = await import('./lemma-util.js');
    expect(resolveLemmaMode({ lemmaMode: 'local' })).toBe('local');
  });

  it('returns "local" when both lemmaMode: "local" and useLemma: true are present (lemmaMode wins)', async () => {
    // In mixed storage state the explicit lemmaMode key must always win so a
    // brief window where both keys are present (during migration write-back) does
    // not cause a double-migration (AC4).
    const { resolveLemmaMode } = await import('./lemma-util.js');
    expect(resolveLemmaMode({ lemmaMode: 'local', useLemma: true })).toBe('local');
  });

  it('returns "server" when both lemmaMode: "server" and useLemma: false are present (lemmaMode wins)', async () => {
    // A stored "server" must not be downgraded to "off" just because useLemma
    // happens to be false in the same object (AC4).
    const { resolveLemmaMode } = await import('./lemma-util.js');
    expect(resolveLemmaMode({ lemmaMode: 'server', useLemma: false })).toBe('server');
  });

  it('returns "off" when stored is null', async () => {
    // Null is a realistic value when storage.get returns an unset key; the
    // function must not throw and must fall back to "off" (AC3).
    const { resolveLemmaMode } = await import('./lemma-util.js');
    expect(resolveLemmaMode(null)).toBe('off');
  });
});

// ---------------------------------------------------------------------------
// REQUIRED_DICT_FILES — AC5, AC6
// ---------------------------------------------------------------------------

describe('REQUIRED_DICT_FILES', () => {
  it('is an array containing exactly the 12 kuromoji IPAdic dict filenames', async () => {
    // The constant drives both import validation and the hasDictionary check;
    // it must match the files that the installed kuromoji version expects at runtime.
    const { REQUIRED_DICT_FILES } = await import('./lemma-util.js');
    const expected = [
      'base.dat.gz',
      'cc.dat.gz',
      'check.dat.gz',
      'tid.dat.gz',
      'tid_map.dat.gz',
      'tid_pos.dat.gz',
      'unk.dat.gz',
      'unk_char.dat.gz',
      'unk_compat.dat.gz',
      'unk_invoke.dat.gz',
      'unk_map.dat.gz',
      'unk_pos.dat.gz',
    ];
    expect(Array.isArray(REQUIRED_DICT_FILES)).toBe(true);
    expect(REQUIRED_DICT_FILES).toHaveLength(12);
    expect([...REQUIRED_DICT_FILES].sort()).toEqual([...expected].sort());
  });
});

// ---------------------------------------------------------------------------
// validateDictFiles — AC5, AC6
// ---------------------------------------------------------------------------

describe('validateDictFiles', () => {
  const ALL_12 = [
    'base.dat.gz', 'cc.dat.gz', 'check.dat.gz',
    'tid.dat.gz', 'tid_map.dat.gz', 'tid_pos.dat.gz',
    'unk.dat.gz', 'unk_char.dat.gz', 'unk_compat.dat.gz',
    'unk_invoke.dat.gz', 'unk_map.dat.gz', 'unk_pos.dat.gz',
  ];

  it('returns { ok: true, missing: [] } when all 12 required files are supplied', async () => {
    // The complete set is the happy path; the importer must be allowed to proceed
    // to saveDictionary without an error message (AC5).
    const { validateDictFiles } = await import('./lemma-util.js');
    expect(validateDictFiles(ALL_12)).toEqual({ ok: true, missing: [] });
  });

  it('returns { ok: false, missing: ["base.dat.gz"] } when base.dat.gz is absent', async () => {
    // Each missing file must be named individually so the user knows exactly
    // what to correct rather than receiving a generic error (AC6).
    const { validateDictFiles } = await import('./lemma-util.js');
    const without = ALL_12.filter((f) => f !== 'base.dat.gz');
    const result = validateDictFiles(without);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['base.dat.gz']);
  });

  it('returns ok: false and lists all 12 filenames as missing when given an empty array', async () => {
    // An empty file list means nothing is present; all 12 required names must be
    // reported so the error message is complete and actionable (AC6).
    const { validateDictFiles } = await import('./lemma-util.js');
    const result = validateDictFiles([]);
    expect(result.ok).toBe(false);
    expect(result.missing).toHaveLength(12);
    expect([...result.missing].sort()).toEqual([...ALL_12].sort());
  });

  it('returns { ok: true, missing: [] } when extra unknown files are included alongside all required files', async () => {
    // A real kuromoji zip may bundle a README or other non-dict assets; those
    // extras must be silently ignored — only the required files are checked (AC5).
    const { validateDictFiles } = await import('./lemma-util.js');
    const withExtra = [...ALL_12, 'README.md', 'extra-file.txt'];
    expect(validateDictFiles(withExtra)).toEqual({ ok: true, missing: [] });
  });
});

// ---------------------------------------------------------------------------
// filterLemmaMap — AC10
// ---------------------------------------------------------------------------

describe('filterLemmaMap', () => {
  it('maps surface_form to basic_form when surface_form is in the set and basic_form differs', async () => {
    // 伝え → 伝える is the canonical AC10 example: an inflected verb surface whose
    // dictionary form differs, so the Anki lookup uses the correct base form.
    // kuromoji tokens use the property name `surface_form` (not `surface`).
    const { filterLemmaMap } = await import('./lemma-util.js');
    const tokens = [{ surface_form: '伝え', basic_form: '伝える' }];
    const result = filterLemmaMap(tokens, new Set(['伝え']));
    expect(result).toEqual({ '伝え': '伝える' });
  });

  it('excludes a token whose surface_form is not in the candidate surfaceSet', async () => {
    // Only surfaces that were identified as candidates on the scanned page should
    // appear in the lemma map; surrounding context tokens must be excluded (AC10).
    const { filterLemmaMap } = await import('./lemma-util.js');
    const tokens = [{ surface_form: '食べ', basic_form: '食べる' }];
    const result = filterLemmaMap(tokens, new Set(['行く'])); // '食べ' absent
    expect(result).toEqual({});
  });

  it('excludes a token where basic_form equals surface_form (no dictionary form change)', async () => {
    // When the lemma equals the surface there is nothing to resolve; including it
    // would trigger a redundant Anki lookup on an already-resolved form (AC10).
    const { filterLemmaMap } = await import('./lemma-util.js');
    const tokens = [{ surface_form: '食べる', basic_form: '食べる' }];
    const result = filterLemmaMap(tokens, new Set(['食べる']));
    expect(result).toEqual({});
  });

  it('excludes a token whose basic_form is the kuromoji unknown marker "*"', async () => {
    // kuromoji emits "*" when it cannot resolve a dictionary form; storing "*"
    // as a lemma would produce incorrect Anki queries (AC10).
    const { filterLemmaMap } = await import('./lemma-util.js');
    const tokens = [{ surface_form: '謎語', basic_form: '*' }];
    const result = filterLemmaMap(tokens, new Set(['謎語']));
    expect(result).toEqual({});
  });

  it('excludes a token whose basic_form is null (falsy)', async () => {
    // A null basic_form from an unexpected tokenizer output shape must not cause
    // a crash or insert null into the map (AC10).
    const { filterLemmaMap } = await import('./lemma-util.js');
    const tokens = [{ surface_form: '試験', basic_form: null }];
    const result = filterLemmaMap(tokens, new Set(['試験']));
    expect(result).toEqual({});
  });

  it('excludes a token whose basic_form is an empty string (falsy)', async () => {
    // An empty string is not a usable lemma and must be treated equivalently to
    // null rather than being stored as an empty key (AC10).
    const { filterLemmaMap } = await import('./lemma-util.js');
    const tokens = [{ surface_form: '試験', basic_form: '' }];
    const result = filterLemmaMap(tokens, new Set(['試験']));
    expect(result).toEqual({});
  });

  it('returns only the qualifying mappings from a mixed list of tokens', async () => {
    // Real tokenizer output mixes qualifying and non-qualifying tokens; the
    // function must apply all predicates and return only the valid mappings (AC10).
    const { filterLemmaMap } = await import('./lemma-util.js');
    const tokens = [
      { surface_form: '伝え',  basic_form: '伝える' },  // included: in set, basic_form differs
      { surface_form: '食べる', basic_form: '食べる' },  // excluded: basic_form === surface_form
      { surface_form: '走り',  basic_form: '走る' },     // excluded: not in surfaceSet
      { surface_form: '書い',  basic_form: '*' },         // excluded: unknown marker
      { surface_form: 'の',    basic_form: null },         // excluded: null basic_form
    ];
    const surfaceSet = new Set(['伝え', '食べる', '書い', 'の']);
    const result = filterLemmaMap(tokens, surfaceSet);
    expect(result).toEqual({ '伝え': '伝える' });
  });
});
