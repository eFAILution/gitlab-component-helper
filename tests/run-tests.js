#!/usr/bin/env node
/**
 * Simple test runner for GitLab Component Helper extension
 * Runs unit tests and reports results
 */
/* eslint-env node */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Colors for console output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  reset: '\x1b[0m'
};

console.log(`${colors.cyan}=== GitLab Component Helper Tests ===${colors.reset}\n`);

// Check for test type filter from command line arguments
// eslint-disable-next-line no-undef
const testTypeFilter = process.argv[2]; // e.g., 'unit', 'integration', 'performance'

// Find all test files in different directories
const testDirectories = [
  // eslint-disable-next-line no-undef
  { path: path.join(__dirname, 'unit'), type: 'unit' },
  // eslint-disable-next-line no-undef
  { path: path.join(__dirname, 'integration'), type: 'integration' },
  // eslint-disable-next-line no-undef
  { path: __dirname, type: 'performance' } // Root tests directory for files like performance.test.js
];

let testFiles = [];

testDirectories.forEach(testDir => {
  if (fs.existsSync(testDir.path)) {
    let files = fs.readdirSync(testDir.path)
      .filter(file => file.endsWith('.test.js'))
      .map(file => ({ path: path.join(testDir.path, file), type: testDir.type }));

    // Filter by test type if specified
    if (testTypeFilter) {
      files = files.filter(file => file.type === testTypeFilter);
    }

    testFiles = testFiles.concat(files);
  }
});

// Sort test files for consistent execution order
testFiles.sort((a, b) => a.path.localeCompare(b.path));

const typeMessage = testTypeFilter ? ` (${testTypeFilter} tests only)` : '';
console.log(`${colors.blue}Found ${testFiles.length} test file(s)${typeMessage}:${colors.reset}`);
testFiles.forEach(file => {
  // eslint-disable-next-line no-undef
  const relativePath = path.relative(__dirname, file.path);
  console.log(`  - ${relativePath} (${file.type})`);
});
console.log();

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

// Run each test file
async function runTests() {
  for (const testFileObj of testFiles) {
    const testFile = testFileObj.path;
    console.log(`${colors.yellow}Running ${path.basename(testFile)}...${colors.reset}`);

    try {
      await new Promise((resolve, reject) => {
        const child = spawn('node', [testFile], {
          stdio: 'inherit',
          cwd: path.dirname(testFile)
        });

        child.on('close', (code) => {
          if (code === 0) {
            console.log(`${colors.green}✅ ${path.basename(testFile)} completed${colors.reset}\n`);
            resolve();
          } else {
            console.log(`${colors.red}❌ ${path.basename(testFile)} failed with code ${code}${colors.reset}\n`);
            reject(new Error(`Test failed with code ${code}`));
          }
        });

        child.on('error', (err) => {
          console.error(`${colors.red}Error running ${path.basename(testFile)}: ${err.message}${colors.reset}\n`);
          reject(err);
        });
      });

      passedTests++;
    } catch {
      failedTests++;
    }

    totalTests++;
  }

  // Print summary
  console.log(`${colors.cyan}=== Test Summary ===${colors.reset}`);
  console.log(`Total test files: ${totalTests}`);
  console.log(`${colors.green}Passed: ${passedTests}${colors.reset}`);
  if (failedTests > 0) {
    console.log(`${colors.red}Failed: ${failedTests}${colors.reset}`);
  }

  if (failedTests === 0) {
    console.log(`\n${colors.green}🎉 All tests passed!${colors.reset}`);
    // eslint-disable-next-line no-undef
    process.exit(0);
  } else {
    console.log(`\n${colors.red}💥 Some tests failed!${colors.reset}`);
    // eslint-disable-next-line no-undef
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error(`${colors.red}Test runner error: ${err.message}${colors.reset}`);
  // eslint-disable-next-line no-undef
  process.exit(1);
});
