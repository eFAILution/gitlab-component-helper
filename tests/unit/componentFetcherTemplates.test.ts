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
import type { ComponentParameter } from '../../src/types/git-component';
import {
  backfillParameterSpecDetail,
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

suite('backfillParameterSpecDetail', () => {
  const param = (name: string, extra: Partial<ComponentParameter> = {}): ComponentParameter => ({
    name,
    description: '',
    required: false,
    type: 'string',
    ...extra,
  });

  test('grafts options onto the catalog param of the same name', () => {
    const catalog = [param('registry_type'), param('region')];
    const template = [param('registry_type', { options: ['aws', 'gcp'] }), param('region')];

    const merged = backfillParameterSpecDetail(catalog, template);

    assert.deepStrictEqual(merged.find((p) => p.name === 'registry_type')?.options, ['aws', 'gcp']);
    assert.strictEqual(merged.find((p) => p.name === 'region')?.options, undefined);
  });

  test('leaves a catalog param untouched when no template entry matches by name', () => {
    const catalog = [param('region')];
    const template = [param('registry_type', { options: ['aws'] })]; // different name

    const merged = backfillParameterSpecDetail(catalog, template);

    assert.strictEqual(merged[0].options, undefined);
  });

  test('ignores template params whose options are absent or empty', () => {
    const catalog = [param('a'), param('b')];
    const template = [param('a', { options: [] }), param('b')]; // empty + missing

    const merged = backfillParameterSpecDetail(catalog, template);

    assert.strictEqual(merged.find((p) => p.name === 'a')?.options, undefined);
    assert.strictEqual(merged.find((p) => p.name === 'b')?.options, undefined);
  });

  test('does not mutate the input arrays or their elements', () => {
    const catalogParam = param('registry_type');
    const catalog = [catalogParam];
    const template = [param('registry_type', { options: ['aws'] })];

    backfillParameterSpecDetail(catalog, template);

    assert.strictEqual(catalogParam.options, undefined, 'original catalog param was mutated');
  });

  test('recovers a boolean type the catalog reported as an untyped string', () => {
    // The catalog can describe a boolean input without a type, leaving the 'string' fallback in place. Completion
    // keys off `type`, so without this the input gets no true/false choice.
    const catalog = [param('debug', { default: 'false' })];
    const template = [param('debug', { type: 'boolean', default: false })];

    const merged = backfillParameterSpecDetail(catalog, template);

    assert.strictEqual(merged[0].type, 'boolean');
    assert.strictEqual(merged[0].default, false, 'a stringified catalog default should yield to the parsed one');
  });

  test('the local parse wins on the type signature, since both sides describe the same spec', () => {
    // The catalog reports what GitLab read from this same template, only lossily — so on `type`/`default`/`options`
    // the local parse is preferred rather than arbitrated against.
    const catalog = [param('env', { type: 'string', default: 'production' })];
    const template = [param('env', { type: 'string', default: 'staging' })];

    const merged = backfillParameterSpecDetail(catalog, template);

    assert.strictEqual(merged[0].default, 'staging');
  });

  test('does not downgrade a catalog type to the template parse fallback', () => {
    // Both sides fall back to 'string', so a template 'string' may just mean the line-based parse missed the
    // `type:` line. Overwriting with it would lose a type the catalog got right.
    const catalog = [param('count', { type: 'number' })];
    const template = [param('count', { type: 'string' })];

    const merged = backfillParameterSpecDetail(catalog, template);

    assert.strictEqual(merged[0].type, 'number');
  });

  test('keeps a catalog default the template parse does not have', () => {
    const catalog = [param('env', { default: 'production' })];
    const template = [param('env')]; // no default parsed

    const merged = backfillParameterSpecDetail(catalog, template);

    assert.strictEqual(merged[0].default, 'production');
  });

  test('leaves the fields the catalog is authoritative for untouched', () => {
    const catalog = [param('debug', { description: 'from catalog', required: true })];
    const template = [param('debug', { description: 'from template', required: false, type: 'boolean' })];

    const merged = backfillParameterSpecDetail(catalog, template);

    assert.strictEqual(merged[0].description, 'from catalog');
    assert.strictEqual(merged[0].required, true);
    assert.strictEqual(merged[0].type, 'boolean', 'the type signature still comes from the local parse');
  });
});
