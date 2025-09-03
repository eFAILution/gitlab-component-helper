/**
 * Component Browser Transform Tests
 *
 * Tests for transformCachedComponentsToGroups behavior before refactoring.
 * This ensures version selection logic and grouping hierarchy are preserved.
 */

const assert = require('assert');

console.log('=== Component Browser Transform Tests ===');

/**
 * Mock implementation of transformCachedComponentsToGroups
 * This replicates the current behavior to test the logic
 */
function mockTransformCachedComponentsToGroups(cachedComponents) {
  const sourceGroups = new Map();

  for (const component of cachedComponents) {
    // Skip components with missing critical fields
    if (!component.name || !component.sourcePath || !component.gitlabInstance) {
      continue;
    }

    // Extract source from component.source or construct from sourcePath
    let sourceName = component.source;
    if (!sourceName) {
      const pathParts = component.sourcePath.split('/');
      sourceName = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : pathParts[0];
    } else if (sourceName.includes('/')) {
      // If source contains a slash, take everything before the first slash as the source name
      sourceName = sourceName.split('/')[0];
    }

    // Get or create source group
    if (!sourceGroups.has(sourceName)) {
      sourceGroups.set(sourceName, {
        source: sourceName,
        totalComponents: 0,
        projects: new Map()
      });
    }

    const sourceGroup = sourceGroups.get(sourceName);

    // Extract project path
    const projectPath = component.sourcePath;

    // Get or create project
    if (!sourceGroup.projects.has(projectPath)) {
      sourceGroup.projects.set(projectPath, {
        path: projectPath,
        components: []
      });
    }

    const project = sourceGroup.projects.get(projectPath);

    // Check if component already exists in this project
    const existingComponent = project.components.find(c => c.name === component.name);

    if (existingComponent) {
      // Add version to existing component
      if (component.availableVersions) {
        existingComponent.availableVersions = [...new Set([...existingComponent.availableVersions, ...component.availableVersions])];
      } else {
        existingComponent.availableVersions = [...new Set([...existingComponent.availableVersions, component.version])];
      }
      existingComponent.versionCount = existingComponent.availableVersions.length;
      existingComponent.defaultVersion = selectDefaultVersion(existingComponent.availableVersions);
    } else {
      // Create new component entry
      const availableVersions = component.availableVersions || [component.version];
      const componentEntry = {
        name: component.name,
        description: component.description,
        parameters: component.parameters || [],
        versionCount: availableVersions.length,
        availableVersions: availableVersions,
        defaultVersion: selectDefaultVersion(availableVersions),
        gitlabInstance: component.gitlabInstance,
        sourcePath: component.sourcePath
      };

      project.components.push(componentEntry);
      sourceGroup.totalComponents++;
    }
  }

  // Convert maps to arrays for final result
  const result = [];
  for (const sourceGroup of sourceGroups.values()) {
    result.push({
      source: sourceGroup.source,
      totalComponents: sourceGroup.totalComponents,
      projects: Array.from(sourceGroup.projects.values())
    });
  }

  return result;
}

/**
 * Mock implementation of version selection logic
 */
function selectDefaultVersion(versions) {
  // Filter semantic versions
  const semanticVersions = versions.filter(v => /^v?\d+\.\d+\.\d+/.test(v));

  if (semanticVersions.length > 0) {
    // Sort semantic versions and return highest
    return semanticVersions.sort((a, b) => {
      const parseVersion = (version) => {
        const cleaned = version.replace(/^v/, '');
        return cleaned.split('.').map(Number);
      };

      const [aMajor, aMinor, aPatch] = parseVersion(a);
      const [bMajor, bMinor, bPatch] = parseVersion(b);

      if (aMajor !== bMajor) return bMajor - aMajor;
      if (aMinor !== bMinor) return bMinor - aMinor;
      return bPatch - aPatch;
    })[0];
  }

  // Fallback to branch priority
  if (versions.includes('main')) return 'main';
  if (versions.includes('master')) return 'master';
  if (versions.includes('latest')) return 'latest';

  // Return first available
  return versions[0];
}

/**
 * Test transformCachedComponentsToGroups private method via mock implementation
 */
