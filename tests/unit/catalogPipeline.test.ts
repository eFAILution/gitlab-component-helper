// @mocha
/**
 * Tests the catalog-fetch pipeline against the real production helpers in
 * src/services/component/componentFetcherTemplates.ts — `fetchAllTemplateFiles` (the templates/ tree-walk plus one
 * subdirectory level) and `buildCatalogComponents` (per-file fetch, spec-parse, and the skip/fallback rules).
 *
 * These are the vscode-free pieces `ComponentFetcher.fetchCatalogData` delegates to, so a duck-typed
 * `CatalogHttpClient` mock exercises the same code production runs. The leaf helpers (`deriveComponentName`,
 * `filterYamlBlobs`, `GitLabSpecParser.parse`) are covered directly elsewhere; this suite covers the wiring:
 * which files become components, which are dropped, and how the ref flows through.
 */

import * as assert from 'node:assert/strict';
import type { GitLabTreeItem } from '../../src/types/api';
import {
  buildCatalogComponents,
  fetchAllTemplateFiles,
  type CatalogHttpClient,
} from '../../src/services/component/componentFetcherTemplates';

// ---------------------------------------------------------------------------
// Fixture helpers — GitLab repository-tree entry shapes
// ---------------------------------------------------------------------------
function makeTreeItem(name: string, type: 'tree' | 'blob', pathPrefix: string): GitLabTreeItem {
  const path = `${pathPrefix}/${name}`;
  return { id: `sha-${name}`, name, type, path, mode: type === 'tree' ? '040000' : '100644' };
}

function makeTemplateItem(relativePath: string): GitLabTreeItem {
  const parts = relativePath.split('/');
  const name = parts[parts.length - 1];
  const prefix = 'templates' + (parts.length > 1 ? '/' + parts.slice(0, -1).join('/') : '');
  return makeTreeItem(name, 'blob', prefix);
}

// ---------------------------------------------------------------------------
// Minimal CatalogHttpClient mock — resolves requests against a URL map
// (exact match first, then longest matching prefix). A `null` value 404s.
// ---------------------------------------------------------------------------
class MockHttpClient implements CatalogHttpClient {
  readonly requests: Array<{ type: 'json' | 'text'; url: string }> = [];

  constructor(private readonly urlMap: Record<string, unknown>) {}

  async fetchJson<T = unknown>(url: string): Promise<T> {
    this.requests.push({ type: 'json', url });
    return this.resolve(url) as T;
  }

  async fetchText(url: string): Promise<string> {
    this.requests.push({ type: 'text', url });
    const response = this.resolve(url);
    return typeof response === 'string' ? response : JSON.stringify(response);
  }

  async processBatch<T, R>(items: T[], processor: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = [];
    for (const item of items) {
      results.push(await processor(item));
    }
    return results;
  }

