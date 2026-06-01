// @mocha
/**
 * Tests src/providers/componentBrowserGenerate.ts — the YAML-snippet builder the Component Browser uses when the
 * user confirms an "Add" or "Edit" of a component include.
 *
 * Covers URL construction (standard form, originalUrl-with-variables shortcut, version reattachment), the inputs
 * section's three modes (no inputs, all inputs, selected only), value resolution against `existingComponent.inputs`,
 * and type-and-required-aware default placeholders.
 */

import * as assert from 'node:assert/strict';
import { generateComponentText } from '../../src/providers/componentBrowserGenerate';

suite('generateComponentText — URL construction', () => {
  test('builds a standard URL from gitlabInstance + sourcePath + name + version', () => {
    const result = generateComponentText(
      {
        name: 'basic-component',
        version: 'v1.0.0',
        sourcePath: 'group/project',
        gitlabInstance: 'gitlab.com',
        parameters: [],
      },
      false,
    );
    assert.strictEqual(result, '  - component: https://gitlab.com/group/project/basic-component@v1.0.0');
  });

  test('falls back to "gitlab.com" when gitlabInstance is missing', () => {
    const result = generateComponentText(
      { name: 'c', version: 'v1', sourcePath: 'group/project', parameters: [] },
      false,
    );
    assert.strictEqual(result, '  - component: https://gitlab.com/group/project/c@v1');
  });

  test('prefers originalUrl when it contains a bare GitLab variable, appending @version', () => {
    // `containsGitLabVariables` only recognises bare `$VAR` forms (e.g. `$CI_SERVER_FQDN`). The braced `${VAR}` form
    // valid in shell scripts is NOT matched — captured here as a regression guard.
    const result = generateComponentText(
      {
        name: 'variable-url-component',
        version: 'v1.0.0',
        sourcePath: 'group/project',
        gitlabInstance: 'gitlab.com',
        originalUrl: 'https://$CI_SERVER_FQDN/group/variable-url-component',
        parameters: [],
      },
      false,
    );
    assert.strictEqual(
      result,
      '  - component: https://$CI_SERVER_FQDN/group/variable-url-component@v1.0.0',
    );
  });

  test('replaces an existing trailing @version on originalUrl when it has GitLab variables', () => {
    const result = generateComponentText(
      {
        name: 'c',
        version: 'v2.0.0',
        sourcePath: 'group/project',
        gitlabInstance: 'gitlab.com',
        originalUrl: 'https://$CI_SERVER_FQDN/group/c@v1.0.0',
        parameters: [],
      },
      false,
    );
    assert.strictEqual(result, '  - component: https://$CI_SERVER_FQDN/group/c@v2.0.0');
  });

  test('IGNORES originalUrl when it has no GitLab variables (falls back to standard URL)', () => {
    // Catches a divergence between the legacy mock and the real implementation: the mock unconditionally used
    // originalUrl, but production only honours it when it contains `${…}` so a stale cache entry can't override the
    // canonical URL on round-trip.
    const result = generateComponentText(
      {
        name: 'c',
        version: 'v1.0.0',
        sourcePath: 'group/project',
        gitlabInstance: 'gitlab.com',
        originalUrl: 'https://gitlab.com/old-namespace/c@v0.9.0',
        parameters: [],
      },
      false,
    );
    assert.strictEqual(result, '  - component: https://gitlab.com/group/project/c@v1.0.0');
  });
});

