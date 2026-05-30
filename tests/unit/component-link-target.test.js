/**
 * Component Template File URL Tests
 *
 * Tests the logic that derives the GitLab project URL for a component's template file. Mirrors
 * templateFileUrlForResolved() in src/utils/templateFileUrl.ts.
 */

const assert = require('assert');

console.log('=== Component Template File URL Tests ===');

function ref(version) {
  return version && version !== 'main' ? encodeURIComponent(version) : 'main';
}

function pathForTemplate(templatePath, encodedRef) {
  const segments = templatePath.split('/');
  if (segments.length <= 2) {
    return `/-/blob/${encodedRef}/${templatePath}`;
  }
  return `/-/tree/${encodedRef}/${segments.slice(0, -1).join('/')}`;
}

function templateFileUrlForResolved(input) {
  return `https://${input.gitlabInstance}/${input.projectPath}${pathForTemplate(input.templatePath, ref(input.version))}`;
}

const resolvedCases = [
  {
    name: 'Resolved single-file template',
    input: {
      gitlabInstance: 'gitlab.com',
      projectPath: 'yu-life/infrastructure/yulife-devops-shared-config',
      version: 'install-yu-ci-tools-2',
      templatePath: 'templates/install-yu-ci-tools.yml',
    },
    expected: 'https://gitlab.com/yu-life/infrastructure/yulife-devops-shared-config/-/blob/install-yu-ci-tools-2/templates/install-yu-ci-tools.yml',
  },
  {
    name: 'Resolved directory-form template links to the parent directory',
    input: {
      gitlabInstance: 'gitlab.com',
      projectPath: 'components/opentofu',
      version: '2.9.0',
      templatePath: 'templates/full-pipeline/template.yml',
    },
    expected: 'https://gitlab.com/components/opentofu/-/tree/2.9.0/templates/full-pipeline',
  },
  {
    name: 'Resolved directory-form matches the screenshot scenario',
    input: {
      gitlabInstance: 'gitlab.com',
      projectPath: 'yu-life/infrastructure/yulife-devops-shared-config',
      version: 'install-yu-ci-tools-2',
      templatePath: 'templates/install-yu-ci-tools/template.yml',
    },
    expected: 'https://gitlab.com/yu-life/infrastructure/yulife-devops-shared-config/-/tree/install-yu-ci-tools-2/templates/install-yu-ci-tools',
  },
  {
    name: 'Resolved template with no version defaults to main',
    input: {
      gitlabInstance: 'gitlab.example.com',
      projectPath: 'group/project',
      version: undefined,
      templatePath: 'templates/my-component.yml',
    },
    expected: 'https://gitlab.example.com/group/project/-/blob/main/templates/my-component.yml',
  },
  {
    name: 'Resolved with non-default templateRoots (directory form)',
    input: {
      gitlabInstance: 'gitlab.example.com',
      projectPath: 'team/repo',
      version: 'v1',
      templatePath: 'ci-templates/foo/template.yaml',
    },
    expected: 'https://gitlab.example.com/team/repo/-/tree/v1/ci-templates/foo',
  },
  {
    name: 'Resolved ref with slash is URL-encoded',
    input: {
      gitlabInstance: 'gitlab.internal.example.com',
      projectPath: 'team/repo',
      version: 'feature/branch-name',
      templatePath: 'templates/comp.yml',
    },
    expected: 'https://gitlab.internal.example.com/team/repo/-/blob/feature%2Fbranch-name/templates/comp.yml',
  },
];

let passed = 0;
let failed = 0;

resolvedCases.forEach((tc, i) => {
  const actual = templateFileUrlForResolved(tc.input);
  console.log(`\nResolved Test ${i + 1}: ${tc.name}`);
  console.log(`  Expected: ${tc.expected}`);
  console.log(`  Actual:   ${actual}`);
  try {
    assert.strictEqual(actual, tc.expected);
    console.log('  Result: PASS');
    passed++;
  } catch (e) {
    console.log('  Result: FAIL');
    failed++;
  }
});

console.log(`\n=== Component Template File URL Summary ===`);
console.log(`Total: ${resolvedCases.length}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
  console.log('FAIL: some template file URL cases did not match expectation.');
  process.exit(1);
}

console.log('All template file URL tests passed.');
process.exit(0);
