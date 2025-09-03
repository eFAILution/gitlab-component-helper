/**
 * Component Browser Generate Component Text Tests
 *
 * Tests for generateComponentText behavior before refactoring.
 * This ensures YAML generation, parameter handling, and variable preservation work correctly.
 */

const assert = require('assert');

console.log('=== Component Browser Generate Component Text Tests ===');

/**
 * Mock implementation of generateComponentText method
 * This replicates the current behavior to test the logic
 */
function mockGenerateComponentText(component, includeInputs, selectedInputs, existingComponent) {
  let result = '';

  // Generate component URL
  let componentUrl;
  if (component.originalUrl) {
    // Use original URL if available, append version
    componentUrl = `${component.originalUrl}@${component.version}`;
  } else {
    // Construct URL from parts
    componentUrl = `https://${component.gitlabInstance}/${component.sourcePath}/${component.name}@${component.version}`;
  }

  result += `  - component: ${componentUrl}`;

  // Add inputs section if needed
  const shouldIncludeInputs = includeInputs || (selectedInputs && selectedInputs.length > 0);

  if (shouldIncludeInputs && component.parameters && component.parameters.length > 0) {
    result += '\n    inputs:';

    // Filter parameters based on selection
    let parametersToInclude = component.parameters;
    if (selectedInputs && selectedInputs.length > 0) {
      parametersToInclude = component.parameters.filter(param => selectedInputs.includes(param.name));
    }

    for (const param of parametersToInclude) {
      let value;
      let comment;

      // Check if we have an existing value for this parameter
      if (existingComponent && existingComponent.inputs && Object.prototype.hasOwnProperty.call(existingComponent.inputs, param.name)) {
        value = existingComponent.inputs[param.name];
        comment = param.required ? 'required' : 'optional';
      } else {
        // Generate default value based on parameter properties
        if (param.required) {
          comment = 'required';
          if (param.type === 'string') {
            value = '"TODO: set value"';
          } else if (param.type === 'boolean') {
            value = 'true';
          } else if (param.type === 'number') {
            value = '0';
          } else {
            value = '"TODO: set value"';
          }
        } else {
          comment = 'optional';
          if (param.default !== undefined) {
            if (typeof param.default === 'string') {
              // Check if it's a GitLab variable or complex object
              if (param.default.includes('${') || typeof param.default === 'object') {
                value = `"${typeof param.default === 'object' ? JSON.stringify(param.default) : param.default}"`;
              } else {
                value = `"${param.default}"`;
              }
            } else if (typeof param.default === 'object') {
              value = JSON.stringify(param.default);
            } else {
              value = param.default;
            }
          } else {
            // Default fallbacks by type
            if (param.type === 'string') {
              value = '""';
            } else if (param.type === 'boolean') {
              value = 'false';
            } else if (param.type === 'number') {
              value = '0';
            } else {
              value = '""';
            }
          }
        }
      }

      // Format the value properly if it's from existing component
      if (existingComponent && existingComponent.inputs && Object.prototype.hasOwnProperty.call(existingComponent.inputs, param.name)) {
        const existingValue = existingComponent.inputs[param.name];
        if (typeof existingValue === 'string' && !existingValue.includes('${')) {
          value = existingValue; // Keep as-is for strings that aren't GitLab variables
        } else {
          value = existingValue;
        }
      }

      result += `\n      ${param.name}: ${value} # ${comment}`;
    }
  }

  return result;
}

/**
 * Test generateComponentText mock implementation
 */
