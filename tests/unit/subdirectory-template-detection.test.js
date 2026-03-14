#!/usr/bin/env node
/**
 * Test subdirectory template detection logic
 *
 * GitLab CI components can be placed in:
 *   templates/*.yaml          (root level)
 *   templates/<subdir>/*.yaml (one level of subdirectories)
 *
 * This tests the fetchAllTemplateFiles logic which should collect
 * YAML files from both locations.
 */

console.log('🧪 Testing Subdirectory Template Detection');
console.log('='.repeat(50));

/**
 * Simulate the fetchAllTemplateFiles logic from componentService.ts.
 * This mirrors the production code to ensure correctness.
 */
async function simulateFetchAllTemplateFiles(topLevelItems, subdirItemsByName) {
  // Step 1: separate YAML blobs from sub-directories at the top level
  const yamlFiles = topLevelItems.filter(
    item => item.type === 'blob' && (item.name.endsWith('.yml') || item.name.endsWith('.yaml'))
  );

  const subdirs = topLevelItems.filter(item => item.type === 'tree');

  // Step 2: fetch each subdir and collect its YAML blobs
  for (const subdir of subdirs) {
    const subdirContents = subdirItemsByName[subdir.name] || [];
    const subdirYaml = subdirContents.filter(
      item => item.type === 'blob' && (item.name.endsWith('.yml') || item.name.endsWith('.yaml'))
    );
    yamlFiles.push(...subdirYaml);
  }

  return yamlFiles;
}

/**
 * Simulate the component name derivation from a tree item's path.
 * Mirrors: const relativePath = file.path.replace(/^templates\//, '');
 *          const name = relativePath.replace(/\.ya?ml$/, '');
 */
function deriveComponentName(filePath) {
  return filePath.replace(/^templates\//, '').replace(/\.ya?ml$/, '');
}

async function runTests() {
  const testCases = [
    {
      name: 'Root-level YAML files only',
      topLevel: [
        { id: '1', name: 'deploy.yml',  type: 'blob', path: 'templates/deploy.yml',  mode: '100644' },
        { id: '2', name: 'build.yaml',  type: 'blob', path: 'templates/build.yaml', mode: '100644' }
      ],
      subdirItems: {},
      expectedNames: ['deploy', 'build']
    },
    {
      name: 'Subdirectory YAML files only',
      topLevel: [
        { id: '3', name: 'security', type: 'tree', path: 'templates/security', mode: '040000' }
      ],
      subdirItems: {
        security: [
          { id: '4', name: 'scanner.yml', type: 'blob', path: 'templates/security/scanner.yml', mode: '100644' },
          { id: '5', name: 'lint.yaml',   type: 'blob', path: 'templates/security/lint.yaml',   mode: '100644' }
        ]
      },
      expectedNames: ['security/scanner', 'security/lint']
    },
    {
      name: 'Mixed root-level and subdirectory YAML files',
      topLevel: [
        { id: '6', name: 'root-component.yml', type: 'blob', path: 'templates/root-component.yml', mode: '100644' },
        { id: '7', name: 'deploy',              type: 'tree', path: 'templates/deploy',             mode: '040000' },
        { id: '8', name: 'test',                type: 'tree', path: 'templates/test',               mode: '040000' }
      ],
      subdirItems: {
        deploy: [
          { id: '9',  name: 'production.yml', type: 'blob', path: 'templates/deploy/production.yml', mode: '100644' },
          { id: '10', name: 'staging.yml',    type: 'blob', path: 'templates/deploy/staging.yml',    mode: '100644' }
        ],
        test: [
          { id: '11', name: 'unit.yml', type: 'blob', path: 'templates/test/unit.yml', mode: '100644' }
        ]
      },
      expectedNames: ['root-component', 'deploy/production', 'deploy/staging', 'test/unit']
    },
    {
      name: 'Non-YAML files and nested directories are ignored',
      topLevel: [
        { id: '12', name: 'component.yml', type: 'blob', path: 'templates/component.yml', mode: '100644' },
        { id: '13', name: 'README.md',     type: 'blob', path: 'templates/README.md',     mode: '100644' },
        { id: '14', name: 'subdir',        type: 'tree', path: 'templates/subdir',        mode: '040000' }
      ],
      subdirItems: {
        subdir: [
          { id: '15', name: 'valid.yml',      type: 'blob', path: 'templates/subdir/valid.yml',      mode: '100644' },
          { id: '16', name: 'ignore.json',    type: 'blob', path: 'templates/subdir/ignore.json',    mode: '100644' },
          { id: '17', name: 'deeper',         type: 'tree', path: 'templates/subdir/deeper',         mode: '040000' }
        ]
      },
      // README.md, ignore.json and the deeper dir should not appear
      expectedNames: ['component', 'subdir/valid']
    },
    {
      name: 'Empty templates directory',
      topLevel: [],
      subdirItems: {},
      expectedNames: []
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const [index, tc] of testCases.entries()) {
    console.log(`\nTest ${index + 1}: ${tc.name}`);
    console.log('-'.repeat(30));

    try {
      const files = await simulateFetchAllTemplateFiles(tc.topLevel, tc.subdirItems);
      const actualNames = files.map(f => deriveComponentName(f.path)).sort();
      const expectedNames = [...tc.expectedNames].sort();

      const namesMatch =
        actualNames.length === expectedNames.length &&
        actualNames.every((n, i) => n === expectedNames[i]);

      if (namesMatch) {
        console.log(`✅ PASS — found components: [${actualNames.join(', ')}]`);
        passed++;
      } else {
        console.log(`❌ FAIL`);
        console.log(`  Expected: [${expectedNames.join(', ')}]`);
        console.log(`  Actual:   [${actualNames.join(', ')}]`);
        failed++;
      }
    } catch (err) {
      console.log(`❌ FAIL — Error: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log('📊 Subdirectory Template Detection Summary');
  console.log(`Total tests: ${testCases.length}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ${failed > 0 ? '❌' : ''}`);
  console.log(`Success rate: ${Math.round((passed / testCases.length) * 100)}%`);

  return failed === 0;
}

runTests().then(allPassed => {
  if (allPassed) {
    console.log('\n🎉 All subdirectory template detection tests passed!');
    process.exit(0);
  } else {
    console.log('\n💥 Some tests failed!');
    process.exit(1);
  }
});
