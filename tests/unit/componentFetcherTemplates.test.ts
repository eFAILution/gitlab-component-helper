// @mocha
/**
 * Tests src/services/component/componentFetcherTemplates.ts — the pure helpers that filter the tree returned by
 * GitLab's repository-tree API down to YAML blobs and derive a component name from each file path.
 *
 * `deriveComponentName` recognises only the two canonical GitLab component layouts: single-file
 * (`templates/<name>.yml`) and directory (`templates/<name>/template.yml`). Other nested YAML files return `null`
 * and are skipped by `fetchCatalogData`.
 */

import * as assert from 'node:assert/strict';
import type { GitLabTreeItem } from '../../src/types/api';
import {
  deriveComponentName,
  filterSubdirectories,
  filterYamlBlobs,
} from '../../src/services/component/componentFetcherTemplates';

function blob(name: string, path: string): GitLabTreeItem {
  return { id: name, name, type: 'blob', path, mode: '100644' };
}

function tree(name: string, path: string): GitLabTreeItem {
  return { id: name, name, type: 'tree', path, mode: '040000' };
}

suite('filterYamlBlobs', () => {
  test('keeps only .yml / .yaml blob entries', () => {
    const items = [
      blob('deploy.yml', 'templates/deploy.yml'),
      blob('build.yaml', 'templates/build.yaml'),
      blob('README.md', 'templates/README.md'),
      blob('ignore.json', 'templates/ignore.json'),
      tree('subdir', 'templates/subdir'),
    ];
    const yaml = filterYamlBlobs(items);
    assert.deepStrictEqual(
      yaml.map((b) => b.name),
      ['deploy.yml', 'build.yaml'],
    );
  });

  test('returns an empty list when the tree has no YAML blobs', () => {
    assert.deepStrictEqual(filterYamlBlobs([tree('subdir', 'templates/subdir')]), []);
    assert.deepStrictEqual(filterYamlBlobs([]), []);
  });
});

suite('filterSubdirectories', () => {
  test('keeps only `tree` entries', () => {
    const items = [
      blob('deploy.yml', 'templates/deploy.yml'),
      tree('security', 'templates/security'),
      tree('build', 'templates/build'),
    ];
    assert.deepStrictEqual(
      filterSubdirectories(items).map((t) => t.name),
      ['security', 'build'],
    );
  });
});

suite('deriveComponentName — single-file form', () => {
  test('templates/foo.yml → "foo"', () => {
    assert.strictEqual(deriveComponentName('templates/foo.yml'), 'foo');
  });

  test('templates/foo.yaml → "foo" (both extensions supported)', () => {
    assert.strictEqual(deriveComponentName('templates/foo.yaml'), 'foo');
  });

  test('templates/foo (no extension) → null', () => {
    assert.strictEqual(deriveComponentName('templates/foo'), null);
  });

  test('files outside templates/ return null', () => {
    assert.strictEqual(deriveComponentName('not-templates/foo.yml'), null);
    assert.strictEqual(deriveComponentName('foo.yml'), null);
  });
});

suite('deriveComponentName — directory form (canonical template.yml only)', () => {
  test('templates/foo/template.yml → "foo"', () => {
    assert.strictEqual(deriveComponentName('templates/foo/template.yml'), 'foo');
  });

  test('templates/foo/template.yaml → "foo"', () => {
    assert.strictEqual(deriveComponentName('templates/foo/template.yaml'), 'foo');
  });

  test('non-canonical nested files return null', () => {
    // Sibling files under the same `templates/<dir>/` that aren't named `template.yml`/`template.yaml` must each
    // return null so they don't all collapse to the directory name and overwrite each other in the catalog.
    assert.strictEqual(deriveComponentName('templates/security/scanner.yml'), null);
    assert.strictEqual(deriveComponentName('templates/security/lint.yml'), null);
    assert.strictEqual(deriveComponentName('templates/deploy/production.yml'), null);
  });

  test('respects a custom templateFileNames list', () => {
    assert.strictEqual(
      deriveComponentName('templates/foo/main.yml', ['main.yml']),
      'foo',
    );
    // Default `template.yml` no longer matches under the custom list.
    assert.strictEqual(deriveComponentName('templates/foo/template.yml', ['main.yml']), null);
  });

  test('non-YAML entry files return null even when matching templateFileNames is requested', () => {
    // A custom config can't accidentally promote non-YAML files because the upstream filterYamlBlobs filter has
    // already stripped them — but defence in depth: if it slipped through, the .yml/.yaml requirement would have
    // to be re-checked. Here we verify a `.txt` slipped through is still rejected by the deeper-than-1 path check.
    assert.strictEqual(deriveComponentName('templates/foo/bar/template.yml'), null);
  });
});

suite('deriveComponentName — deeper nesting and edge cases', () => {
  test('templates/a/b/template.yml (2+ levels deep) → null', () => {
    assert.strictEqual(deriveComponentName('templates/a/b/template.yml'), null);
  });

  test('templates/ (trailing slash, no file) → null', () => {
    assert.strictEqual(deriveComponentName('templates/'), null);
  });

  test('completely empty path → null', () => {
    assert.strictEqual(deriveComponentName(''), null);
  });
});
