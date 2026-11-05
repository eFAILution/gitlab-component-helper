// @mocha
/**
 * The decision-record checker in scripts/ci (ADR-366): the branch rule, the read-time index, the scaffold and the
 * CLI. Fixtures live in temp directories; branch checks use throwaway git repositories. Store shape checks are in
 * decisionRecordsStore.test.ts.
 */

import * as assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as yaml from 'js-yaml';
import { buildIndex, main, runCheck, skeleton } from '../../scripts/ci/decisionRecords';
import { branchFindings, branchIssue } from '../../scripts/ci/decisionRecordsBranch';
import { LEGACY_KEYS } from '../../scripts/ci/decisionRecordsStore';
import {
  BASE_ENTRY, commitAll, DEFAULT_LEGACY, errorsFor, type Fields, git, recordDoc, useTempRoots, writeFixture,
} from './support/decisionRecordFixtures';

const REPO_ROOT = resolve(__dirname, '..', '..');
const GIT_TIMEOUT_MS = 20000;

interface Captured {
  code: number;
  out: string;
  err: string;
}

function runCli(root: string, argv: string[], env: NodeJS.ProcessEnv = {}): Captured {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, {
    cwd: root,
    env,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    today: new Date(2026, 9, 22),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}


suite('decision records', function () {
  this.timeout(GIT_TIMEOUT_MS);
  const { fixture } = useTempRoots();

  suite('branchIssue', () => {
    const named: Array<[string, number]> = [
      ['feat/483-issue-keyed-records', 483],
      ['chore/366-issue-keyed-workflow', 366],
      ['fix/12-x', 12],
      ['docs/700', 700],
      ['claude/366-a/b', 366],
      ['release.v2/9-x', 9],
    ];
    named.forEach(([branch, issue]) => test(`${branch} -> #${issue}`, () => assert.equal(branchIssue(branch), issue)));

    const unnamed = ['', 'main', 'beta', 'patch-1', 'feat/add-login', 'dependabot/npm_and_yarn/js-yaml-5.6.0',
      'feat/0483-padded', 'feat/483x', '483-no-prefix', 'feat/-483'];
    unnamed.forEach((branch) => test(`'${branch}' has no issue`, () => assert.equal(branchIssue(branch), undefined)));

    test('an undefined branch has no issue', () => assert.equal(branchIssue(undefined), undefined));
  });

  suite('branchFindings', () => {
    test('a record keyed to the branch issue passes', () => {
      assert.deepEqual(branchFindings(['.ai/decisions/ADR-483.yaml'], 'feat/483-x'), { errors: [], warnings: [] });
    });

    test('a record keyed to another issue fails and names the expected file', () => {
      const { errors, warnings } = branchFindings(['.ai/decisions/ADR-490.yaml'], 'feat/483-x');
      assert.deepEqual(warnings, []);
      assert.equal(errors.length, 1);
      assert.match(errors[0], /issue #483/);
      assert.match(errors[0], /\.ai\/decisions\/ADR-483\.yaml/);
    });

    test('no issue number and no record only warns', () => {
      const { errors, warnings } = branchFindings([], 'dependabot/npm_and_yarn/foo-1.2');
      assert.deepEqual(errors, []);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /no issue number/);
    });

    test('no issue number with a record fails', () => {
      const { errors, warnings } = branchFindings(['.ai/decisions/ADR-483.yaml'], 'patch-1');
      assert.deepEqual(warnings, []);
      assert.equal(errors.length, 1);
      assert.match(errors[0], /patch-1/);
      assert.match(errors[0], /<type>\/<issue>-<description>/);
    });

    test('an added README.md is not a record', () => {
      assert.deepEqual(branchFindings(['.ai/decisions/README.md'], 'feat/483-x'), { errors: [], warnings: [] });
    });
  });

  suite('branch rule against git', () => {
    const repo = (): string => {
      const root = fixture();
      git(root, 'init', '-q', '-b', 'beta');
      commitAll(root, 'base');
      return root;
    };

    test('an added record must carry the branch issue', () => {
      const root = repo();
      writeFixture(root, { records: { 'ADR-483.yaml': recordDoc('ADR-483') } });
      commitAll(root, 'add');
      assert.deepEqual(runCheck(root, { branch: 'feat/483-x', base: 'HEAD^1' }), { errors: [], warnings: [] });
      const { errors } = runCheck(root, { branch: 'feat/490-x', base: 'HEAD^1' });
      assert.equal(errors.length, 1);
      assert.match(errors[0], /ADR-490\.yaml/);
      assert.match(runCheck(root, { branch: 'patch-1', base: 'HEAD^1' }).errors.join('\n'), /patch-1/);
    });

    test('editing an existing record is not adding one', () => {
      const root = repo();
      writeFixture(root, { records: { 'ADR-483.yaml': recordDoc('ADR-483') } });
      commitAll(root, 'add');
      writeFixture(root, { records: { 'ADR-483.yaml': recordDoc('ADR-483', { status: 'superseded' }) } });
      commitAll(root, 'edit');
      assert.deepEqual(runCheck(root, { branch: 'feat/490-x', base: 'HEAD^1' }), { errors: [], warnings: [] });
    });

    test('a renamed record counts as added', () => {
      const root = repo();
      writeFixture(root, { records: { 'ADR-483.yaml': recordDoc('ADR-483') } });
      commitAll(root, 'add');
      git(root, 'mv', '.ai/decisions/ADR-483.yaml', '.ai/decisions/ADR-490.yaml');
      writeFileSync(join(root, '.ai', 'decisions', 'ADR-490.yaml'), recordDoc('ADR-490'));
      commitAll(root, 'rename');
      assert.deepEqual(runCheck(root, { branch: 'feat/490-x', base: 'HEAD^1' }).errors, []);
      assert.equal(runCheck(root, { branch: 'feat/483-x', base: 'HEAD^1' }).errors.length, 1);
    });

    test('a branch with no issue number and no record only warns', () => {
      const root = repo();
      writeFileSync(join(root, 'README.md'), 'hi\n');
      commitAll(root, 'docs');
      const { errors, warnings } = runCheck(root, { branch: 'dependabot/npm_and_yarn/x-1', base: 'HEAD^1' });
      assert.deepEqual(errors, []);
      assert.equal(warnings.length, 1);
    });

    test('an unknown base is an error that says how to fix it', () => {
      const errors = runCheck(repo(), { branch: 'feat/483-x', base: 'origin/nope' }).errors.join('\n');
      assert.match(errors, /origin\/nope/);
      assert.match(errors, /git fetch/);
    });
  });

  suite('index', () => {
    test('legacy keys first in file order, then records by number', () => {
      const records = {
        'ADR-1000.yaml': recordDoc('ADR-1000'),
        'ADR-483.yaml': recordDoc('ADR-483', { supersedes: ['CACHE_COMPONENTS'] }),
      };
      const rows = buildIndex(fixture({ records }));
      assert.deepEqual(rows.map((row) => row.id), ['USE_ESBUILD', 'CACHE_COMPONENTS', 'ADR-483', 'ADR-1000']);
      assert.equal(rows[1].superseded_by, 'ADR-483');
      assert.equal(rows[1].source, '.ai/decisions.yaml');
      assert.equal(rows[2].source, '.ai/decisions/ADR-483.yaml');
      assert.equal(rows[0].superseded_by, undefined);
    });

    test('a legacy superseded_by is carried through', () => {
      const legacy = { ...DEFAULT_LEGACY, USE_ESBUILD: { ...BASE_ENTRY, superseded_by: 'CACHE_COMPONENTS' } };
      assert.equal(buildIndex(fixture({ legacy }))[0].superseded_by, 'CACHE_COMPONENTS');
    });
  });

  suite('skeleton', () => {
    test('passes check and keeps a title with quotes and a colon', () => {
      const text = skeleton(483, 'A "quoted": title', new Date(2026, 9, 22));
      assert.equal(errorsForFixtureRecord(text), '');
      const { decisions } = yaml.load(text) as { decisions: Record<string, Fields> };
      assert.equal(decisions['ADR-483'].title, 'A "quoted": title');
      assert.equal(decisions['ADR-483'].date, '2026-10-22');
    });

    function errorsForFixtureRecord(text: string): string {
      return errorsFor(fixture({ records: { 'ADR-483.yaml': text } }));
    }
  });

  suite('CLI', () => {
    test('check prints OK and exits 0', () => {
      const { code, out } = runCli(fixture(), ['check']);
      assert.equal(code, 0);
      assert.match(out, /Decision records OK/);
    });

    test('in GitHub Actions, problems are annotations on stdout', () => {
      const root = fixture({ legacy: { ...DEFAULT_LEGACY, NEW_THING: BASE_ENTRY } });
      const { code, out } = runCli(root, ['check', '--branch', 'patch-1'], { GITHUB_ACTIONS: 'true' });
      assert.equal(code, 1);
      assert.match(out, /^::warning::/m);
      assert.match(out, /^::error::/m);
    });

    test('locally, problems go to stderr', () => {
      const { code, err } = runCli(fixture({ legacy: { ...DEFAULT_LEGACY, NEW_THING: BASE_ENTRY } }), ['check']);
      assert.equal(code, 1);
      assert.match(err, /^error: /m);
    });

    test('--base needs --branch', () => {
      assert.equal(runCli(fixture(), ['check', '--base', 'HEAD^1']).code, 2);
    });

    test('unknown commands and options are usage errors', () => {
      assert.equal(runCli(fixture(), ['nope']).code, 2);
      assert.equal(runCli(fixture(), ['check', '--nope']).code, 2);
      assert.equal(runCli(fixture(), []).code, 2);
      assert.equal(runCli(fixture(), ['list', '--format', 'xml']).code, 2);
    });

    ['table', 'yaml', 'json'].forEach((format) => test(`list --format ${format}`, () => {
      const records = { 'ADR-483.yaml': recordDoc('ADR-483', { supersedes: ['USE_ESBUILD'] }) };
      const { code, out } = runCli(fixture({ records }), ['list', '--format', format]);
      assert.equal(code, 0);
      assert.match(out, /ADR-483/);
      if (format === 'json') assert.equal(JSON.parse(out)[0].superseded_by, 'ADR-483');
      if (format === 'yaml') assert.equal((yaml.load(out) as Fields[]).length, 3);
      if (format === 'table') assert.match(out, /\(superseded by ADR-483\)/);
    }));

    test('list defaults to a table', () => assert.match(runCli(fixture(), ['list']).out, /USE_ESBUILD\s+accepted/));

    test('new --issue writes the record and refuses to overwrite it', () => {
      const root = fixture();
      assert.equal(runCli(root, ['new', '--issue', '483', '--title', 'Thing']).code, 0);
      const target = join(root, '.ai', 'decisions', 'ADR-483.yaml');
      assert.ok(existsSync(target));
      assert.equal(errorsFor(root), '');
      const again = runCli(root, ['new', '--issue', '483', '--title', 'Other']);
      assert.equal(again.code, 1);
      assert.match(again.err, /already exists/);
      assert.match(readFileSync(target, 'utf8'), /Thing/);
    });

    test('new takes the issue from the current branch', () => {
      const root = fixture();
      git(root, 'init', '-q', '-b', 'fix/512-thing');
      commitAll(root, 'base');
      const { code, out } = runCli(root, ['new', '--title', 'From the branch']);
      assert.equal(code, 0);
      assert.match(out, /ADR-512\.yaml/);
      const { decisions } = yaml.load(readFileSync(join(root, '.ai', 'decisions', 'ADR-512.yaml'), 'utf8')) as {
        decisions: Record<string, Fields>;
      };
      assert.equal(decisions['ADR-512'].title, 'From the branch');
    });

    test('new without an issue, or without a title, fails', () => {
      const root = fixture();
      git(root, 'init', '-q', '-b', 'main');
      commitAll(root, 'base');
      assert.equal(runCli(root, ['new', '--title', 'No issue']).code, 1);
      assert.equal(runCli(root, ['new', '--issue', '483']).code, 2);
      assert.equal(runCli(root, ['new', '--issue', '0483', '--title', 'Padded']).code, 2);
    });
  });

  suite('this repository', () => {
    test('passes check', () => assert.deepEqual(runCheck(REPO_ROOT, {}).errors, []));

    test('its index lists every legacy key and ADR-366', () => {
      const ids = buildIndex(REPO_ROOT).map((row) => row.id);
      assert.deepEqual(ids.slice(0, LEGACY_KEYS.length), [...LEGACY_KEYS]);
      assert.ok(ids.includes('ADR-366'));
      assert.equal(new Set(ids).size, ids.length);
    });
  });
});
