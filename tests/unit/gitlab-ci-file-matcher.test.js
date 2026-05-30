/**
 * GitLab CI File Matcher behavior contract tests
 */
/* eslint-env node */
const assert = require('assert');
const { minimatch } = require('minimatch');

const DEFAULT_GLOBS = [
  '**/.gitlab-ci.yml',
  '**/.gitlab-ci.yaml',
  '**/.gitlab/**/*.yml',
  '**/.gitlab/**/*.yaml',
];

const ALLOWED_LANGUAGE_IDS = new Set(['gitlab-ci', 'shellscript']);

function normaliseGlob(pattern) {
  if (pattern.startsWith('**/') || pattern.startsWith('/')) return pattern;
  return `**/${pattern}`;
}

function isGitLabCIFile(filePath, languageId, additionalGlobs = []) {
  if (ALLOWED_LANGUAGE_IDS.has(languageId)) return true;
  const globs = [...DEFAULT_GLOBS, ...additionalGlobs.map(normaliseGlob)];
  return globs.some(glob => minimatch(filePath, glob, { dot: true }));
}

const cases = [
  // Canonical names always match under defaults.
  { path: 'repo/.gitlab-ci.yml', langId: 'yaml', expected: true, label: 'canonical .yml' },
  { path: 'repo/.gitlab-ci.yaml', langId: 'yaml', expected: true, label: 'canonical .yaml' },
  { path: '.gitlab-ci.yml', langId: 'yaml', expected: true, label: 'root canonical' },

  // .gitlab/ directory convention is matched out of the box.
  { path: 'repo/.gitlab/ci/build.yml', langId: 'yaml', expected: true, label: '.gitlab/ nested .yml' },
  { path: 'repo/.gitlab/pipelines/deploy.yaml', langId: 'yaml', expected: true, label: '.gitlab/ deep .yaml' },

  // Non-canonical YAML outside .gitlab/ is silent under defaults.
  { path: 'repo/ci/build.yml', langId: 'yaml', expected: false, label: 'ci/ not in defaults' },
  { path: 'repo/pipelines/release.yaml', langId: 'yaml', expected: false, label: 'pipelines/ not in defaults' },
  { path: 'repo/random.yml', langId: 'yaml', expected: false, label: 'unrelated yaml' },

  // Language ID escape hatch: an explicit gitlab-ci association always wins.
  { path: 'repo/anything.txt', langId: 'gitlab-ci', expected: true, label: 'gitlab-ci languageId override' },

  // shellscript documents are always considered in-scope so providers can surface
  // inside `script:` blocks regardless of filename.
  { path: 'repo/some-script.sh', langId: 'shellscript', expected: true, label: 'shellscript language always matches' },
  { path: 'untitled:Untitled-1', langId: 'shellscript', expected: true, label: 'untitled shellscript matches' },

  // Plain YAML that no glob matches must not be treated as a GitLab CI file —
  // this is the regression guard for validation no longer firing on arbitrary YAML.
  { path: 'repo/docker-compose.yml', langId: 'yaml', expected: false, label: 'plain YAML, no matching glob, not GitLab CI' },
  { path: 'repo/kustomize/base.yaml', langId: 'yaml', expected: false, label: 'arbitrary YAML in unrelated subdir' },
];

const additionalGlobs = ['**/ci/*.yml'];
const customCases = [
  { path: 'repo/ci/build.yml', langId: 'yaml', expected: true, label: 'ci/ now matches additional glob' },
  { path: 'repo/ci/sub/build.yml', langId: 'yaml', expected: false, label: 'additional glob is single-level only' },
  { path: 'repo/.gitlab-ci.yml', langId: 'yaml', expected: true, label: 'defaults still apply with additional globs' },
];

// Normalisation: a user-supplied glob without a leading `**/` or `/` is anchored
// at the start of the absolute path by vscode.languages.match — which never matches.
// We prefix `**/` automatically so the intuitive form works.
const unanchoredGlobs = ['.gitlab2/**/*.yml'];
const normalisationCases = [
  { path: 'repo/.gitlab2/foo/bar.yml', langId: 'yaml', expected: true, label: 'unanchored user glob matches at any depth' },
  { path: '.gitlab2/foo/bar.yml', langId: 'yaml', expected: true, label: 'unanchored user glob still matches at root' },
  { path: 'repo/other/bar.yml', langId: 'yaml', expected: false, label: 'unanchored user glob does not over-match' },
];

let failures = 0;
console.log('=== gitlab-ci-file-matcher tests ===');

for (const c of cases) {
  const actual = isGitLabCIFile(c.path, c.langId);
  if (actual !== c.expected) {
    console.log(`  FAIL: ${c.label} — expected ${c.expected}, got ${actual} for ${c.path} (${c.langId})`);
    failures += 1;
  } else {
    console.log(`  ok:   ${c.label}`);
  }
}

for (const c of customCases) {
  const actual = isGitLabCIFile(c.path, c.langId, additionalGlobs);
  if (actual !== c.expected) {
    console.log(`  FAIL: ${c.label} — expected ${c.expected}, got ${actual} for ${c.path} (${c.langId})`);
    failures += 1;
  } else {
    console.log(`  ok:   ${c.label}`);
  }
}

for (const c of normalisationCases) {
  const actual = isGitLabCIFile(c.path, c.langId, unanchoredGlobs);
  if (actual !== c.expected) {
    console.log(`  FAIL: ${c.label} — expected ${c.expected}, got ${actual} for ${c.path} (${c.langId})`);
    failures += 1;
  } else {
    console.log(`  ok:   ${c.label}`);
  }
}

assert.strictEqual(failures, 0, `${failures} matcher case(s) failed`);
console.log('All gitlab-ci-file-matcher cases passed.');
