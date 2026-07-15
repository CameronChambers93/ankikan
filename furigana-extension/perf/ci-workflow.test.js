/**
 * Structural tests for the nightly Tier-1 advisory GitHub Actions workflow,
 * issue #44 AC 78-82 (slice 6 — CI phase 1).
 *
 * These are deliberately plain-text assertions on the raw file contents, with
 * no YAML parser dependency — the workflow file (`.github/workflows/perf-tier1.yml`)
 * and the `.gitignore` entry for its CI-only baseline artifact do not exist yet,
 * so every test here fails now (missing file / missing entry). That is the
 * correct RED starting state for this slice.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// This file lives at <worktree>/furigana-extension/perf/ci-workflow.test.js.
// The workflow and root .gitignore live at the worktree root, two levels up.
const workflowPath = path.resolve(__dirname, '../../.github/workflows/perf-tier1.yml');
const gitignorePath = path.resolve(__dirname, '../../.gitignore');

/** Reads a file's raw text, or '' if it doesn't exist yet (keeps later assertions readable instead of throwing). */
function readTextOrEmpty(p) {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return '';
  }
}

describe('perf-tier1.yml — schedule trigger', () => {
  it('T-44-083 the workflow file exists and declares a schedule: trigger with a cron: entry', () => {
    expect(fs.existsSync(workflowPath), `expected ${workflowPath} to exist`).toBe(true);

    const text = readTextOrEmpty(workflowPath);
    expect(text).toMatch(/schedule:/);
    expect(text).toMatch(/cron:/);
  });
});

describe('perf-tier1.yml — Tier-1 run + compare wiring', () => {
  it('T-44-084 the workflow references the Tier-1 micro run, perf/compare.mjs, and perf/baseline.ci.json', () => {
    const text = readTextOrEmpty(workflowPath);

    expect(text).toMatch(/perf:micro|perf\/micro\/run\.js/);
    expect(text).toContain('perf/compare.mjs');
    expect(text).toContain('perf/baseline.ci.json');
  });
});

describe('perf-tier1.yml — advisory, never blocking', () => {
  it('T-44-085 the workflow writes to $GITHUB_STEP_SUMMARY and never passes --check or --strict', () => {
    const text = readTextOrEmpty(workflowPath);

    expect(text).toContain('$GITHUB_STEP_SUMMARY');
    expect(text).not.toContain('--check');
    expect(text).not.toContain('--strict');
  });
});

describe('perf-tier1.yml — least-privilege permissions', () => {
  it('T-44-086 the workflow declares a permissions: block containing contents: read', () => {
    const text = readTextOrEmpty(workflowPath);

    expect(text).toMatch(/permissions:/);
    expect(text).toMatch(/contents:\s*read/);
  });
});

describe('.gitignore — CI-only baseline artifact', () => {
  it('T-44-087 the root .gitignore ignores perf/baseline.ci.json (the CI-only rolling artifact, distinct from the committed baseline.local.json)', () => {
    // Real fs read, no mock — the root .gitignore already exists (it holds the
    // furigana-extension/perf/results/ and perf/fixtures/pages/ entries), so
    // this fails on a genuine missing-entry assertion, not a missing file.
    const text = fs.readFileSync(gitignorePath, 'utf-8');

    expect(text).toMatch(/perf\/baseline\.ci\.json/);
  });
});
