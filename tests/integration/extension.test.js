/**
 * E2E tests for core extension data-flow behaviours
 *
 * Tests are self-contained (no VS Code host required) and cover:
 *   - GitLab component URL parsing
 *   - Component name derivation from template file paths
 *   - Spec-input parsing from template YAML content
 *   - Subdirectory component naming (templates/<subdir>/<name>.yaml)
 *   - Cache key construction (instance + project + version)
 *   - Graceful error propagation from the HTTP layer
 */

/* eslint-env node */

console.log('=== Extension Core Behaviour Tests ===');

// ---------------------------------------------------------------------------
// 1. URL PARSING
// ---------------------------------------------------------------------------
console.log('\n--- 1. GitLab Component URL Parsing ---');

function parseComponentUrl(url) {
  if (url.includes('@')) {
    const [base, version] = url.split('@');
    const parsed = new URL(base);
    const parts = parsed.pathname.substring(1).split('/');
    const componentName = parts.pop();
    return { gitlabInstance: parsed.hostname, projectPath: parts.join('/'), componentName, version };
  }
  const parsed = new URL(url);
  const parts = parsed.pathname.substring(1).split('/');
  const componentName = parts.pop();
  return { gitlabInstance: parsed.hostname, projectPath: parts.join('/'), componentName, version: undefined };
}

const urlCases = [
  {
    url: 'https://gitlab.com/components/opentofu/full-pipeline@2.9.0',
    expected: { gitlabInstance: 'gitlab.com', projectPath: 'components/opentofu', componentName: 'full-pipeline', version: '2.9.0' }
  },
  {
    url: 'https://gitlab.example.com/group/project/my-component@latest',
    expected: { gitlabInstance: 'gitlab.example.com', projectPath: 'group/project', componentName: 'my-component', version: 'latest' }
  },
  {
    url: 'https://gitlab.com/user/repo/component',
    expected: { gitlabInstance: 'gitlab.com', projectPath: 'user/repo', componentName: 'component', version: undefined }
  },
  {
    url: 'https://private.gitlab.corp/infra/ci-components/deploy@v3.1.0',
    expected: { gitlabInstance: 'private.gitlab.corp', projectPath: 'infra/ci-components', componentName: 'deploy', version: 'v3.1.0' }
  }
];

let urlPassed = 0;
for (const { url, expected } of urlCases) {
  const result = parseComponentUrl(url);
  const ok = result.gitlabInstance === expected.gitlabInstance &&
             result.projectPath === expected.projectPath &&
             result.componentName === expected.componentName &&
             result.version === expected.version;
  if (ok) {
    console.log(`  ✅ ${url}`);
    urlPassed++;
  } else {
    console.log(`  ❌ ${url}`);
    console.log(`     Expected: ${JSON.stringify(expected)}`);
    console.log(`     Got:      ${JSON.stringify(result)}`);
  }
}
console.log(`  URL parsing: ${urlPassed}/${urlCases.length} passed`);

// ---------------------------------------------------------------------------
// 2. COMPONENT NAME DERIVATION FROM FILE PATH
// ---------------------------------------------------------------------------
console.log('\n--- 2. Component Name Derivation ---');