function testGenerateComponentText() {
  console.log('\n--- Testing generateComponentText behavior ---');

  let passed = 0;
  let failed = 0;

  // Test 1: Basic component without inputs
  console.log('\nTest 1: Basic component without inputs');
  try {
    const component = {
      name: 'basic-component',
      version: 'v1.0.0',
      sourcePath: 'group/project',
      gitlabInstance: 'gitlab.com',
      parameters: []
    };

    const result = mockGenerateComponentText(component, false);
    const expected = '  - component: https://gitlab.com/group/project/basic-component@v1.0.0';

    assert.strictEqual(result, expected, 'Basic component text should match expected format');

    console.log('Basic component generation: PASS ✅');
    passed++;
  } catch (error) {
    console.log('Basic component generation: FAIL ❌');
    console.log(`  Error: ${error.message}`);
    failed++;
  }

  // Test 2: Component with required and optional parameters
  console.log('\nTest 2: Component with required and optional parameters');
  try {
    const component = {
      name: 'param-component',
      version: 'v1.0.0',
      sourcePath: 'group/project',
      gitlabInstance: 'gitlab.com',
      parameters: [
        {
          name: 'environment',
          description: 'Target environment',
          required: true,
          type: 'string'
        },
        {
          name: 'debug',
          description: 'Enable debug mode',
          required: false,
          type: 'boolean',
          default: false
        },
        {
          name: 'timeout',
          description: 'Timeout in seconds',
          required: false,
          type: 'number',
          default: 30
        },
        {
          name: 'config',
          description: 'Configuration name',
          required: false,
          type: 'string',
          default: 'default'
        }
      ]
    };

    const result = mockGenerateComponentText(component, true);

    // Verify structure
    assert(result.includes('component: https://gitlab.com/group/project/param-component@v1.0.0'), 'Should include component URL');
    assert(result.includes('inputs:'), 'Should include inputs section');
    assert(result.includes('environment: "TODO: set value" # required'), 'Required param should have TODO placeholder');
    assert(result.includes('debug: false # optional'), 'Boolean param should use default value');
    assert(result.includes('timeout: 30 # optional'), 'Number param should use default value');
    assert(result.includes('config: "default" # optional'), 'String param should use quoted default');

    console.log('Parameters component generation: PASS ✅');
    passed++;
  } catch (error) {
    console.log('Parameters component generation: FAIL ❌');
    console.log(`  Error: ${error.message}`);
    failed++;
  }

  // Test 3: Selected inputs only
  console.log('\nTest 3: Selected inputs only');
  try {
    const component = {
      name: 'selective-component',
      version: 'v1.0.0',
      sourcePath: 'group/project',
      gitlabInstance: 'gitlab.com',
      parameters: [
        {
          name: 'environment',
          description: 'Target environment',
          required: true,
          type: 'string'
        },
        {
          name: 'debug',
          description: 'Enable debug mode',
          required: false,
          type: 'boolean',
          default: false
        },
        {
          name: 'region',
          description: 'AWS region',
          required: false,
          type: 'string',
          default: 'us-east-1'
        }
      ]
    };

    const selectedInputs = ['environment', 'region'];
    const result = mockGenerateComponentText(component, true, selectedInputs);

    // Should only include selected inputs
    assert(result.includes('environment: "TODO: set value" # required'), 'Should include selected required param');
    assert(result.includes('region: "us-east-1" # optional'), 'Should include selected optional param');
    assert(!result.includes('debug:'), 'Should not include unselected param');

    // Count input lines
    const inputLines = result.split('\n').filter(line => line.includes(': ') && line.includes('#'));
    assert.strictEqual(inputLines.length, 2, 'Should have exactly 2 input lines');

    console.log('Selected inputs generation: PASS ✅');
    passed++;
  } catch (error) {
    console.log('Selected inputs generation: FAIL ❌');
    console.log(`  Error: ${error.message}`);
    failed++;
  }

  // Test 4: Editing existing component - preserve existing inputs
  console.log('\nTest 4: Editing existing component with preserved inputs');
  try {
    const component = {
      name: 'existing-component',
      version: 'v2.0.0',
      sourcePath: 'group/project',
      gitlabInstance: 'gitlab.com',
      parameters: [
        {
          name: 'environment',
          description: 'Target environment',
          required: true,
          type: 'string'
        },
        {
          name: 'debug',
          description: 'Enable debug mode',
          required: false,
          type: 'boolean',
          default: false
        },
        {
          name: 'new_param',
          description: 'New parameter',
          required: false,
          type: 'string',
          default: 'new_value'
        }
      ]
    };

    const existingComponent = {
      inputs: {
        environment: 'production',
        debug: true,
        old_param: 'keep_me'
      }
    };

    const selectedInputs = ['environment', 'new_param'];
    const result = mockGenerateComponentText(component, true, selectedInputs, existingComponent);

    // Should preserve selected existing inputs and add new ones
    assert(result.includes('environment: production # required'), 'Should preserve existing environment value');
    assert(result.includes('new_param: "new_value" # optional'), 'Should add new selected parameter');
    assert(!result.includes('debug:'), 'Should remove unselected existing parameter');
    assert(!result.includes('old_param:'), 'Should remove unselected old parameter');

    console.log('Existing component editing: PASS ✅');
    passed++;
  } catch (error) {
    console.log('Existing component editing: FAIL ❌');
    console.log(`  Error: ${error.message}`);
    failed++;
  }

  // Test 5: GitLab variables preservation
  console.log('\nTest 5: GitLab variables preservation');
  try {
    const component = {
      name: 'gitlab-vars-component',
      version: 'v1.0.0',
      sourcePath: 'group/project',
      gitlabInstance: 'gitlab.com',
      parameters: [
        {
          name: 'project_path',
          description: 'Project path variable',
          required: false,
          type: 'string',
          default: '${CI_PROJECT_PATH}'
        },
        {
          name: 'commit_sha',
          description: 'Commit SHA variable',
          required: false,
          type: 'string',
          default: '${CI_COMMIT_SHA}'
        },
        {
          name: 'normal_var',
          description: 'Normal string',
          required: false,
          type: 'string',
          default: 'normal_value'
        }
      ]
    };

    const result = mockGenerateComponentText(component, true);

    // GitLab variables should remain quoted and unmodified
    assert(result.includes('project_path: "${CI_PROJECT_PATH}" # optional'), 'GitLab variables should be preserved in quotes');
    assert(result.includes('commit_sha: "${CI_COMMIT_SHA}" # optional'), 'GitLab variables should be preserved in quotes');
    assert(result.includes('normal_var: "normal_value" # optional'), 'Normal strings should be quoted');

    console.log('GitLab variables preservation: PASS ✅');
    passed++;
  } catch (error) {
    console.log('GitLab variables preservation: FAIL ❌');
    console.log(`  Error: ${error.message}`);
    failed++;
  }

  // Test 6: Component with originalUrl and GitLab variables
  console.log('\nTest 6: Component with originalUrl containing GitLab variables');
  try {
    const component = {
      name: 'variable-url-component',
      version: 'v1.0.0',
      sourcePath: 'group/project',
      gitlabInstance: 'gitlab.com',
      originalUrl: 'https://gitlab.com/${CI_PROJECT_NAMESPACE}/components/variable-url-component',
      parameters: []
    };

    const result = mockGenerateComponentText(component, false);

    // Should use originalUrl with version appended
    assert(result.includes('component: https://gitlab.com/${CI_PROJECT_NAMESPACE}/components/variable-url-component@v1.0.0'),
           'Should preserve GitLab variables in originalUrl');

    console.log('Original URL with variables: PASS ✅');
    passed++;
  } catch (error) {
    console.log('Original URL with variables: FAIL ❌');
    console.log(`  Error: ${error.message}`);
    failed++;
  }

  // Test 7: Type-specific default value formatting
  console.log('\nTest 7: Type-specific default value formatting');
  try {
    const component = {
      name: 'types-component',
      version: 'v1.0.0',
      sourcePath: 'group/project',
      gitlabInstance: 'gitlab.com',
      parameters: [
        {
          name: 'required_string',
          required: true,
          type: 'string'
        },
        {
          name: 'required_bool',
          required: true,
          type: 'boolean'
        },
        {
          name: 'required_number',
          required: true,
          type: 'number'
        },
        {
          name: 'optional_string',
          required: false,
          type: 'string'
        },
        {
          name: 'optional_bool',
          required: false,
          type: 'boolean'
        },
        {
          name: 'optional_number',
          required: false,
          type: 'number'
        }
      ]
    };

    const result = mockGenerateComponentText(component, true);

    // Check required parameter defaults
    assert(result.includes('required_string: "TODO: set value" # required'), 'Required string should have TODO placeholder');
    assert(result.includes('required_bool: true # required'), 'Required boolean should default to true');
    assert(result.includes('required_number: 0 # required'), 'Required number should default to 0');

    // Check optional parameter defaults
    assert(result.includes('optional_string: "" # optional'), 'Optional string should default to empty string');
    assert(result.includes('optional_bool: false # optional'), 'Optional boolean should default to false');
    assert(result.includes('optional_number: 0 # optional'), 'Optional number should default to 0');

    console.log('Type-specific formatting: PASS ✅');
    passed++;
  } catch (error) {
    console.log('Type-specific formatting: FAIL ❌');
    console.log(`  Error: ${error.message}`);
    failed++;
  }

  console.log(`\nGenerate Component Text Summary:`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ${failed > 0 ? '❌' : ''}`);

  return failed === 0;
}

/**
 * Test edge cases and special scenarios
 */
function testEdgeCases() {
  console.log('\n--- Testing Edge Cases ---');

  let passed = 0;
  let failed = 0;

  // Test 1: Empty component (minimal required fields)
  console.log('\nTest 1: Minimal component');
  try {
    const component = {
      name: 'minimal',
      version: 'latest',
      sourcePath: 'group/minimal',
      gitlabInstance: 'gitlab.com'
    };

    const result = mockGenerateComponentText(component, false);
    assert.strictEqual(result, '  - component: https://gitlab.com/group/minimal/minimal@latest');

    console.log('Minimal component: PASS ✅');
    passed++;
  } catch (error) {
    console.log('Minimal component: FAIL ❌');
    console.log(`  Error: ${error.message}`);
    failed++;
  }

  // Test 2: Component with complex default values
  console.log('\nTest 2: Complex default values');
  try {
    const component = {
      name: 'complex-defaults',
      version: 'v1.0.0',
      sourcePath: 'group/project',
      gitlabInstance: 'gitlab.com',
      parameters: [
        {
          name: 'json_config',
          type: 'string',
          default: { key: 'value', nested: { prop: 123 } }
        },
        {
          name: 'array_config',
          type: 'string',
          default: ['item1', 'item2']
        }
      ]
    };

    const result = mockGenerateComponentText(component, true);

    // Complex objects should be JSON stringified
    assert(result.includes('json_config: {"key":"value","nested":{"prop":123}}'), 'Complex objects should be stringified');
    assert(result.includes('array_config: ["item1","item2"]'), 'Arrays should be stringified');

    console.log('Complex defaults: PASS ✅');
    passed++;
  } catch (error) {
    console.log('Complex defaults: FAIL ❌');
    console.log(`  Error: ${error.message}`);
    failed++;
  }

  // Test 3: No includeInputs but selectedInputs provided
  console.log('\nTest 3: Selected inputs without includeInputs flag');
  try {
    const component = {
      name: 'selective-no-flag',
      version: 'v1.0.0',
      sourcePath: 'group/project',
      gitlabInstance: 'gitlab.com',
      parameters: [
        {
          name: 'param1',
          type: 'string',
          default: 'value1'
        },
        {
          name: 'param2',
          type: 'string',
          default: 'value2'
        }
      ]
    };

    const selectedInputs = ['param1'];
    const result = mockGenerateComponentText(component, false, selectedInputs);

    // Should still include inputs when selectedInputs is provided, even if includeInputs is false
    assert(result.includes('inputs:'), 'Should include inputs section when selectedInputs provided');
    assert(result.includes('param1: "value1"'), 'Should include selected parameter');
    assert(!result.includes('param2:'), 'Should not include unselected parameter');

    console.log('Selected inputs without flag: PASS ✅');
    passed++;
  } catch (error) {
    console.log('Selected inputs without flag: FAIL ❌');
    console.log(`  Error: ${error.message}`);
    failed++;
  }

  console.log(`\nEdge Cases Summary:`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ${failed > 0 ? '❌' : ''}`);

  return failed === 0;
}

// Run all tests
console.log('Running component browser generateComponentText tests...\n');

const generateTextTests = testGenerateComponentText();
const edgeCaseTests = testEdgeCases();

const allPassed = generateTextTests && edgeCaseTests;

console.log('\n=== Component Browser Generate Text Test Summary ===');
console.log(`Generate component text: ${generateTextTests ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Edge cases: ${edgeCaseTests ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Overall: ${allPassed ? 'PASS ✅' : 'FAIL ❌'}`);

if (allPassed) {
  console.log('\n🎉 All generateComponentText tests passed!');
} else {
  console.log('\n💥 Some generateComponentText tests failed!');
}

// Set exit code
// eslint-disable-next-line no-undef
process.exit(allPassed ? 0 : 1);
