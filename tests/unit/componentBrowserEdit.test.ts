// @mocha
/**
 * Tests src/providers/componentBrowserEdit.ts — locating a `- component:` block in a `.gitlab-ci.yml` and parsing
 * its existing inputs.
 *
 * The provider wraps `findComponentLineRange`'s `{ startLine, endLine, endColumn }` in a `vscode.Range`, and feeds
 * the slice of document text into `parseExistingComponentText`. Both helpers are pure string + YAML work, so they're
 * exercised directly here.
 */

import * as assert from 'node:assert/strict';
import {
  findComponentLineRange,
  parseExistingComponentText,
} from '../../src/providers/componentBrowserEdit';

suite('findComponentLineRange', () => {
  test('isolates the middle component in a multi-include list', () => {
    const yaml = [
      'include:',
      '  - component: https://gitlab.example.com/group/project/first-component@v1.0.0',
      '    inputs:',
      '      param1: value1',
      '  - component: https://gitlab.example.com/group/project/target-component@v2.0.0',
      '    inputs:',
      '      param2: value2',
      '      param3: value3',
      '  - component: https://gitlab.example.com/group/project/last-component@v1.5.0',
      '    inputs:',
      '      param4: value4',
    ].join('\n');

    const range = findComponentLineRange(yaml, 4, 'target-component');

    assert.ok(range, 'expected a range');
    assert.strictEqual(range.startLine, 4);
    assert.strictEqual(range.endLine, 7);
  });

  test('extends the last component to end-of-file when no sibling follows', () => {
    const yaml = [
      'include:',
      '  - component: https://gitlab.example.com/group/project/first-component@v1.0.0',
      '    inputs:',
      '      param1: value1',
      '  - component: https://gitlab.example.com/group/project/last-component@v2.0.0',
      '    inputs:',
      '      param2: value2',
      '      param3: value3',
    ].join('\n');

    const range = findComponentLineRange(yaml, 4, 'last-component');

    assert.ok(range);
    assert.strictEqual(range.startLine, 4);
    assert.strictEqual(range.endLine, 7);
  });

  test('trims trailing blank lines before the next sibling', () => {
    const yaml = [
      'include:',
      '  - component: https://gitlab.example.com/group/project/target-component@v1.0.0',
      '    inputs:',
      '      param1: value1',
      '      param2: value2',
      '',
      '',
      '  - component: https://gitlab.example.com/group/project/next-component@v1.0.0',
    ].join('\n');

    const range = findComponentLineRange(yaml, 1, 'target-component');

    assert.ok(range);
    assert.strictEqual(range.startLine, 1);
    assert.strictEqual(range.endLine, 4, 'blank lines must not be part of the range');
  });

  test('returns null when no component line matches the name within the search window', () => {
    const yaml = [
      'include:',
      '  - component: https://gitlab.example.com/group/project/some-component@v1.0.0',
    ].join('\n');

    assert.strictEqual(findComponentLineRange(yaml, 1, 'unknown-component'), null);
  });

  test('endColumn equals the length of the last line', () => {
    const yaml = [
      'include:',
      '  - component: https://gitlab.example.com/group/project/c@v1.0.0',
      '    inputs:',
      '      foo: bar',
    ].join('\n');

    const range = findComponentLineRange(yaml, 1, 'c@v1.0.0');

    assert.ok(range);
    assert.strictEqual(range.endLine, 3);
    assert.strictEqual(range.endColumn, '      foo: bar'.length);
  });
});

suite('parseExistingComponentText', () => {
  // NOTE: assertions match real YAML-parser behaviour — booleans become `true`/`false`, numbers become numbers,
  // strings stay strings. The legacy `.js` mock did everything as strings (its scanner stripped quotes
  // but didn't type-coerce), so its assertions like `inputs.debug_mode === 'true'` were lying about production.
  test('parses inputs with quoted strings, bare booleans, and bare numbers using their YAML types', () => {
    const componentYaml = [
      '  - component: https://gitlab.example.com/group/project/test-component@v1.0.0',
      '    inputs:',
      '      database_url: "postgres://localhost:5432/test"',
      '      debug_mode: true',
      '      max_connections: 100',
    ].join('\n');

    const parsed = parseExistingComponentText(componentYaml) as {
      component: string;
      inputs: { database_url: unknown; debug_mode: unknown; max_connections: unknown };
    };

    assert.ok(parsed, 'expected a parsed include node');
    assert.strictEqual(parsed.component, 'https://gitlab.example.com/group/project/test-component@v1.0.0');
    assert.strictEqual(parsed.inputs.database_url, 'postgres://localhost:5432/test');
    assert.strictEqual(parsed.inputs.debug_mode, true);
    assert.strictEqual(parsed.inputs.max_connections, 100);
  });

  test('returns the lone include when the YAML produces a single object (not an array)', () => {
    // Real-world `.gitlab-ci.yml` always has `include:` as an array, but the helper guards against the scalar shape
    // by returning the node verbatim.
    const componentYaml = '  - component: https://gitlab.com/group/project/just-one@v1.0.0';
    const parsed = parseExistingComponentText(componentYaml) as { component: string };
    assert.ok(parsed);
    assert.strictEqual(parsed.component, 'https://gitlab.com/group/project/just-one@v1.0.0');
  });

  test('returns null for malformed YAML', () => {
    const broken = '  - component: "unterminated\n    inputs:\n      foo: bar';
    assert.strictEqual(parseExistingComponentText(broken), null);
  });

  test('returns null when no include entry can be extracted', () => {
    // Wrapping `something_else: foo` in `include:\n…` yields `include: something_else: foo` which the parser
    // refuses to coerce into an include array — returning null is the safe default.
    assert.strictEqual(parseExistingComponentText(''), null);
  });
});
