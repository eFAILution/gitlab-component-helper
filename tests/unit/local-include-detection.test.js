#!/usr/bin/env node
/**
 * Local include detection regex tests.
 *
 * Mirrors the regex used in src/providers/localComponentResolver.ts so that
 * we can characterise its behaviour without pulling in the `vscode` module.
 * If you change the regex in the source, change it here too.
 */

const REGEX = /^\s*-?\s*local:\s*["']?([^"'\s]+)["']?\s*$/;

function extractLocalIncludePath(line) {
  const match = line.match(REGEX);
  return match ? match[1] : null;
}

function runTests() {
  console.log('=== Local Include Detection Tests ===\n');

  const cases = [
    {
      name: 'quoted path with list dash',
      line: '    - local: "gitlab/templates/nx-test/template.yml"',
      expected: 'gitlab/templates/nx-test/template.yml',
    },
    {
      name: 'single-quoted path',
      line: "    - local: 'configs/build.yml'",
      expected: 'configs/build.yml',
    },
    {
      name: 'unquoted path',
      line: '    - local: gitlab/templates/nx-test/template.yml',
      expected: 'gitlab/templates/nx-test/template.yml',
    },
    {
      name: 'leading slash path',
      line: '    - local: "/gitlab/templates/nx-test/template.yml"',
      expected: '/gitlab/templates/nx-test/template.yml',
    },
    {
      name: 'no list dash (single include)',
      line: 'local: "ci/main.yml"',
      expected: 'ci/main.yml',
    },
    {
      name: 'trailing whitespace tolerated',
      line: '    - local: "ci/main.yml"   ',
      expected: 'ci/main.yml',
    },
    {
      name: 'component: line is not a local include',
      line: '    - component: $CI_SERVER_FQDN/group/comp@1.0.0',
      expected: null,
    },
    {
      name: 'project: line is not a local include',
      line: '    - project: "my-group/my-project"',
      expected: null,
    },
    {
      name: 'remote: line is not a local include',
      line: '    - remote: "https://example.com/ci.yml"',
      expected: null,
    },
    {
      name: 'empty line',
      line: '',
      expected: null,
    },
    {
      name: 'comment containing local: is ignored',
      line: '    # local: not a real include',
      expected: null,
    },
  ];

  let passed = 0;
  for (const c of cases) {
    const got = extractLocalIncludePath(c.line);
    const ok = got === c.expected;
    console.log(`  ${ok ? '✅' : '❌ FAIL'} ${c.name}`);
    if (!ok) {
      console.log(`     expected: ${JSON.stringify(c.expected)}`);
      console.log(`     got:      ${JSON.stringify(got)}`);
    } else {
      passed++;
    }
  }

  console.log(`\nTotal: ${cases.length}, Passed: ${passed}, Failed: ${cases.length - passed}`);
  if (passed !== cases.length) {
    process.exit(1);
  }
}

runTests();