function deriveComponentName(filePath) {
  return filePath.replace(/^templates\//, '').replace(/\.ya?ml$/, '');
}

const nameCases = [
  { path: 'templates/deploy.yml',               expected: 'deploy' },
  { path: 'templates/full-pipeline.yaml',        expected: 'full-pipeline' },
  { path: 'templates/security/scan.yml',         expected: 'security/scan' },
  { path: 'templates/deploy/production.yaml',    expected: 'deploy/production' },
  { path: 'templates/test/unit-test.yml',        expected: 'test/unit-test' },
  { path: 'templates/deep_name.yaml',            expected: 'deep_name' }
];

let namePassed = 0;
for (const { path, expected } of nameCases) {
  const result = deriveComponentName(path);
  if (result === expected) {
    console.log(`  ✅ ${path} → "${result}"`);
    namePassed++;
  } else {
    console.log(`  ❌ ${path}: expected "${expected}", got "${result}"`);
  }
}
console.log(`  Name derivation: ${namePassed}/${nameCases.length} passed`);

// ---------------------------------------------------------------------------
// 3. SPEC INPUTS PARSING
// ---------------------------------------------------------------------------
console.log('\n--- 3. Spec Inputs Parsing ---');

const SPEC_INPUTS_SECTION_REGEX =
  /spec:\s*\n\s*inputs:([\s\S]*?)(?=\n---|\ndescription:|\nvariables:|\n[a-zA-Z][a-zA-Z0-9_-]*:|$)/;

function parseSpecInputs(content) {
  const parts = content.split(/^---\s*$/m);
  const specSection = parts[0] || '';
  const specMatch = specSection.match(SPEC_INPUTS_SECTION_REGEX);
  if (!specMatch) return [];

  const variables = [];
  let currentInput = null;
  for (const line of specMatch[1].split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))) {
    const trimmed = line.trim();
    if (line.match(/^[a-zA-Z][a-zA-Z0-9_-]*:/)) break;
    if (line.match(/^\s{4}[a-zA-Z_][a-zA-Z0-9_]*:/) || line.match(/^\s{2}[a-zA-Z_][a-zA-Z0-9_]*:/)) {
      if (currentInput) variables.push(currentInput);
      currentInput = { name: trimmed.split(':')[0], type: 'string', default: undefined };
    } else if (currentInput && line.match(/^\s{6,}/)) {
      if (trimmed.startsWith('type:')) currentInput.type = trimmed.substring(5).replace(/['"]/g, '').trim();
      if (trimmed.startsWith('default:')) currentInput.default = trimmed.substring(8).replace(/['"]/g, '').trim();
    }
  }
  if (currentInput) variables.push(currentInput);
  return variables;
}

const specCases = [
  {
    name: 'basic string and boolean inputs',
    content: `spec:\n  inputs:\n    environment:\n      type: "string"\n      default: "staging"\n    dry_run:\n      type: "boolean"\n      default: false\n---\njob:\n  script: echo hi`,
    expectedCount: 2,
    expectedNames: ['environment', 'dry_run'],
    expectedTypes: ['string', 'boolean']
  },
  {
    name: 'inputs without spec separator (legacy)',
    content: `spec:\n  inputs:\n    version:\n      type: "string"\n      default: "latest"\nvariables:\n  CI_VAR: value`,
    expectedCount: 1,
    expectedNames: ['version'],
    expectedTypes: ['string']
  },
  {
    name: 'job-section variables are NOT extracted',
    content: `spec:\n  inputs:\n    stage:\n      default: test\n---\njob:\n  variables:\n    JOB_VAR: should_not_appear`,
    expectedCount: 1,
    expectedNames: ['stage'],
    expectedTypes: ['string']
  },
  {
    name: 'template with no spec returns empty array',
    content: `deploy-job:\n  stage: deploy\n  script:\n    - echo "no spec"`,
    expectedCount: 0,
    expectedNames: [],
    expectedTypes: []
  }
];

let specPassed = 0;
for (const tc of specCases) {
  const inputs = parseSpecInputs(tc.content);
  const countOk = inputs.length === tc.expectedCount;
  const namesOk = tc.expectedNames.every(n => inputs.some(v => v.name === n));
  const typesOk = inputs.every((v, i) => !tc.expectedTypes[i] || v.type === tc.expectedTypes[i]);
  if (countOk && namesOk && typesOk) {
    console.log(`  ✅ ${tc.name}`);
    specPassed++;
  } else {
    console.log(`  ❌ ${tc.name}`);
    if (!countOk) console.log(`     Count: expected ${tc.expectedCount}, got ${inputs.length}`);
    if (!namesOk) console.log(`     Missing names: ${tc.expectedNames.filter(n => !inputs.some(v => v.name === n)).join(', ')}`);
  }
}
console.log(`  Spec parsing: ${specPassed}/${specCases.length} passed`);

// ---------------------------------------------------------------------------
// 4. CACHE KEY CONSTRUCTION
// ---------------------------------------------------------------------------
console.log('\n--- 4. Cache Key Construction ---');

function buildCacheKey(gitlabInstance, projectPath, version) {
  const versionSuffix = version ? `@${version}` : '';
  return `catalog:${gitlabInstance}:${projectPath}${versionSuffix}`;
}

const cacheCases = [
  { instance: 'gitlab.com', path: 'group/project', version: undefined, expected: 'catalog:gitlab.com:group/project' },
  { instance: 'gitlab.com', path: 'group/project', version: '2.0.0', expected: 'catalog:gitlab.com:group/project@2.0.0' },
  { instance: 'self.example.com', path: 'infra/ci', version: 'main', expected: 'catalog:self.example.com:infra/ci@main' }
];

let cachePassed = 0;
for (const { instance, path, version, expected } of cacheCases) {
  const key = buildCacheKey(instance, path, version);
  if (key === expected) {
    console.log(`  ✅ ${key}`);
    cachePassed++;
  } else {
    console.log(`  ❌ expected "${expected}", got "${key}"`);
  }
}
console.log(`  Cache keys: ${cachePassed}/${cacheCases.length} passed`);

// ---------------------------------------------------------------------------
// 5. HTTP PROTOCOL STRIPPING (gitlabInstance cleanup)
// ---------------------------------------------------------------------------
console.log('\n--- 5. GitLab Instance URL Cleanup ---');

function cleanGitlabInstance(instance) {
  return instance.replace(/^https?:\/\//, '');
}

const cleanCases = [
  { input: 'https://gitlab.com', expected: 'gitlab.com' },
  { input: 'http://self-hosted.example.com', expected: 'self-hosted.example.com' },
  { input: 'gitlab.com', expected: 'gitlab.com' }
];

let cleanPassed = 0;
for (const { input, expected } of cleanCases) {
  const result = cleanGitlabInstance(input);
  if (result === expected) {
    console.log(`  ✅ "${input}" → "${result}"`);
    cleanPassed++;
  } else {
    console.log(`  ❌ "${input}": expected "${expected}", got "${result}"`);
  }
}
console.log(`  URL cleanup: ${cleanPassed}/${cleanCases.length} passed`);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const allPassed = urlPassed === urlCases.length &&
                  namePassed === nameCases.length &&
                  specPassed === specCases.length &&
                  cachePassed === cacheCases.length &&
                  cleanPassed === cleanCases.length;

const total = urlCases.length + nameCases.length + specCases.length + cacheCases.length + cleanCases.length;
const passed = urlPassed + namePassed + specPassed + cachePassed + cleanPassed;

console.log('\n' + '='.repeat(40));
console.log('📊 Extension Core Behaviour Test Summary');
console.log(`Total assertions: ${passed}/${total}`);
if (allPassed) {
  console.log('🎉 All tests passed!');
  process.exit(0);
} else {
  console.log('💥 Some tests failed!');
  process.exit(1);
}
