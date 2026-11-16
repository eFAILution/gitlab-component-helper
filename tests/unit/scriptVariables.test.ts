// @mocha
/**
 * Tests src/utils/scriptVariables.ts — which variables a job's shell receives from the CI file, and matching
 * user-configured names or globs.
 */

import * as assert from 'node:assert/strict';
import { isMap, parseDocument, type YAMLMap } from 'yaml';
import { collectKnownVariables, isKnownVariable } from '../../src/utils/scriptVariables';

function root(source: string): YAMLMap {
  const contents = parseDocument(source).contents;
  assert.ok(isMap(contents));
  return contents;
}

function job(topLevel: YAMLMap, name: string): YAMLMap {
  const node = topLevel.get(name, true);
  assert.ok(isMap(node));
  return node;
}

suite('collectKnownVariables', () => {
  const source = [
    'variables:',
    '  global_var: a',
    '.base:',
    '  variables:',
    '    base_var:',
    '      value: b',
    '      description: from a template',
    'build:',
    '  extends: .base',
    '  variables:',
    '    job_var: c',
    '  rules:',
    '    - if: $CI_COMMIT_TAG',
    '      variables:',
    '        rule_var: d',
    '  parallel:',
    '    matrix:',
    '      - matrix_var: [x, y]',
    'other:',
    '  variables:',
    '    other_var: e',
  ].join('\n');

  test('includes global, own, extends, rules and matrix variables for a job', () => {
    const topLevel = root(source);
    const names = collectKnownVariables(topLevel, job(topLevel, 'build'));
    assert.deepEqual([...names].sort(), ['base_var', 'global_var', 'job_var', 'matrix_var', 'rule_var']);
  });

  test('includes only global variables outside a job', () => {
    assert.deepEqual([...collectKnownVariables(root(source), undefined)], ['global_var']);
  });

  test('survives an extends cycle', () => {
    const topLevel = root('.a:\n  extends: .b\n  variables: { a_var: 1 }\n.b:\n  extends: .a\n  variables: { b_var: 1 }\n');
    assert.deepEqual([...collectKnownVariables(topLevel, job(topLevel, '.a'))].sort(), ['a_var', 'b_var']);
  });
});

suite('isKnownVariable', () => {
  test('matches collected names and configured globs', () => {
    const known = new Set(['from_file']);
    assert.equal(isKnownVariable('from_file', known, []), true);
    assert.equal(isKnownVariable('deploy_token', known, ['deploy_*']), true);
    assert.equal(isKnownVariable('unknown', known, ['deploy_*']), false);
  });
});