suite('generateComponentText — inputs section (includeInputs)', () => {
  test('emits no inputs section when includeInputs is false and no selection is supplied', () => {
    const result = generateComponentText(
      {
        name: 'c',
        version: 'v1',
        sourcePath: 'g/p',
        gitlabInstance: 'gitlab.com',
        parameters: [{ name: 'foo', type: 'string', default: 'bar' }],
      },
      false,
    );
    assert.ok(!result.includes('inputs:'), `expected no inputs block; got:\n${result}`);
  });

  test('emits every parameter with includeInputs=true, using type-aware placeholders and defaults', () => {
    const result = generateComponentText(
      {
        name: 'p',
        version: 'v1.0.0',
        sourcePath: 'g/p',
        gitlabInstance: 'gitlab.com',
        parameters: [
          { name: 'environment', required: true, type: 'string' },
          { name: 'debug', required: false, type: 'boolean', default: false },
          { name: 'timeout', required: false, type: 'number', default: 30 },
          { name: 'config', required: false, type: 'string', default: 'default' },
        ],
      },
      true,
    );

    assert.ok(result.includes('component: https://gitlab.com/g/p/p@v1.0.0'));
    assert.ok(result.includes('inputs:'));
    assert.ok(result.includes('environment: "TODO: set value" # required'), result);
    assert.ok(result.includes('debug: false # optional'), result);
    assert.ok(result.includes('timeout: 30 # optional'), result);
    assert.ok(result.includes('config: "default" # optional'), result);
  });

  test('uses type-and-required-aware placeholders when no default is declared', () => {
    const result = generateComponentText(
      {
        name: 'p',
        version: 'v1',
        sourcePath: 'g/p',
        gitlabInstance: 'gitlab.com',
        parameters: [
          { name: 'required_string', required: true, type: 'string' },
          { name: 'required_bool', required: true, type: 'boolean' },
          { name: 'required_number', required: true, type: 'number' },
          { name: 'optional_string', required: false, type: 'string' },
          { name: 'optional_bool', required: false, type: 'boolean' },
          { name: 'optional_number', required: false, type: 'number' },
        ],
      },
      true,
    );

    assert.ok(result.includes('required_string: "TODO: set value" # required'), result);
    assert.ok(result.includes('required_bool: true # required'), result);
    assert.ok(result.includes('required_number: 0 # required'), result);
    assert.ok(result.includes('optional_string: "" # optional'), result);
    assert.ok(result.includes('optional_bool: false # optional'), result);
    assert.ok(result.includes('optional_number: 0 # optional'), result);
  });

  test('preserves GitLab variable defaults verbatim inside quotes', () => {
    const result = generateComponentText(
      {
        name: 'p',
        version: 'v1',
        sourcePath: 'g/p',
        gitlabInstance: 'gitlab.com',
        parameters: [
          { name: 'project_path', required: false, type: 'string', default: '${CI_PROJECT_PATH}' },
          { name: 'commit_sha', required: false, type: 'string', default: '${CI_COMMIT_SHA}' },
          { name: 'normal_var', required: false, type: 'string', default: 'normal_value' },
        ],
      },
      true,
    );

    assert.ok(result.includes('project_path: "${CI_PROJECT_PATH}" # optional'), result);
    assert.ok(result.includes('commit_sha: "${CI_COMMIT_SHA}" # optional'), result);
    assert.ok(result.includes('normal_var: "normal_value" # optional'), result);
  });

  test('JSON-stringifies object and array defaults', () => {
    const result = generateComponentText(
      {
        name: 'p',
        version: 'v1',
        sourcePath: 'g/p',
        gitlabInstance: 'gitlab.com',
        parameters: [
          { name: 'json_config', type: 'string', default: { key: 'value', nested: { prop: 123 } } },
          { name: 'array_config', type: 'string', default: ['item1', 'item2'] },
        ],
      },
      true,
    );

    assert.ok(result.includes('json_config: {"key":"value","nested":{"prop":123}}'), result);
    assert.ok(result.includes('array_config: ["item1","item2"]'), result);
  });
});

suite('generateComponentText — selectedInputs', () => {
  test('emits only selected parameters in the inputs block', () => {
    const result = generateComponentText(
      {
        name: 'c',
        version: 'v1',
        sourcePath: 'g/p',
        gitlabInstance: 'gitlab.com',
        parameters: [
          { name: 'environment', required: true, type: 'string' },
          { name: 'debug', required: false, type: 'boolean', default: false },
          { name: 'region', required: false, type: 'string', default: 'us-east-1' },
        ],
      },
      true,
      ['environment', 'region'],
    );

    assert.ok(result.includes('environment: "TODO: set value" # required'), result);
    assert.ok(result.includes('region: "us-east-1" # optional'), result);
    assert.ok(!result.includes('debug:'), 'unselected param leaked into inputs');

    const inputLines = result.split('\n').filter((l) => l.includes(': ') && l.includes('#'));
    assert.strictEqual(inputLines.length, 2);
  });

  test('still emits an inputs section when includeInputs is false but selectedInputs is non-empty', () => {
    const result = generateComponentText(
      {
        name: 'c',
        version: 'v1',
        sourcePath: 'g/p',
        gitlabInstance: 'gitlab.com',
        parameters: [
          { name: 'param1', type: 'string', default: 'value1' },
          { name: 'param2', type: 'string', default: 'value2' },
        ],
      },
      false,
      ['param1'],
    );

    assert.ok(result.includes('inputs:'), result);
    assert.ok(result.includes('param1: "value1"'), result);
    assert.ok(!result.includes('param2:'), 'unselected param leaked into inputs');
  });
});

suite('generateComponentText — existingComponent (edit flow)', () => {
  test('preserves existing input values verbatim and drops unselected ones', () => {
    const result = generateComponentText(
      {
        name: 'existing-component',
        version: 'v2.0.0',
        sourcePath: 'group/project',
        gitlabInstance: 'gitlab.com',
        parameters: [
          { name: 'environment', required: true, type: 'string' },
          { name: 'debug', required: false, type: 'boolean', default: false },
          { name: 'new_param', required: false, type: 'string', default: 'new_value' },
        ],
      },
      true,
      ['environment', 'new_param'],
      {
        inputs: {
          environment: 'production',
          debug: true,
          old_param: 'keep_me',
        },
      },
    );

    assert.ok(result.includes('environment: production # required'), result);
    assert.ok(result.includes('new_param: "new_value" # optional'), result);
    assert.ok(!result.includes('debug:'), 'unselected existing param leaked');
    assert.ok(!result.includes('old_param:'), 'unselected old-but-existing param leaked');
  });
});
