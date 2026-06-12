// @mocha
/**
 * Tests src/utils/templateFileUrl.ts — building the public GitLab URL that points at a component's template file.
 *
 * Two distinct shapes are exercised:
 *  - Single-file form (`templates/<name>.yml`)            → `/-/blob/<ref>/<templatePath>` pointing at the file.
 *  - Directory form (`templates/<name>/template.yml` …)   → `/-/tree/<ref>/<dir>` pointing at the parent directory.
 *
 * Plus the `ref` defaulting (`main` when absent) and URL-encoding of refs that contain `/`.
 */

import * as assert from 'node:assert/strict';
import { templateFileUrlForResolved } from '../../src/utils/templateFileUrl';

suite('templateFileUrlForResolved', () => {
  test('single-file template links to the file via /-/blob/', () => {
    const url = templateFileUrlForResolved({
      gitlabInstance: 'gitlab.com',
      projectPath: 'yu-life/infrastructure/yulife-devops-shared-config',
      version: 'install-yu-ci-tools-2',
      templatePath: 'templates/install-yu-ci-tools.yml',
    });
    assert.strictEqual(
      url,
      'https://gitlab.com/yu-life/infrastructure/yulife-devops-shared-config/-/blob/install-yu-ci-tools-2/templates/install-yu-ci-tools.yml',
    );
  });

  test('directory-form template links to the parent directory via /-/tree/', () => {
    const url = templateFileUrlForResolved({
      gitlabInstance: 'gitlab.com',
      projectPath: 'components/opentofu',
      version: '2.9.0',
      templatePath: 'templates/full-pipeline/template.yml',
    });
    assert.strictEqual(url, 'https://gitlab.com/components/opentofu/-/tree/2.9.0/templates/full-pipeline');
  });

  test('directory form preserves nested project paths', () => {
    const url = templateFileUrlForResolved({
      gitlabInstance: 'gitlab.com',
      projectPath: 'yu-life/infrastructure/yulife-devops-shared-config',
      version: 'install-yu-ci-tools-2',
      templatePath: 'templates/install-yu-ci-tools/template.yml',
    });
    assert.strictEqual(
      url,
      'https://gitlab.com/yu-life/infrastructure/yulife-devops-shared-config/-/tree/install-yu-ci-tools-2/templates/install-yu-ci-tools',
    );
  });

  test('absent version defaults to `main`', () => {
    const url = templateFileUrlForResolved({
      gitlabInstance: 'gitlab.example.com',
      projectPath: 'group/project',
      version: undefined,
      templatePath: 'templates/my-component.yml',
    });
    assert.strictEqual(url, 'https://gitlab.example.com/group/project/-/blob/main/templates/my-component.yml');
  });

  test('non-default templateRoots use the directory form when applicable', () => {
    const url = templateFileUrlForResolved({
      gitlabInstance: 'gitlab.example.com',
      projectPath: 'team/repo',
      version: 'v1',
      templatePath: 'ci-templates/foo/template.yaml',
    });
    assert.strictEqual(url, 'https://gitlab.example.com/team/repo/-/tree/v1/ci-templates/foo');
  });

  test('refs containing `/` are URL-encoded', () => {
    const url = templateFileUrlForResolved({
      gitlabInstance: 'gitlab.internal.example.com',
      projectPath: 'team/repo',
      version: 'feature/branch-name',
      templatePath: 'templates/comp.yml',
    });
    assert.strictEqual(
      url,
      'https://gitlab.internal.example.com/team/repo/-/blob/feature%2Fbranch-name/templates/comp.yml',
    );
  });

  test('explicit version "main" is treated as the default (not encoded)', () => {
    const url = templateFileUrlForResolved({
      gitlabInstance: 'gitlab.com',
      projectPath: 'group/project',
      version: 'main',
      templatePath: 'templates/comp.yml',
    });
    assert.strictEqual(url, 'https://gitlab.com/group/project/-/blob/main/templates/comp.yml');
  });
});
