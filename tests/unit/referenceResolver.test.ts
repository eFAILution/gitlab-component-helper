// @mocha
/**
 * The core reference resolver over a fake repository lookup, and the remote URL parsers behind it.
 */

import * as assert from 'node:assert/strict';
import { createReferenceResolver, type RepoContextPort, type RepoRemoteContext } from '../../src/core/referenceResolver';
import { classifyRemote, parseGitLabRemoteUrl, type NonGitLabRemote } from '../../src/core/gitRemote';
import { installFakeRuntime, restoreRuntime } from './support/fakeRuntime';

function fakeRepo(remote: RepoRemoteContext, nonGitLab: NonGitLabRemote | null = null) {
  const calls = { remote: 0, nonGitLab: 0 };
  const port: RepoContextPort<string> = {
    remoteContext: async () => {
      calls.remote++;
      return remote;
    },
    nonGitLabRemote: async () => {
      calls.nonGitLab++;
      return nonGitLab;
    },
  };
  return { port, calls };
}

const FILE = '/repo/.gitlab-ci.yml';

suite('createReferenceResolver', () => {
  teardown(restoreRuntime);

  test('prefixes https:// on references without variables, without asking the repository', async () => {
    const { port, calls } = fakeRepo({});
    const resolve = createReferenceResolver(FILE, port);

    assert.deepStrictEqual(await resolve('gitlab.com/group/proj/deploy@1.0.0'), {
      resolved: true,
      url: 'https://gitlab.com/group/proj/deploy@1.0.0',
    });
    assert.deepStrictEqual(calls, { remote: 0, nonGitLab: 0 });
  });

  test('expands variables from the GitLab remote, looking it up once per resolver', async () => {
    const { port, calls } = fakeRepo({ gitlabInstance: 'gitlab.example.com', projectPath: 'group/proj', commitSha: 'abc123' });
    const resolve = createReferenceResolver(FILE, port);

    assert.deepStrictEqual(await resolve('$CI_SERVER_FQDN/$CI_PROJECT_PATH/deploy@$CI_COMMIT_SHA'), {
      resolved: true,
      url: 'https://gitlab.example.com/group/proj/deploy@abc123',
    });
    await resolve('$CI_SERVER_FQDN/other/build@1.0.0');
    assert.deepStrictEqual(calls, { remote: 1, nonGitLab: 0 });
  });

  test('reports a non-GitLab repository', async () => {
    const { port } = fakeRepo({}, { hostname: 'github.com', projectPath: 'o/r', type: 'GitHub' });

    assert.deepStrictEqual(await createReferenceResolver(FILE, port)('$CI_SERVER_FQDN/g/p/c@1.0.0'), {
      resolved: false,
      reason: { kind: 'non-gitlab-repo', hostname: 'github.com', type: 'GitHub' },
    });
  });

  test('falls back to the first configured component source, then to no context', async () => {
    installFakeRuntime({ componentSources: [{ name: 'CI', path: 'shared/ci', gitlabInstance: 'gitlab.internal' }] });
    const { port } = fakeRepo({});

    assert.deepStrictEqual(await createReferenceResolver(FILE, port)('$CI_SERVER_FQDN/g/p/c@1.0.0'), {
      resolved: true,
      url: 'https://gitlab.internal/g/p/c@1.0.0',
    });

    installFakeRuntime({ componentSources: [] });
    assert.deepStrictEqual(await createReferenceResolver(FILE, port)('$CI_SERVER_FQDN/g/p/c@1.0.0'), {
      resolved: false,
      reason: { kind: 'no-context' },
    });
  });

  test('reports variables it cannot expand as incomplete', async () => {
    const { port } = fakeRepo({ gitlabInstance: 'gitlab.com', projectPath: 'group/proj' });

    assert.deepStrictEqual(await createReferenceResolver(FILE, port)('$CI_SERVER_FQDN/g/p/c@$CI_COMMIT_TAG'), {
      resolved: false,
      reason: { kind: 'incomplete', expandedUrl: 'https://gitlab.com/g/p/c@$CI_COMMIT_TAG' },
    });
  });
});

suite('git remote parsing', () => {
  test('parseGitLabRemoteUrl reads HTTPS and SSH GitLab remotes and ignores other hosts', () => {
    assert.deepStrictEqual(parseGitLabRemoteUrl('https://gitlab.com/group/proj.git'), { gitlabInstance: 'gitlab.com', projectPath: 'group/proj' });
    assert.deepStrictEqual(parseGitLabRemoteUrl('git@gitlab.example.com:group/sub/proj.git'), { gitlabInstance: 'gitlab.example.com', projectPath: 'group/sub/proj' });
    assert.equal(parseGitLabRemoteUrl('https://github.com/o/r.git'), null);
  });

  test('classifyRemote names non-GitLab hosts and returns null for GitLab', () => {
    assert.deepStrictEqual(classifyRemote('git@github.com:o/r.git'), { hostname: 'github.com', projectPath: 'o/r', type: 'GitHub' });
    assert.deepStrictEqual(classifyRemote('https://bitbucket.org/o/r.git'), { hostname: 'bitbucket.org', projectPath: 'o/r', type: 'Bitbucket' });
    assert.deepStrictEqual(classifyRemote('https://git.example.com/o/r'), { hostname: 'git.example.com', projectPath: 'o/r', type: 'Git Repository' });
    assert.equal(classifyRemote('https://gitlab.com/o/r.git'), null);
  });
});
