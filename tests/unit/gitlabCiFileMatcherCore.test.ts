// @mocha
/**
 * Tests src/utils/gitlabCiFileMatcherCore.ts — the pure minimatch-backed logic that decides whether a
 * `(filePath, languageId)` pair should trigger the GitLab CI providers.
 *
 * Production's `isGitLabCIFile(document)` in gitlabCiFileMatcher.ts delegates here after extracting `fsPath` and
 * `languageId` from the `vscode.TextDocument`, so these tests cover the same code path the extension host hits.
 */

import * as assert from 'node:assert/strict';
import {
  ALLOWED_LANGUAGE_IDS,
  DEFAULT_GITLAB_CI_FILE_GLOBS,
  buildFileGlobs,
  matchesGitLabCIFile,
  normaliseGlob,
} from '../../src/utils/gitlabCiFileMatcherCore';

suite('normaliseGlob', () => {
  test('prefixes a bare pattern with `**/` so it matches at any directory depth', () => {
    assert.strictEqual(normaliseGlob('ci/*.yml'), '**/ci/*.yml');
    assert.strictEqual(normaliseGlob('.gitlab2/**/*.yml'), '**/.gitlab2/**/*.yml');
  });

  test('leaves patterns already anchored at any depth untouched', () => {
    assert.strictEqual(normaliseGlob('**/foo.yml'), '**/foo.yml');
  });

  test('leaves patterns anchored at the path root untouched', () => {
    assert.strictEqual(normaliseGlob('/exact/path.yml'), '/exact/path.yml');
  });
});

suite('buildFileGlobs', () => {
  test('returns the defaults verbatim when no additional globs are supplied', () => {
    assert.deepStrictEqual(buildFileGlobs(), [...DEFAULT_GITLAB_CI_FILE_GLOBS]);
  });

  test('appends user globs after normalising them', () => {
    assert.deepStrictEqual(buildFileGlobs(['ci/*.yml', '**/extra/*.yaml']), [
      ...DEFAULT_GITLAB_CI_FILE_GLOBS,
      '**/ci/*.yml',
      '**/extra/*.yaml',
    ]);
  });
});

suite('matchesGitLabCIFile — language-id escape hatches', () => {
  test('returns true for `gitlab-ci` regardless of filename', () => {
    assert.strictEqual(matchesGitLabCIFile('repo/anything.txt', 'gitlab-ci', buildFileGlobs()), true);
  });

  test('returns true for `shellscript` regardless of filename', () => {
    assert.strictEqual(matchesGitLabCIFile('repo/some-script.sh', 'shellscript', buildFileGlobs()), true);
    // Untitled documents have non-filesystem-shaped URIs; the language-id branch must still win.
    assert.strictEqual(matchesGitLabCIFile('untitled:Untitled-1', 'shellscript', buildFileGlobs()), true);
  });

  test('exposes the allowed-language-ids set for downstream callers', () => {
    assert.ok(ALLOWED_LANGUAGE_IDS.has('gitlab-ci'));
    assert.ok(ALLOWED_LANGUAGE_IDS.has('shellscript'));
    assert.ok(!ALLOWED_LANGUAGE_IDS.has('yaml'));
  });
});

suite('matchesGitLabCIFile — default globs (yaml language)', () => {
  const globs = buildFileGlobs();
  const positiveCases: Array<{ path: string; label: string }> = [
    { path: 'repo/.gitlab-ci.yml', label: 'canonical .yml in subdir' },
    { path: 'repo/.gitlab-ci.yaml', label: 'canonical .yaml in subdir' },
    { path: '.gitlab-ci.yml', label: 'root canonical' },
    { path: 'repo/.gitlab/ci/build.yml', label: '.gitlab/ nested .yml' },
    { path: 'repo/.gitlab/pipelines/deploy.yaml', label: '.gitlab/ deep .yaml' },
  ];
  for (const c of positiveCases) {
    test(`matches: ${c.label} (${c.path})`, () => {
      assert.strictEqual(matchesGitLabCIFile(c.path, 'yaml', globs), true);
    });
  }

  const negativeCases: Array<{ path: string; label: string }> = [
    { path: 'repo/ci/build.yml', label: 'ci/ not in defaults' },
    { path: 'repo/pipelines/release.yaml', label: 'pipelines/ not in defaults' },
    { path: 'repo/random.yml', label: 'unrelated yaml' },
    // Regression guard: validation must not fire on arbitrary YAML — only files matching the defaults.
    { path: 'repo/docker-compose.yml', label: 'plain YAML with no matching glob' },
    { path: 'repo/kustomize/base.yaml', label: 'arbitrary YAML in unrelated subdir' },
  ];
  for (const c of negativeCases) {
    test(`rejects: ${c.label} (${c.path})`, () => {
      assert.strictEqual(matchesGitLabCIFile(c.path, 'yaml', globs), false);
    });
  }
});

suite('matchesGitLabCIFile — user-supplied additional globs', () => {
  test('a user glob (single-level) brings in matching paths', () => {
    const globs = buildFileGlobs(['**/ci/*.yml']);
    assert.strictEqual(matchesGitLabCIFile('repo/ci/build.yml', 'yaml', globs), true);
  });

  test('a single-level user glob does NOT match deeper paths', () => {
    const globs = buildFileGlobs(['**/ci/*.yml']);
    assert.strictEqual(matchesGitLabCIFile('repo/ci/sub/build.yml', 'yaml', globs), false);
  });

  test('defaults still apply when additional globs are present', () => {
    const globs = buildFileGlobs(['**/ci/*.yml']);
    assert.strictEqual(matchesGitLabCIFile('repo/.gitlab-ci.yml', 'yaml', globs), true);
  });

  test('unanchored user glob is normalised so it matches at any depth', () => {
    const globs = buildFileGlobs(['.gitlab2/**/*.yml']);
    assert.strictEqual(matchesGitLabCIFile('repo/.gitlab2/foo/bar.yml', 'yaml', globs), true);
    assert.strictEqual(matchesGitLabCIFile('.gitlab2/foo/bar.yml', 'yaml', globs), true);
  });

  test('unanchored user glob does not over-match unrelated paths', () => {
    const globs = buildFileGlobs(['.gitlab2/**/*.yml']);
    assert.strictEqual(matchesGitLabCIFile('repo/other/bar.yml', 'yaml', globs), false);
  });
});
