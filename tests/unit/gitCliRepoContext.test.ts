// @mocha
/**
 * The `git` CLI repository lookup the MCP server uses, against throwaway repositories in the temp directory.
 */

import * as assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createGitCliRepoContext } from '../../src/adapters/node/repoContext';

// Spawning git a few times can take longer than mocha's default on a cold machine.
const GIT_TIMEOUT_MS = 15000;

function makeRepo(remote?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'gch-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir });
  return dir;
}

suite('createGitCliRepoContext', function () {
  this.timeout(GIT_TIMEOUT_MS);
  const repos: string[] = [];
  const repo = (remote?: string) => {
    const dir = makeRepo(remote);
    repos.push(dir);
    return join(dir, '.gitlab-ci.yml');
  };

  suiteTeardown(() => repos.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  test('reads a GitLab origin; HEAD falls back to main before the first commit', async () => {
    const context = createGitCliRepoContext();
    const file = repo('git@gitlab.com:group/proj.git');

    assert.deepStrictEqual(await context.remoteContext(file), {
      gitlabInstance: 'gitlab.com',
      projectPath: 'group/proj',
      commitSha: 'main',
    });
    assert.equal(await context.nonGitLabRemote(file), null);
  });

  test('classifies a non-GitLab origin', async () => {
    const context = createGitCliRepoContext();
    const file = repo('https://github.com/owner/repo.git');

    assert.deepStrictEqual(await context.remoteContext(file), {});
    assert.deepStrictEqual(await context.nonGitLabRemote(file), { hostname: 'github.com', projectPath: 'owner/repo', type: 'GitHub' });
  });

  test('a repository without an origin has no context', async () => {
    const context = createGitCliRepoContext();
    const file = repo();

    assert.deepStrictEqual(await context.remoteContext(file), {});
    assert.equal(await context.nonGitLabRemote(file), null);
  });

  test('allowedRoots: no context for files outside the roots, and no discovery of a repository above a root', async () => {
    const insideFile = repo('git@gitlab.com:group/inside.git');
    const outsideFile = repo('git@gitlab.com:group/outside.git');
    const insideRoot = realpathSync(dirname(insideFile));
    const subRoot = join(insideRoot, 'sub');
    mkdirSync(subRoot);

    const scoped = createGitCliRepoContext({ allowedRoots: [insideRoot] });
    assert.equal((await scoped.remoteContext(join(insideRoot, '.gitlab-ci.yml'))).projectPath, 'group/inside');
    assert.deepStrictEqual(await scoped.remoteContext(outsideFile), {});

    const belowRepo = createGitCliRepoContext({ allowedRoots: [subRoot] });
    assert.deepStrictEqual(await belowRepo.remoteContext(join(subRoot, '.gitlab-ci.yml')), {});
  });
});