  private resolve(url: string): unknown {
    if (url in this.urlMap) {
      const value = this.urlMap[url];
      if (value === null) throw Object.assign(new Error(`404: ${url}`), { statusCode: 404 });
      return value;
    }
    const prefix = Object.keys(this.urlMap)
      .filter((k) => url.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (prefix === undefined) throw Object.assign(new Error(`404: ${url}`), { statusCode: 404 });
    const value = this.urlMap[prefix];
    if (value === null) throw Object.assign(new Error(`404: ${url}`), { statusCode: 404 });
    return value;
  }
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const API = 'https://gitlab.example.com/api/v4';
const PROJECT = 'group/my-components';
const PROJECT_ID = 42;
const REF = 'main';

const TEMPLATE_DEPLOY = `# Deploy component
spec:
  inputs:
    environment:
      description: "Target environment"
      default: "staging"
      type: "string"
    dry_run:
      description: "Run without making changes"
      default: false
      type: "boolean"
---
deploy-job:
  stage: deploy
  script:
    - echo "Deploying to $[[ inputs.environment ]]"`;

const TEMPLATE_LINT = `# Lint component
spec:
  inputs:
    fail_fast:
      description: "Stop on first error"
      default: true
      type: "boolean"
---
lint-job:
  stage: test
  script:
    - echo "Linting code"`;

const TEMPLATE_SECURITY_SCAN = `# Security scanner component
spec:
  inputs:
    severity:
      description: "Minimum severity to report"
      default: "medium"
      type: "string"
---
security-scan:
  stage: test
  script:
    - echo "Scanning for vulnerabilities"`;

// No spec: section — production treats this as a non-component and drops it.
const TEMPLATE_NO_SPEC = `# Simple deployment
deploy:
  stage: deploy
  script:
    - echo "Deploying"`;

// URLs the pipeline issues, parameterised by ref.
function treeUrl(path: string, ref = REF): string {
  return `${API}/projects/${encodeURIComponent(PROJECT)}/repository/tree?path=${encodeURIComponent(path)}&ref=${ref}`;
}
function rawUrl(templatePath: string, ref = REF): string {
  return `${API}/projects/${PROJECT_ID}/repository/files/${encodeURIComponent(templatePath)}/raw?ref=${ref}`;
}

/**
 * Run the full pipeline (tree-walk → build components) the way `fetchCatalogData` does, at the default ref.
 */
async function runPipeline(http: MockHttpClient, ref = REF) {
  const yamlFiles = await fetchAllTemplateFiles(http, API, PROJECT, ref);
  return buildCatalogComponents(http, API, PROJECT_ID, yamlFiles, ref, 5);
}

// ---------------------------------------------------------------------------
suite('catalog pipeline — flat template layout', () => {
  test('templates/*.yml and *.yaml become components (single-file form)', async () => {
    const http = new MockHttpClient({
      [treeUrl('templates')]: [makeTemplateItem('deploy.yml'), makeTemplateItem('lint.yaml')],
      [rawUrl('templates/deploy.yml')]: TEMPLATE_DEPLOY,
      [rawUrl('templates/lint.yaml')]: TEMPLATE_LINT,
    });

    const components = await runPipeline(http);

    assert.deepStrictEqual(
      components.map((c) => c.name).sort(),
      ['deploy', 'lint'],
    );
    const deploy = components.find((c) => c.name === 'deploy');
    assert.ok(deploy, 'deploy component missing');
    assert.strictEqual(deploy.variables.length, 2);
    assert.deepStrictEqual(
      deploy.variables.map((v) => v.name),
      ['environment', 'dry_run'],
    );
    assert.strictEqual(deploy.description, 'Deploy component');
    assert.strictEqual(deploy.templatePath, 'templates/deploy.yml');
  });
});

suite('catalog pipeline — subdirectory layout (canonical template.yml)', () => {
  test('templates/<dir>/template.yml becomes component <dir>', async () => {
    const http = new MockHttpClient({
      [treeUrl('templates')]: [makeTreeItem('security', 'tree', 'templates')],
      [treeUrl('templates/security')]: [makeTemplateItem('security/template.yml')],
      [rawUrl('templates/security/template.yml')]: TEMPLATE_SECURITY_SCAN,
    });

    const components = await runPipeline(http);

    assert.deepStrictEqual(
      components.map((c) => c.name),
      ['security'],
    );
    const security = components[0];
    assert.strictEqual(security.variables.length, 1);
    assert.strictEqual(security.variables[0].name, 'severity');
    assert.strictEqual(security.description, 'Security scanner component');
  });

  test('non-canonical files in a subdirectory are not components', async () => {
    // scan.yml / lint.yaml under templates/security/ aren't template.yml → deriveComponentName returns null → dropped.
    const http = new MockHttpClient({
      [treeUrl('templates')]: [makeTreeItem('security', 'tree', 'templates')],
      [treeUrl('templates/security')]: [
        makeTemplateItem('security/scan.yml'),
        makeTemplateItem('security/lint.yaml'),
      ],
      [rawUrl('templates/security/scan.yml')]: TEMPLATE_SECURITY_SCAN,
      [rawUrl('templates/security/lint.yaml')]: TEMPLATE_LINT,
    });

    const components = await runPipeline(http);

    assert.deepStrictEqual(components, []);
  });
});

suite('catalog pipeline — mixed layout', () => {
  test('flat single-file + subdirectory template.yml components coexist', async () => {
    const http = new MockHttpClient({
      [treeUrl('templates')]: [
        makeTemplateItem('deploy.yml'),
        makeTreeItem('security', 'tree', 'templates'),
        makeTreeItem('test', 'tree', 'templates'),
      ],
      [treeUrl('templates/security')]: [makeTemplateItem('security/template.yml')],
      [treeUrl('templates/test')]: [makeTemplateItem('test/template.yaml')],
      [rawUrl('templates/deploy.yml')]: TEMPLATE_DEPLOY,
      [rawUrl('templates/security/template.yml')]: TEMPLATE_SECURITY_SCAN,
      [rawUrl('templates/test/template.yaml')]: TEMPLATE_LINT,
    });

    const components = await runPipeline(http);

    assert.deepStrictEqual(
      components.map((c) => c.name).sort(),
      ['deploy', 'security', 'test'],
    );
  });
});

suite('catalog pipeline — filtering', () => {
  test('non-YAML files and deeper-than-one-level directories are ignored', async () => {
    const http = new MockHttpClient({
      [treeUrl('templates')]: [
        makeTemplateItem('deploy.yml'),
        makeTreeItem('README.md', 'blob', 'templates'), // non-YAML blob at root
        makeTreeItem('docs', 'tree', 'templates'),
      ],
      [treeUrl('templates/docs')]: [
        makeTreeItem('guide.md', 'blob', 'templates/docs'), // non-YAML in subdir
        makeTemplateItem('docs/template.yml'),
        makeTreeItem('deeper', 'tree', 'templates/docs'), // deeper nesting — not traversed
      ],
      [rawUrl('templates/deploy.yml')]: TEMPLATE_DEPLOY,
      [rawUrl('templates/docs/template.yml')]: TEMPLATE_LINT,
    });

    const components = await runPipeline(http);

    // README.md and guide.md are filtered by filterYamlBlobs; the `deeper` tree is never fetched.
    assert.deepStrictEqual(
      components.map((c) => c.name).sort(),
      ['deploy', 'docs'],
    );
  });

  test('empty templates directory yields no components', async () => {
    const http = new MockHttpClient({ [treeUrl('templates')]: [] });
    assert.deepStrictEqual(await runPipeline(http), []);
  });
});

suite('catalog pipeline — templates dropped by production rules', () => {
  test('a template without a spec: section is not a component', async () => {
    const http = new MockHttpClient({
      [treeUrl('templates')]: [makeTemplateItem('simple-deploy.yml')],
      [rawUrl('templates/simple-deploy.yml')]: TEMPLATE_NO_SPEC,
    });

    // isValidComponent is false → dropped, even though the path is a valid single-file layout.
    assert.deepStrictEqual(await runPipeline(http), []);
  });

  test('a template whose content cannot be fetched is dropped', async () => {
    const http = new MockHttpClient({
      [treeUrl('templates')]: [makeTemplateItem('deploy.yml')],
      // No raw-content entry → fetchText 404s → the file is dropped.
    });

    assert.deepStrictEqual(await runPipeline(http), []);
  });
});

suite('catalog pipeline — ref handling', () => {
  test('the supplied ref flows into tree/raw URLs and latest_version', async () => {
    const ref = 'release/2.0';
    const http = new MockHttpClient({
      [treeUrl('templates', ref)]: [makeTemplateItem('deploy.yml')],
      [rawUrl('templates/deploy.yml', ref)]: TEMPLATE_DEPLOY,
    });

    const components = await runPipeline(http, ref);

    assert.strictEqual(components.length, 1);
    assert.strictEqual(components[0].latest_version, ref);
  });
});

suite('catalog pipeline — multiple subdirectories', () => {
  test('each subdirectory is scanned independently for its template.yml', async () => {
    const http = new MockHttpClient({
      [treeUrl('templates')]: [
        makeTreeItem('deploy', 'tree', 'templates'),
        makeTreeItem('test', 'tree', 'templates'),
        makeTreeItem('security', 'tree', 'templates'),
      ],
      [treeUrl('templates/deploy')]: [makeTemplateItem('deploy/template.yml')],
      [treeUrl('templates/test')]: [makeTemplateItem('test/template.yaml')],
      [treeUrl('templates/security')]: [makeTemplateItem('security/template.yml')],
      [rawUrl('templates/deploy/template.yml')]: TEMPLATE_DEPLOY,
      [rawUrl('templates/test/template.yaml')]: TEMPLATE_LINT,
      [rawUrl('templates/security/template.yml')]: TEMPLATE_SECURITY_SCAN,
    });

    const components = await runPipeline(http);

    assert.deepStrictEqual(
      components.map((c) => c.name).sort(),
      ['deploy', 'security', 'test'],
    );
  });
});
