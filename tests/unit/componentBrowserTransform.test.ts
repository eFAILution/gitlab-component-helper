// @mocha
/**
 * Tests src/providers/componentBrowserTransform.ts — building the nested `source → project → component → versions`
 * shape the Component Browser webview consumes, plus the version-priority logic that picks each component's
 * default version.
 */

import * as assert from 'node:assert/strict';
import {
  extractProjectUrl,
  versionPriority,
  selectDefaultVersion,
  transformCachedComponentsToGroups,
} from '../../src/providers/componentBrowserTransform';

interface TransformedSource {
  source: string;
  totalComponents: number;
  totalVersions: number;
  projectCount: number;
  componentCount: number;
  projects: Array<{
    name: string;
    path: string;
    components: Array<{
      name: string;
      versionCount: number;
      defaultVersion: string;
      availableVersions: string[];
    }>;
  }>;
}

suite('extractProjectUrl', () => {
  test('strips the trailing component name and @version', () => {
    assert.strictEqual(
      extractProjectUrl('https://gitlab.com/group/project/my-component@v1.0.0'),
      'https://gitlab.com/group/project',
    );
  });

  test('handles URLs without an @version', () => {
    assert.strictEqual(
      extractProjectUrl('https://gitlab.com/group/project/my-component'),
      'https://gitlab.com/group/project',
    );
  });

  test('returns empty string for undefined input', () => {
    assert.strictEqual(extractProjectUrl(undefined), '');
  });

  test('returns the input verbatim when it is not a valid URL', () => {
    assert.strictEqual(extractProjectUrl('not-a-url'), 'not-a-url');
  });
});

suite('versionPriority', () => {
  test('synthetic branches rank latest > main > master', () => {
    assert.ok(versionPriority('latest') > versionPriority('main'));
    assert.ok(versionPriority('main') > versionPriority('master'));
  });

  test('branch scores beat unrecognised strings and very low semvers', () => {
    // Branch scores: latest=1000, main=900, master=800. A semver with major=0 reaches at most 999 (0.999.999),
    // so `master` (800) beats `v0.0.0`–`v0.0.800`. The cutoff isn't intuitive — captured here as a regression
    // guard rather than a recommendation.
    assert.ok(versionPriority('master') > versionPriority('v0.0.0'));
    assert.ok(versionPriority('master') > versionPriority('rolling'));
  });

  test('semvers with major >= 1 beat branch names', () => {
    // v1.0.0 packs to 1_000_000, dwarfing the branch caps (≤ 1000). Documents the priority crossover so callers
    // can reason about which input "wins" when both forms are present in availableVersions.
    assert.ok(versionPriority('v1.0.0') > versionPriority('latest'));
  });

  test('semver scores order correctly by major, minor, patch', () => {
    assert.ok(versionPriority('v2.0.0') > versionPriority('v1.999.999'));
    assert.ok(versionPriority('v1.2.0') > versionPriority('v1.1.999'));
    assert.ok(versionPriority('v1.0.10') > versionPriority('v1.0.9'));
  });

  test('v-prefix is optional', () => {
    assert.strictEqual(versionPriority('v1.0.0'), versionPriority('1.0.0'));
  });

  test('unknown or empty version scores 0', () => {
    assert.strictEqual(versionPriority(undefined), 0);
    assert.strictEqual(versionPriority('rolling'), 0);
  });
});

suite('selectDefaultVersion', () => {
  test('prefers highest semver over `latest`', () => {
    assert.strictEqual(selectDefaultVersion(['latest', 'v1.0.0', 'v2.0.0'], 'latest'), 'v2.0.0');
  });

  test('prefers semver over branch names', () => {
    assert.strictEqual(selectDefaultVersion(['main', 'master', 'v1.5.0'], 'main'), 'v1.5.0');
  });

  test('falls back to `main` over `master` when only branches are present', () => {
    assert.strictEqual(selectDefaultVersion(['main', 'master'], 'main'), 'main');
  });

  test('returns the lone version when only `latest` is present', () => {
    assert.strictEqual(selectDefaultVersion(['latest'], 'latest'), 'latest');
  });

  test('orders semvers correctly (major.minor.patch as integers)', () => {
    assert.strictEqual(selectDefaultVersion(['v1.0.0', 'v1.10.0', 'v1.2.0'], 'v1.0.0'), 'v1.10.0');
    assert.strictEqual(selectDefaultVersion(['v1.10.0', 'v2.0.0', 'v10.0.0'], 'v1.10.0'), 'v10.0.0');
  });

  test('returns the supplied fallback when input has no truthy entries', () => {
    assert.strictEqual(selectDefaultVersion([], 'v0.0.1'), 'v0.0.1');
  });
});