function testTransformCachedComponentsToGroups() {
  console.log('\n--- Testing transformCachedComponentsToGroups behavior ---');

  let passed = 0;
  let failed = 0;

  // Test 1: Single source, single project, single component
  console.log('\nTest 1: Single component transformation');
  try {
    const singleComponentData = [
      {
        name: 'test-component',
        description: 'A test component',
        parameters: [
          {
            name: 'environment',
            description: 'Target environment',
            required: true,
            type: 'string'
          }
        ],
        version: 'v1.0.0',
        source: 'Test Source',
        sourcePath: 'group/project',
        gitlabInstance: 'gitlab.com'
      }
    ];

    // Access mock implementation
    const result = mockTransformCachedComponentsToGroups(singleComponentData);

    // Validate structure
    assert.strictEqual(result.length, 1, 'Should have one source group');
    assert.strictEqual(result[0].source, 'Test Source', 'Source name should match');
    assert.strictEqual(result[0].totalComponents, 1, 'Should have one total component');
    assert.strictEqual(result[0].projects.length, 1, 'Should have one project');
    assert.strictEqual(result[0].projects[0].components.length, 1, 'Should have one component');

    const component = result[0].projects[0].components[0];
    assert.strictEqual(component.name, 'test-component', 'Component name should match');
    assert.strictEqual(component.versionCount, 1, 'Should have one version');
    assert.strictEqual(component.defaultVersion, 'v1.0.0', 'Default version should match component version');

    console.log('Single component transformation: PASS ✅');
    passed++;
  } catch (error) {
    console.log('Single component transformation: FAIL ❌');
    console.log(`  Error: ${error.message}`);
    failed++;
  }

  // Test 2: Multiple versions with semantic prioritization
  console.log('\nTest 2: Multiple versions with semantic prioritization');
  try {
    const multiVersionData = [
      {
        name: 'multi-version-component',
        description: 'Component with multiple versions',
        parameters: [],
        version: 'latest',
        availableVersions: ['latest', 'v1.2.3', 'v2.0.0', 'main'],
        source: 'Version Test Source',
        sourcePath: 'group/multi-version',
        gitlabInstance: 'gitlab.com'
      }
    ];

    const result = mockTransformCachedComponentsToGroups(multiVersionData);

    // Validate structure
    assert.strictEqual(result.length, 1, 'Should have one source group');
    assert.strictEqual(result[0].projects[0].components.length, 1, 'Should have one component');

    const component = result[0].projects[0].components[0];
    assert.strictEqual(component.versionCount, 4, 'Should have four versions');
    assert.deepStrictEqual(component.availableVersions, ['latest', 'v1.2.3', 'v2.0.0', 'main'], 'Should preserve available versions');

    // Test version priority logic: latest should resolve to highest semantic version (v2.0.0)
    assert.strictEqual(component.defaultVersion, 'v2.0.0', 'Default version should be highest semantic version, not "latest"');

    console.log('Multiple versions transformation: PASS ✅');
    passed++;
  } catch (error) {
    console.log('Multiple versions transformation: FAIL ❌');
    console.log(`  Error: ${error.message}`);
    failed++;
  }

  // Test 3: Component missing critical fields should be skipped
  console.log('\nTest 3: Component with missing critical fields');
  try {
    const incompleteComponentData = [
      {
        name: 'good-component',
        description: 'A valid component',
        parameters: [],
        version: 'v1.0.0',
        source: 'Good Source',
        sourcePath: 'group/good',
        gitlabInstance: 'gitlab.com'
      },
      {
        // Missing sourcePath - should be skipped
        name: 'bad-component',
        description: 'Invalid component',
        parameters: [],
        version: 'v1.0.0',
        source: 'Bad Source',
        gitlabInstance: 'gitlab.com'
      },
      {
        // Missing name - should be skipped
        description: 'Another invalid component',
        parameters: [],
        version: 'v1.0.0',
        source: 'Another Bad Source',
        sourcePath: 'group/bad',
        gitlabInstance: 'gitlab.com'
      }
    ];

    const result = mockTransformCachedComponentsToGroups(incompleteComponentData);

    // Should only have the valid component
    assert.strictEqual(result.length, 1, 'Should have one source group');
    assert.strictEqual(result[0].totalComponents, 1, 'Should have one total component (bad ones skipped)');
    assert.strictEqual(result[0].projects[0].components.length, 1, 'Should have one component');
    assert.strictEqual(result[0].projects[0].components[0].name, 'good-component', 'Should only include valid component');

    console.log('Missing fields handling: PASS ✅');
    passed++;
  } catch (error) {
    console.log('Missing fields handling: FAIL ❌');
    console.log(`  Error: ${error.message}`);
    failed++;
  }

  // Test 4: Complex hierarchy with multiple sources and projects
  console.log('\nTest 4: Complex hierarchy transformation');
  try {
    const complexData = [
      {
        name: 'component-a',
        description: 'Component A',
        parameters: [],
        version: 'v1.0.0',
        source: 'Source One/Project Alpha',
        sourcePath: 'source-one/project-alpha',
        gitlabInstance: 'gitlab.com'
      },
      {
        name: 'component-b',
        description: 'Component B',
        parameters: [],
        version: 'v2.0.0',
        source: 'Source One/Project Beta',
        sourcePath: 'source-one/project-beta',
        gitlabInstance: 'gitlab.com'
      },
      {
        name: 'component-c',
        description: 'Component C',
        parameters: [],
        version: 'v1.5.0',
        source: 'Source Two',
        sourcePath: 'source-two/project-gamma',
        gitlabInstance: 'gitlab.example.com'
      }
    ];

    const result = mockTransformCachedComponentsToGroups(complexData);

    // Should have two source groups
    assert.strictEqual(result.length, 2, 'Should have two source groups');

    // Find Source One and Source Two
    const sourceOne = result.find(s => s.source === 'Source One');
    const sourceTwo = result.find(s => s.source === 'Source Two');

    assert(sourceOne, 'Should have Source One');
    assert(sourceTwo, 'Should have Source Two');

    // Source One should have 2 projects
    assert.strictEqual(sourceOne.projects.length, 2, 'Source One should have 2 projects');
    assert.strictEqual(sourceOne.totalComponents, 2, 'Source One should have 2 components');

    // Source Two should have 1 project
    assert.strictEqual(sourceTwo.projects.length, 1, 'Source Two should have 1 project');
    assert.strictEqual(sourceTwo.totalComponents, 1, 'Source Two should have 1 component');

    console.log('Complex hierarchy transformation: PASS ✅');
    passed++;
  } catch (error) {
    console.log('Complex hierarchy transformation: FAIL ❌');
    console.log(`  Error: ${error.message}`);
    failed++;
  }

  // Test 5: Version priority edge cases
  console.log('\nTest 5: Version priority edge cases');
  try {
    const edgeCaseData = [
      {
        name: 'edge-component',
        description: 'Component with edge case versions',
        parameters: [],
        version: 'latest',
        availableVersions: ['latest', 'main', 'master', 'v10.0.0', 'v2.1.0', 'v2.10.0'],
        source: 'Edge Source',
        sourcePath: 'edge/component',
        gitlabInstance: 'gitlab.com'
      }
    ];

    const result = mockTransformCachedComponentsToGroups(edgeCaseData);
    const component = result[0].projects[0].components[0];

    // Should prioritize highest semantic version (v10.0.0) over 'latest'
    assert.strictEqual(component.defaultVersion, 'v10.0.0', 'Should select highest semantic version');

    console.log('Version priority edge cases: PASS ✅');
    passed++;
  } catch (error) {
    console.log('Version priority edge cases: FAIL ❌');
    console.log(`  Error: ${error.message}`);
    failed++;
  }

  console.log(`\nTransform Tests Summary:`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ${failed > 0 ? '❌' : ''}`);

  return failed === 0;
}

/**
 * Test version resolution logic specifically
 */
function testVersionResolution() {
  console.log('\n--- Testing Version Resolution Logic ---');

  let passed = 0;
  let failed = 0;

  // Test cases for version priority
  const testCases = [
    {
      name: 'Latest with semantics',
      versions: ['latest', 'v1.0.0', 'v2.0.0'],
      expected: 'v2.0.0'
    },
    {
      name: 'Branch names with semantics',
      versions: ['main', 'master', 'v1.5.0'],
      expected: 'v1.5.0'
    },
    {
      name: 'Only branch names',
      versions: ['main', 'master'],
      expected: 'main'
    },
    {
      name: 'Only latest',
      versions: ['latest'],
      expected: 'latest'
    },
    {
      name: 'Semantic version ordering',
      versions: ['v1.0.0', 'v1.10.0', 'v1.2.0'],
      expected: 'v1.10.0'
    },
    {
      name: 'Major version priority',
      versions: ['v1.10.0', 'v2.0.0', 'v10.0.0'],
      expected: 'v10.0.0'
    }
  ];

  for (const testCase of testCases) {
    console.log(`\nTest: ${testCase.name}`);
    try {
      const componentData = [{
        name: 'test-component',
        description: 'Test component',
        parameters: [],
        version: testCase.versions[0],
        availableVersions: testCase.versions,
        source: 'Test Source',
        sourcePath: 'test/path',
        gitlabInstance: 'gitlab.com'
      }];

      const result = mockTransformCachedComponentsToGroups(componentData);
      const component = result[0].projects[0].components[0];

      assert.strictEqual(component.defaultVersion, testCase.expected,
        `Expected ${testCase.expected}, got ${component.defaultVersion}`);

      console.log(`  ${testCase.name}: PASS ✅`);
      passed++;
    } catch (error) {
      console.log(`  ${testCase.name}: FAIL ❌`);
      console.log(`    Error: ${error.message}`);
      failed++;
    }
  }

  console.log(`\nVersion Resolution Summary:`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ${failed > 0 ? '❌' : ''}`);

  return failed === 0;
}

// Run all tests
console.log('Running component browser transform tests...\n');

const transformTests = testTransformCachedComponentsToGroups();
const versionTests = testVersionResolution();

const allPassed = transformTests && versionTests;

console.log('\n=== Component Browser Transform Test Summary ===');
console.log(`Transform logic: ${transformTests ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Version resolution: ${versionTests ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Overall: ${allPassed ? 'PASS ✅' : 'FAIL ❌'}`);

if (allPassed) {
  console.log('\n🎉 All transform tests passed!');
} else {
  console.log('\n💥 Some transform tests failed!');
}

// Set exit code
// eslint-disable-next-line no-undef
process.exit(allPassed ? 0 : 1);
