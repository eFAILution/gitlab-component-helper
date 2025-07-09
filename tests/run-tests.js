#!/usr/bin/env node
/**
 * Simple test runner for GitLab Component Helper extension
 * Runs unit tests and reports results
 */

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

// Find all test files
// eslint-disable-next-line no-undef
const testDir = path.join(__dirname, 'unit');
const testFiles = fs.readdirSync(testDir)
  .filter(file => file.endsWith('.test.js'))
  .map(file => path.join(testDir, file));

console.log(`${colors.blue}Found ${testFiles.length} test file(s):${colors.reset}`);
testFiles.forEach(file => {
  console.log(`  - ${path.basename(file)}`);
});
console.log();

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

// Run each test file
async function runTests() {
  for (const testFile of testFiles) {
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