suite('transformCachedComponentsToGroups — shape', () => {
  test('produces one source group with nested project + component for a single entry', () => {
    const result = transformCachedComponentsToGroups([
      {
        name: 'test-component',
        description: 'A test component',
        parameters: [{ name: 'env', description: 'Target environment', required: true, type: 'string' }],
        version: 'v1.0.0',
        source: 'Test Source',
        sourcePath: 'group/project',
        gitlabInstance: 'gitlab.com',
      },
    ]) as TransformedSource[];

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].source, 'Test Source');
    assert.strictEqual(result[0].totalComponents, 1);
    assert.strictEqual(result[0].projects.length, 1);
    assert.strictEqual(result[0].projects[0].components.length, 1);

    const component = result[0].projects[0].components[0];
    assert.strictEqual(component.name, 'test-component');
    assert.strictEqual(component.versionCount, 1);
    assert.strictEqual(component.defaultVersion, 'v1.0.0');
  });

  test('skips entries missing source / sourcePath / name and invokes the onSkip callback', () => {
    const skipped: Array<{ comp: unknown; reason: string }> = [];
    const result = transformCachedComponentsToGroups(
      [
        {
          name: 'good-component',
          version: 'v1.0.0',
          source: 'Good Source',
          sourcePath: 'group/good',
          gitlabInstance: 'gitlab.com',
        },
        { name: 'no-source', version: 'v1.0.0', sourcePath: 'group/bad', gitlabInstance: 'gitlab.com' },
        { description: 'no-name', version: 'v1.0.0', source: 'X', sourcePath: 'group/bad', gitlabInstance: 'gitlab.com' },
      ],
      (comp, reason) => skipped.push({ comp, reason }),
    ) as TransformedSource[];

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].totalComponents, 1);
    assert.strictEqual(result[0].projects[0].components[0].name, 'good-component');
    assert.strictEqual(skipped.length, 2, 'onSkip must fire for each dropped entry');
    assert.ok(skipped.every((s) => s.reason === 'missing source/sourcePath/name'));
  });

  test('splits `source: Foo/Bar` into mainSource=Foo and groups by main source', () => {
    const result = transformCachedComponentsToGroups([
      {
        name: 'a',
        version: 'v1.0.0',
        source: 'Source One/Project Alpha',
        sourcePath: 'source-one/project-alpha',
        gitlabInstance: 'gitlab.com',
      },
      {
        name: 'b',
        version: 'v2.0.0',
        source: 'Source One/Project Beta',
        sourcePath: 'source-one/project-beta',
        gitlabInstance: 'gitlab.com',
      },
      {
        name: 'c',
        version: 'v1.5.0',
        source: 'Source Two',
        sourcePath: 'source-two/project-gamma',
        gitlabInstance: 'gitlab.example.com',
      },
    ]) as TransformedSource[];

    assert.strictEqual(result.length, 2);
    const sourceOne = result.find((s) => s.source === 'Source One');
    const sourceTwo = result.find((s) => s.source === 'Source Two');
    assert.ok(sourceOne, 'expected a "Source One" group');
    assert.ok(sourceTwo, 'expected a "Source Two" group');
    assert.strictEqual(sourceOne.projects.length, 2);
    assert.strictEqual(sourceOne.totalComponents, 2);
    assert.strictEqual(sourceTwo.projects.length, 1);
    assert.strictEqual(sourceTwo.totalComponents, 1);
  });
});

suite('transformCachedComponentsToGroups — default version selection', () => {
  test('chooses the highest semantic version over `latest`', () => {
    const result = transformCachedComponentsToGroups([
      {
        name: 'multi-version-component',
        version: 'latest',
        availableVersions: ['latest', 'v1.2.3', 'v2.0.0', 'main'],
        source: 'Version Test Source',
        sourcePath: 'group/multi-version',
        gitlabInstance: 'gitlab.com',
      },
    ]) as TransformedSource[];

    const component = result[0].projects[0].components[0];
    assert.strictEqual(component.versionCount, 4);
    assert.deepStrictEqual(
      component.availableVersions,
      ['latest', 'v1.2.3', 'v2.0.0', 'main'],
      'availableVersions must round-trip the input order',
    );
    assert.strictEqual(component.defaultVersion, 'v2.0.0');
  });

  test('semver ordering treats `10` as higher than `2`', () => {
    const result = transformCachedComponentsToGroups([
      {
        name: 'edge-component',
        version: 'latest',
        availableVersions: ['latest', 'main', 'master', 'v10.0.0', 'v2.1.0', 'v2.10.0'],
        source: 'Edge Source',
        sourcePath: 'edge/component',
        gitlabInstance: 'gitlab.com',
      },
    ]) as TransformedSource[];

    assert.strictEqual(result[0].projects[0].components[0].defaultVersion, 'v10.0.0');
  });
});
