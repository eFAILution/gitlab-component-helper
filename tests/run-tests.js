#!/usr/bin/env node
/**
 * Test runner for GitLab Component Helper extension.
 *
 * Runs every *.test.js file under tests/unit and tests/integration in a
 * child process and fails on any of:
 *   - non-zero exit code
 *   - unhandled exceptions / promise rejections surfaced on stderr
 *   - "Cannot find module" require failures
 *   - a visible "❌ FAIL" or "FAIL:" marker emitted by the test itself
 *
 * Scope: these are characterization (inline-logic) tests. Real provider
 * coverage lives in tests/extension-host — see tests/README.md.
 */
/* eslint-env node */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
};

// Patterns that indicate a test silently swallowed a real failure. Kept tight
// so "expected negative" markers (e.g. "❌ No description found" in a test
// verifying that the parser ignores the wrong case) don't trip a false fail.
const FAIL_PATTERNS = [
  /Cannot find module/i,
  /UnhandledPromiseRejectionWarning/i,
  /Unhandled (?:promise )?rejection:/i,
  /^\s*❌\s+(?:FAIL|ERROR)\b/m,
  /^\s*FAIL:/m,
];

const testTypeFilter = process.argv[2]; // 'unit' | 'integration' | undefined
const testDirectories = [
  { path: path.join(__dirname, 'unit'), type: 'unit' },
  { path: path.join(__dirname, 'integration'), type: 'integration' },
];

const testFiles = testDirectories
  .flatMap((dir) => {
    if (!fs.existsSync(dir.path)) return [];
    return fs
      .readdirSync(dir.path)
      .filter((f) => f.endsWith('.test.js'))
      .map((f) => ({ path: path.join(dir.path, f), type: dir.type }));
  })
  .filter((f) => !testTypeFilter || f.type === testTypeFilter)
  .sort((a, b) => a.path.localeCompare(b.path));

console.log(`${colors.cyan}=== GitLab Component Helper Tests ===${colors.reset}\n`);
const scope = testTypeFilter ? ` (${testTypeFilter} only)` : '';
console.log(`${colors.blue}Found ${testFiles.length} test file(s)${scope}:${colors.reset}`);
testFiles.forEach((f) => {
  console.log(`  - ${path.relative(__dirname, f.path)} (${f.type})`);
});
console.log();

function runTest(testFile) {
  const name = path.basename(testFile.path);
  const captured = { stdout: '', stderr: '' };

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [testFile.path], {
      cwd: path.dirname(testFile.path),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      captured.stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      captured.stderr += chunk.toString();
    });

    child.on('error', (err) => {
      resolve({ name, passed: false, reason: `spawn error: ${err.message}` });
    });

    child.on('close', (code) => {
      if (code !== 0) {
        resolve({ name, passed: false, reason: `exit code ${code}` });
        return;
      }
      const combined = `${captured.stdout}\n${captured.stderr}`;
      const matched = FAIL_PATTERNS.find((p) => p.test(combined));
      if (matched) {
        resolve({
          name,
          passed: false,
          reason: `matched failure pattern ${matched} in output`,
        });
        return;
      }
      resolve({ name, passed: true });
    });
  });
}

(async () => {
  const results = [];
  for (const f of testFiles) {
    console.log(`${colors.yellow}Running ${path.basename(f.path)}...${colors.reset}`);
    const result = await runTest(f);
    results.push(result);
    if (result.passed) {
      console.log(`${colors.green}✅ ${result.name}${colors.reset}\n`);
    } else {
      console.log(`${colors.red}❌ ${result.name} — ${result.reason}${colors.reset}\n`);
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  console.log(`${colors.cyan}=== Test Summary ===${colors.reset}`);
  console.log(`Total: ${results.length}`);
  console.log(`${colors.green}Passed: ${passed}${colors.reset}`);
  if (failed > 0) {
    console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
    results
      .filter((r) => !r.passed)
      .forEach((r) => console.log(`  - ${r.name}: ${r.reason}`));
    process.exit(1);
  }
  console.log(`\n${colors.green}🎉 All tests passed!${colors.reset}`);
  process.exit(0);
})().catch((err) => {
  console.error(`${colors.red}Runner error: ${err?.stack || err}${colors.reset}`);
  process.exit(1);
});
