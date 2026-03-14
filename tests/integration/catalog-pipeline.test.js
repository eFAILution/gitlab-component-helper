/**
 * Comprehensive E2E tests for the component catalog pipeline
 *
 * These tests exercise the complete data flow through the catalog fetching
 * pipeline using realistic GitLab API response fixtures and a mock HTTP
 * client. No real network calls or VS Code environment are required.
 *
 * Pipeline under test (mirrors componentService.ts fetchCatalogData):
 *   1. Fetch project info       GET /api/v4/projects/:path
 *   2. fetchAllTemplateFiles    GET /api/v4/projects/:id/repository/tree?path=templates
 *                               GET /api/v4/projects/:id/repository/tree?path=templates/:subdir
 *   3. For each YAML file       GET /api/v4/projects/:id/repository/files/.../raw
 *   4. Parse spec inputs from template content
 *   5. Return components list
 */

/* eslint-env node */

console.log('🧪 Comprehensive E2E: Component Catalog Pipeline');
console.log('='.repeat(55));

// ---------------------------------------------------------------------------
// Spec inputs regex (matches production code in componentService.ts)
// ---------------------------------------------------------------------------
const SPEC_INPUTS_SECTION_REGEX =
  /spec:\s*\n\s*inputs:([\s\S]*?)(?=\n---|\ndescription:|\nvariables:|\n[a-zA-Z][a-zA-Z0-9_-]*:|$)/;

// ---------------------------------------------------------------------------
// Fixture helpers - GitLab API response shapes
// ---------------------------------------------------------------------------
function makeTreeItem(name, type, pathPrefix) {
  const path = `${pathPrefix}/${name}`;
  return { id: `sha-${name}`, name, type, path, mode: type === 'tree' ? '040000' : '100644' };
}

function makeTemplateItem(relativePath) {
  const parts = relativePath.split('/');
  const name = parts[parts.length - 1];
  return makeTreeItem(name, 'blob', 'templates' + (parts.length > 1 ? '/' + parts.slice(0, -1).join('/') : ''));
}

// ---------------------------------------------------------------------------
// Minimal mock HTTP client
// Intercepts fetch calls by URL and returns fixture data
// ---------------------------------------------------------------------------
class MockHttpClient {
  constructor(urlMap) {
    // urlMap: { [urlPattern]: responseData }
    this._urlMap = urlMap;
    this.requests = [];
  }

  async fetchJson(url, _options) {
    this.requests.push({ type: 'json', url });
    const response = this._resolve(url);
    if (response === null) throw Object.assign(new Error(`404: ${url}`), { statusCode: 404 });
    if (response instanceof Error) throw response;
    return response;
  }

  async fetchText(url, _options) {
    this.requests.push({ type: 'text', url });
    const response = this._resolve(url);
    if (response === null) throw Object.assign(new Error(`404: ${url}`), { statusCode: 404 });
    if (response instanceof Error) throw response;
    return typeof response === 'string' ? response : JSON.stringify(response);
  }

  async processBatch(items, processor, _batchSize) {
    const results = [];
    for (const item of items) {
      results.push(await processor(item));
    }
    return results;
  }

