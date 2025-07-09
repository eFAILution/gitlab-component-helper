/**
 * URL Parsing Tests
 *
 * Tests the URL parsing logic used in componentDetector.ts
 * to ensure GitLab component URLs are correctly parsed into
 * project path, component name, and version.
 */

console.log('=== URL Parsing Tests ===');

/**
 * Test the URL parsing logic that extracts project path, component name, and version
 * from GitLab component URLs
 */
function testUrlParsing() {
  const testCases = [
    {
      name: 'GitLab.com component URL',
      url: 'https://gitlab.com/components/opentofu/full-pipeline@2.9.0',
      expected: {
        gitlabInstance: 'gitlab.com',
        projectPath: 'components/opentofu',
        componentName: 'full-pipeline',
        version: '2.9.0'
      }
    },
    {
      name: 'Component URL without version',
      url: 'https://gitlab.example.com/group/project/my-component',
      expected: {
        gitlabInstance: 'gitlab.example.com',
        projectPath: 'group/project',
        componentName: 'my-component',
        version: undefined
      }
    },
    {
      name: 'Simple component URL',
      url: 'https://gitlab.com/user/simple-component@latest',
      expected: {
        gitlabInstance: 'gitlab.com',
        projectPath: 'user',
        componentName: 'simple-component',
        version: 'latest'
      }
    }
  ];

  let passed = 0;
  let failed = 0;

  testCases.forEach((testCase, index) => {
    console.log(`\nTest ${index + 1}: ${testCase.name}`);
    console.log(`URL: ${testCase.url}`);

    // This is the same parsing logic used in componentDetector.ts
    let projectPath, version, componentName, gitlabInstance;

    if (testCase.url.includes('@')) {
      const urlParts = testCase.url.split('@');
      const baseUrl = urlParts[0];
      version = urlParts[1];

      const baseUrlObj = new URL(baseUrl);
      const fullPath = baseUrlObj.pathname.substring(1);
      const pathParts = fullPath.split('/');
      componentName = pathParts.pop() || '';
      projectPath = pathParts.join('/');
      gitlabInstance = baseUrlObj.hostname;
    } else {
      const url = new URL(testCase.url);
      const fullPath = url.pathname.substring(1);
      const pathParts = fullPath.split('/');
      componentName = pathParts.pop() || '';
      projectPath = pathParts.join('/');
      gitlabInstance = url.hostname;
      version = undefined;
    }

    const actual = { gitlabInstance, projectPath, componentName, version };

    // Check if results match expected
    const isCorrect =
      actual.gitlabInstance === testCase.expected.gitlabInstance &&
      actual.projectPath === testCase.expected.projectPath &&
      actual.componentName === testCase.expected.componentName &&
      actual.version === testCase.expected.version;

    console.log('Results:');
    console.log(`  GitLab Instance: ${actual.gitlabInstance} (expected: ${testCase.expected.gitlabInstance})`);
    console.log(`  Project Path: ${actual.projectPath} (expected: ${testCase.expected.projectPath})`);
    console.log(`  Component Name: ${actual.componentName} (expected: ${testCase.expected.componentName})`);
    console.log(`  Version: ${actual.version} (expected: ${testCase.expected.version})`);
    console.log(`Result: ${isCorrect ? 'PASS ✅' : 'FAIL ❌'}`);

    if (isCorrect) {
      passed++;
    } else {
      failed++;
    }
  });

  console.log(`\n=== URL Parsing Test Summary ===`);
  console.log(`Total tests: ${testCases.length}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ${failed > 0 ? '❌' : ''}`);
  console.log(`Success rate: ${Math.round((passed / testCases.length) * 100)}%`);

  return failed === 0;
}

// Run the tests
const allTestsPassed = testUrlParsing();

if (allTestsPassed) {
  console.log('\n🎉 All URL parsing tests passed!');
  // eslint-disable-next-line no-undef
  process.exit(0);
} else {
  console.log('\n💥 Some tests failed!');
  // eslint-disable-next-line no-undef
  process.exit(1);
}