  _resolve(url) {
    // Exact match first
    if (url in this._urlMap) return this._urlMap[url];
    // Prefix match (longest first)
    const prefix = Object.keys(this._urlMap)
      .filter(k => url.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    return prefix ? this._urlMap[prefix] : null;
  }
}

// ---------------------------------------------------------------------------
// Pipeline runner (mirrors production fetchCatalogData + fetchAllTemplateFiles
// + fetchTemplateContent logic from componentService.ts)
// ---------------------------------------------------------------------------
async function runCatalogPipeline(httpClient, apiBaseUrl, projectPath, ref = 'main') {
  // Step 1: project info
  const projectInfo = await httpClient.fetchJson(
    `${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}`
  );
  if (projectInfo.default_branch) ref = projectInfo.default_branch;

  // Step 2: fetchAllTemplateFiles
  const treeUrl = `${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}/repository/tree?path=templates&ref=${ref}`;
  const topLevel = await httpClient.fetchJson(treeUrl).catch(() => []);

  const yamlFiles = topLevel.filter(
    item => item.type === 'blob' && (item.name.endsWith('.yml') || item.name.endsWith('.yaml'))
  );
  const subdirs = topLevel.filter(item => item.type === 'tree');

  for (const subdir of subdirs) {
    const subdirUrl = `${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}/repository/tree?path=${encodeURIComponent('templates/' + subdir.name)}&ref=${ref}`;
    const subdirContents = await httpClient.fetchJson(subdirUrl).catch(() => []);
    subdirContents
      .filter(item => item.type === 'blob' && (item.name.endsWith('.yml') || item.name.endsWith('.yaml')))
      .forEach(item => yamlFiles.push(item));
  }

  // Step 3 & 4: for each yaml file, fetch content and parse spec
  const components = await httpClient.processBatch(
    yamlFiles,
    async (file) => {
      const relativePath = file.path.replace(/^templates\//, '');
      const name = relativePath.replace(/\.ya?ml$/, '');

      let description = '';
      let variables = [];

      try {
        const contentUrl = `${apiBaseUrl}/projects/${projectInfo.id}/repository/files/${encodeURIComponent('templates/' + relativePath)}/raw?ref=${ref}`;
        const content = await httpClient.fetchText(contentUrl);

        // Extract description from leading comment
        const parts = content.split(/^---\s*$/m);
        const specSection = parts[0] || '';

        const commentMatch = specSection.match(/^#\s*(.+?)$/m);
        if (commentMatch && !commentMatch[1].toLowerCase().includes('gitlab')) {
          description = commentMatch[1].trim();
        }

        // Extract spec inputs
        const specMatch = specSection.match(SPEC_INPUTS_SECTION_REGEX);
        if (specMatch) {
          const inputLines = specMatch[1].split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
          let currentInput = null;
          for (const line of inputLines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (line.match(/^[a-zA-Z][a-zA-Z0-9_-]*:/)) break;
            if (line.match(/^\s{4}[a-zA-Z_][a-zA-Z0-9_]*:/) || line.match(/^\s{2}[a-zA-Z_][a-zA-Z0-9_]*:/)) {
              if (currentInput) variables.push(currentInput);
              const inputName = trimmed.split(':')[0];
              currentInput = { name: inputName, description: `Parameter: ${inputName}`, required: false, type: 'string', default: undefined };
            } else if (currentInput && line.match(/^\s{6,}/)) {
              if (trimmed.startsWith('description:')) currentInput.description = trimmed.substring(12).replace(/['"]/g, '').trim();
              else if (trimmed.startsWith('default:')) currentInput.default = trimmed.substring(8).replace(/['"]/g, '').trim();
              else if (trimmed.startsWith('type:')) currentInput.type = trimmed.substring(5).replace(/['"]/g, '').trim();
            }
          }
          if (currentInput) variables.push(currentInput);
        }
      } catch {
        // template content fetch failed - graceful fallback
      }

      if (!description) description = `${name} component`;

      return { name, description, variables, latest_version: ref };
    },
    5
  );

  return { components };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
async function runTests() {
  const API = 'https://gitlab.example.com/api/v4';
  const PROJECT = 'group/my-components';
  const PROJECT_ID = 42;

  const PROJECT_INFO = { id: PROJECT_ID, name: 'my-components', default_branch: 'main' };

  // ----- Fixtures: template YAML content -----
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

  const TEMPLATE_SECURITY_LINT = `# Security lint component
spec:
  inputs:
    ruleset:
      description: "Ruleset to use"
      default: "default"
      type: "string"
---
security-lint:
  stage: test
  script:
    - echo "Security linting"`;

  const TEMPLATE_NO_SPEC = `# Simple deployment
deploy:
  stage: deploy
  script:
    - echo "Deploying"`;

  const testCases = [
    // -----------------------------------------------------------------------
    {
      name: 'Flat template layout (templates/*.yaml) - backwards compatibility',
      urlMap: {
        [`${API}/projects/${encodeURIComponent(PROJECT)}`]: PROJECT_INFO,
        [`${API}/projects/${encodeURIComponent(PROJECT)}/repository/tree?path=templates&ref=main`]: [
          makeTemplateItem('deploy.yml'),
          makeTemplateItem('lint.yaml')
        ],
        [`${API}/projects/${PROJECT_ID}/repository/files/${encodeURIComponent('templates/deploy.yml')}/raw?ref=main`]: TEMPLATE_DEPLOY,
        [`${API}/projects/${PROJECT_ID}/repository/files/${encodeURIComponent('templates/lint.yaml')}/raw?ref=main`]: TEMPLATE_LINT
      },
      checks: (result) => {
        const names = result.components.map(c => c.name).sort();
        assertEqual(names, ['deploy', 'lint'], 'component names');
        const deploy = result.components.find(c => c.name === 'deploy');
        assertEqual(deploy.variables.length, 2, 'deploy variable count');
        assertEqual(deploy.variables[0].name, 'environment', 'deploy first variable name');
        assertEqual(deploy.variables[1].name, 'dry_run', 'deploy second variable name');
        assertEqual(deploy.description, 'Deploy component', 'deploy description from comment');
      }
    },

    // -----------------------------------------------------------------------
    {
      name: 'Subdirectory template layout (templates/<subdir>/*.yaml)',
      urlMap: {
        [`${API}/projects/${encodeURIComponent(PROJECT)}`]: PROJECT_INFO,
        [`${API}/projects/${encodeURIComponent(PROJECT)}/repository/tree?path=templates&ref=main`]: [
          makeTreeItem('security', 'tree', 'templates')
        ],
        [`${API}/projects/${encodeURIComponent(PROJECT)}/repository/tree?path=${encodeURIComponent('templates/security')}&ref=main`]: [
          makeTemplateItem('security/scan.yml'),
          makeTemplateItem('security/lint.yaml')
        ],
        [`${API}/projects/${PROJECT_ID}/repository/files/${encodeURIComponent('templates/security/scan.yml')}/raw?ref=main`]: TEMPLATE_SECURITY_SCAN,
        [`${API}/projects/${PROJECT_ID}/repository/files/${encodeURIComponent('templates/security/lint.yaml')}/raw?ref=main`]: TEMPLATE_SECURITY_LINT
      },
      checks: (result) => {
        const names = result.components.map(c => c.name).sort();
        assertEqual(names, ['security/lint', 'security/scan'], 'component names with subdir prefix');
        const scan = result.components.find(c => c.name === 'security/scan');
        assertEqual(scan.variables.length, 1, 'security/scan variable count');
        assertEqual(scan.variables[0].name, 'severity', 'security/scan variable name');
        assertEqual(scan.description, 'Security scanner component', 'security/scan description');
      }
    },

    // -----------------------------------------------------------------------
    {
      name: 'Mixed layout (flat + subdirectory templates)',
      urlMap: {
        [`${API}/projects/${encodeURIComponent(PROJECT)}`]: PROJECT_INFO,
        [`${API}/projects/${encodeURIComponent(PROJECT)}/repository/tree?path=templates&ref=main`]: [
          makeTemplateItem('deploy.yml'),
          makeTreeItem('security', 'tree', 'templates'),
          makeTreeItem('test', 'tree', 'templates')
        ],
        [`${API}/projects/${encodeURIComponent(PROJECT)}/repository/tree?path=${encodeURIComponent('templates/security')}&ref=main`]: [
          makeTemplateItem('security/scan.yml')
        ],
        [`${API}/projects/${encodeURIComponent(PROJECT)}/repository/tree?path=${encodeURIComponent('templates/test')}&ref=main`]: [
          makeTemplateItem('test/lint.yaml')
        ],
        [`${API}/projects/${PROJECT_ID}/repository/files/${encodeURIComponent('templates/deploy.yml')}/raw?ref=main`]: TEMPLATE_DEPLOY,
        [`${API}/projects/${PROJECT_ID}/repository/files/${encodeURIComponent('templates/security/scan.yml')}/raw?ref=main`]: TEMPLATE_SECURITY_SCAN,
        [`${API}/projects/${PROJECT_ID}/repository/files/${encodeURIComponent('templates/test/lint.yaml')}/raw?ref=main`]: TEMPLATE_LINT
      },
      checks: (result) => {
        const names = result.components.map(c => c.name).sort();
        assertEqual(names, ['deploy', 'security/scan', 'test/lint'], 'mixed layout component names');
        assertEqual(result.components.length, 3, 'total component count');
      }
    },

    // -----------------------------------------------------------------------
    {
      name: 'Non-YAML files and nested directories are ignored',
      urlMap: {
        [`${API}/projects/${encodeURIComponent(PROJECT)}`]: PROJECT_INFO,
        [`${API}/projects/${encodeURIComponent(PROJECT)}/repository/tree?path=templates&ref=main`]: [
          makeTemplateItem('deploy.yml'),
          makeTreeItem('README.md', 'blob', 'templates'),   // non-YAML blob at root
          makeTreeItem('docs', 'tree', 'templates')          // subdir
        ],
        [`${API}/projects/${encodeURIComponent(PROJECT)}/repository/tree?path=${encodeURIComponent('templates/docs')}&ref=main`]: [
          makeTreeItem('guide.md', 'blob', 'templates/docs'),  // non-YAML in subdir
          makeTreeItem('component.yml', 'blob', 'templates/docs'),
          makeTreeItem('deeper', 'tree', 'templates/docs')      // deeper nesting - should be ignored
        ],
        [`${API}/projects/${PROJECT_ID}/repository/files/${encodeURIComponent('templates/deploy.yml')}/raw?ref=main`]: TEMPLATE_DEPLOY,
        [`${API}/projects/${PROJECT_ID}/repository/files/${encodeURIComponent('templates/docs/component.yml')}/raw?ref=main`]: TEMPLATE_LINT
      },
      checks: (result) => {
        const names = result.components.map(c => c.name).sort();
        // README.md and guide.md are filtered out; 'deeper' tree is not traversed
        assertEqual(names, ['deploy', 'docs/component'], 'only yaml blobs are included');
        assertEqual(result.components.length, 2, 'total component count ignoring non-yaml and deeper dirs');
      }
    },

    // -----------------------------------------------------------------------
    {
      name: 'Empty templates directory returns empty components list',
      urlMap: {
        [`${API}/projects/${encodeURIComponent(PROJECT)}`]: PROJECT_INFO,
        [`${API}/projects/${encodeURIComponent(PROJECT)}/repository/tree?path=templates&ref=main`]: []
      },
      checks: (result) => {
        assertEqual(result.components.length, 0, 'empty components list');
      }
    },

    // -----------------------------------------------------------------------
    {
      name: 'Template without spec inputs falls back to name-based description',
      urlMap: {
        [`${API}/projects/${encodeURIComponent(PROJECT)}`]: PROJECT_INFO,
        [`${API}/projects/${encodeURIComponent(PROJECT)}/repository/tree?path=templates&ref=main`]: [
          makeTemplateItem('simple-deploy.yml')
        ],
        [`${API}/projects/${PROJECT_ID}/repository/files/${encodeURIComponent('templates/simple-deploy.yml')}/raw?ref=main`]: TEMPLATE_NO_SPEC
      },
      checks: (result) => {
        assertEqual(result.components.length, 1, 'one component');
        const comp = result.components[0];
        assertEqual(comp.name, 'simple-deploy', 'component name');
        assertEqual(comp.variables.length, 0, 'no variables extracted');
        // Description falls back to leading comment
        assertEqual(comp.description, 'Simple deployment', 'description from leading comment');
      }
    },

    // -----------------------------------------------------------------------
    {
      name: 'Template content fetch failure falls back gracefully',
      urlMap: {
        [`${API}/projects/${encodeURIComponent(PROJECT)}`]: PROJECT_INFO,
        [`${API}/projects/${encodeURIComponent(PROJECT)}/repository/tree?path=templates&ref=main`]: [
          makeTemplateItem('deploy.yml')
        ]
        // No entry for the file content URL → 404 will be thrown
      },
      checks: (result) => {
        assertEqual(result.components.length, 1, 'component still present despite content fetch failure');
        const comp = result.components[0];
        assertEqual(comp.name, 'deploy', 'component name');
        assertEqual(comp.variables.length, 0, 'no variables when content unavailable');
        assertEqual(comp.description, 'deploy component', 'fallback description when content unavailable');
      }
    },

    // -----------------------------------------------------------------------
    {
      name: 'Uses project default_branch as ref for template fetching',
      urlMap: {
        [`${API}/projects/${encodeURIComponent(PROJECT)}`]: { ...PROJECT_INFO, default_branch: 'release/2.0' },
        [`${API}/projects/${encodeURIComponent(PROJECT)}/repository/tree?path=templates&ref=release/2.0`]: [
          makeTemplateItem('deploy.yml')
        ],
        [`${API}/projects/${PROJECT_ID}/repository/files/${encodeURIComponent('templates/deploy.yml')}/raw?ref=release/2.0`]: TEMPLATE_DEPLOY
      },
      checks: (result) => {
        assertEqual(result.components.length, 1, 'component found using default_branch ref');
        assertEqual(result.components[0].latest_version, 'release/2.0', 'latest_version set to default_branch');
      }
    },

    // -----------------------------------------------------------------------
    {
      name: 'Component with multiple spec inputs - all variables extracted',
      urlMap: {
        [`${API}/projects/${encodeURIComponent(PROJECT)}`]: PROJECT_INFO,
        [`${API}/projects/${encodeURIComponent(PROJECT)}/repository/tree?path=templates&ref=main`]: [
          makeTemplateItem('deploy.yml')
        ],
        [`${API}/projects/${PROJECT_ID}/repository/files/${encodeURIComponent('templates/deploy.yml')}/raw?ref=main`]: TEMPLATE_DEPLOY
      },
      checks: (result) => {
        const deploy = result.components[0];
        assertEqual(deploy.variables.length, 2, 'two inputs extracted');
        const env = deploy.variables.find(v => v.name === 'environment');
        assertExists(env, 'environment input exists');
        assertEqual(env.type, 'string', 'environment type');
        assertEqual(env.default, 'staging', 'environment default');
        const dryRun = deploy.variables.find(v => v.name === 'dry_run');
        assertExists(dryRun, 'dry_run input exists');
        assertEqual(dryRun.type, 'boolean', 'dry_run type');
      }
    },

    // -----------------------------------------------------------------------
    {
      name: 'Multiple subdirectories - each fetched independently',
      urlMap: {
        [`${API}/projects/${encodeURIComponent(PROJECT)}`]: PROJECT_INFO,
        [`${API}/projects/${encodeURIComponent(PROJECT)}/repository/tree?path=templates&ref=main`]: [
          makeTreeItem('deploy', 'tree', 'templates'),
          makeTreeItem('test', 'tree', 'templates'),
          makeTreeItem('security', 'tree', 'templates')
        ],
        [`${API}/projects/${encodeURIComponent(PROJECT)}/repository/tree?path=${encodeURIComponent('templates/deploy')}&ref=main`]: [
          makeTemplateItem('deploy/production.yml'),
          makeTemplateItem('deploy/staging.yml')
        ],
        [`${API}/projects/${encodeURIComponent(PROJECT)}/repository/tree?path=${encodeURIComponent('templates/test')}&ref=main`]: [
          makeTemplateItem('test/unit.yaml')
        ],
        [`${API}/projects/${encodeURIComponent(PROJECT)}/repository/tree?path=${encodeURIComponent('templates/security')}&ref=main`]: [
          makeTemplateItem('security/scan.yml')
        ],
        [`${API}/projects/${PROJECT_ID}/repository/files/${encodeURIComponent('templates/deploy/production.yml')}/raw?ref=main`]: TEMPLATE_DEPLOY,
        [`${API}/projects/${PROJECT_ID}/repository/files/${encodeURIComponent('templates/deploy/staging.yml')}/raw?ref=main`]: TEMPLATE_DEPLOY,
        [`${API}/projects/${PROJECT_ID}/repository/files/${encodeURIComponent('templates/test/unit.yaml')}/raw?ref=main`]: TEMPLATE_LINT,
        [`${API}/projects/${PROJECT_ID}/repository/files/${encodeURIComponent('templates/security/scan.yml')}/raw?ref=main`]: TEMPLATE_SECURITY_SCAN
      },
      checks: (result) => {
        const names = result.components.map(c => c.name).sort();
        assertEqual(names, ['deploy/production', 'deploy/staging', 'security/scan', 'test/unit'], 'all subdirectory components detected');
        assertEqual(result.components.length, 4, 'total component count');
      }
    }
  ];

  // ---------------------------------------------------------------------------
  // Assertion helpers
  // ---------------------------------------------------------------------------
  function assertEqual(actual, expected, label) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
  }

  function assertExists(val, label) {
    if (val === undefined || val === null) throw new Error(`${label}: expected value to exist, got ${val}`);
  }

  // ---------------------------------------------------------------------------
  // Run each test case
  // ---------------------------------------------------------------------------
  let passed = 0;
  let failed = 0;

  for (const [index, tc] of testCases.entries()) {
    console.log(`\nTest ${index + 1}: ${tc.name}`);
    console.log('-'.repeat(45));
    try {
      const mockHttp = new MockHttpClient(tc.urlMap);
      const result = await runCatalogPipeline(mockHttp, API, PROJECT);
      tc.checks(result);
      console.log(`✅ PASS`);
      passed++;
    } catch (err) {
      console.log(`❌ FAIL: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${'='.repeat(55)}`);
  console.log('📊 E2E Catalog Pipeline Test Summary');
  console.log(`Total: ${testCases.length} | Passed: ${passed} ✅ | Failed: ${failed} ${failed > 0 ? '❌' : ''}`);
  console.log(`Success rate: ${Math.round((passed / testCases.length) * 100)}%`);

  return failed === 0;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
runTests()
  .then(ok => {
    if (ok) {
      console.log('\n🎉 All e2e catalog pipeline tests passed!');
      process.exit(0);
    } else {
      console.log('\n💥 Some e2e catalog pipeline tests failed!');
      process.exit(1);
    }
  })
  .catch(err => {
    console.error('💥 Test runner error:', err.message);
    process.exit(1);
  });
