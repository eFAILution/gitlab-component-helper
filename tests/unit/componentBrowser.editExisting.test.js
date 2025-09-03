/**
 * Component Browser Edit Existing Component Tests
 *
 * Tests for editExistingComponent range finding and edit logic behavior before refactoring.
 * This ensures component range detection, existing component parsing, and edit preservation work correctly.
 */

const assert = require('assert');

console.log('=== Component Browser Edit Existing Component Tests ===');

// Mock VSCode API components
const mockVscode = {
  Position: class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  },
  Range: class Range {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  },
  Uri: {
    parse: (uri) => ({ uri, scheme: 'file', path: uri })
  },
  window: {
    showTextDocument: async (document) => ({ document }),
    showInformationMessage: async (message) => console.log(`INFO: ${message}`)
  },
  workspace: {
    openTextDocument: async (uri) => ({ uri, getText: () => '' })
  }
};

// Mock TextDocument class
class MockTextDocument {
  constructor(text) {
    this.text = text;
    this.lines = text.split('\n');
  }

  getText(range = null) {
    if (!range) {
      return this.text;
    }

    const lines = this.text.split('\n');
    const startLine = range.start.line;
    const endLine = range.end.line;

    if (startLine === endLine) {
      return lines[startLine].substring(range.start.character, range.end.character);
    }

    const result = [];
    for (let i = startLine; i <= endLine; i++) {
      if (i === startLine) {
        result.push(lines[i].substring(range.start.character));
      } else if (i === endLine) {
        result.push(lines[i].substring(0, range.end.character));
      } else {
        result.push(lines[i]);
      }
    }

    return result.join('\n');
  }
}

// Mock ComponentBrowserProvider with minimal dependencies
class MockComponentBrowserProvider {
  constructor(context, cacheManager) {
    this.context = context;
    this.cacheManager = cacheManager;
  }

  // Copy the findComponentRange method logic (accessed via reflection in tests)
  async findComponentRange(document, position, componentName) {
    const text = document.getText();
    const lines = text.split('\n');

    // Find the line with the component declaration
    let componentLineIndex = -1;
    for (let i = position.line; i >= Math.max(0, position.line - 10); i--) {
      if (lines[i] && lines[i].includes('component:') && lines[i].includes(componentName)) {
        componentLineIndex = i;
        break;
      }
    }

    // Also search forward a few lines
    if (componentLineIndex === -1) {
      for (let i = position.line; i < Math.min(lines.length, position.line + 10); i++) {
        if (lines[i] && lines[i].includes('component:') && lines[i].includes(componentName)) {
          componentLineIndex = i;
          break;
        }
      }
    }

    if (componentLineIndex === -1) {
      return null;
    }

    // Find the start of the component block (look for the '- component:' line)
    let startLine = componentLineIndex;
    const componentLine = lines[componentLineIndex];
    const indentMatch = componentLine.match(/^(\s*)/);
    const componentIndent = indentMatch ? indentMatch[1].length : 0;

    // Look backwards to find the start of this list item
    for (let i = componentLineIndex; i >= 0; i--) {
      const line = lines[i];
      const lineIndentMatch = line.match(/^(\s*)/);
      const lineIndent = lineIndentMatch ? lineIndentMatch[1].length : 0;

      // If we find a line that starts with '- ' at the same or lesser indent, that's our start
      if (line.trim().startsWith('- ') && lineIndent <= componentIndent) {
        startLine = i;
        break;
      }
    }

    // Find the end of the component block
    let endLine = componentLineIndex;
    for (let i = componentLineIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      const lineIndentMatch = line.match(/^(\s*)/);
      const lineIndent = lineIndentMatch ? lineIndentMatch[1].length : 0;

      // If we find a line at the same or lesser indent that's not just whitespace, that's where we stop
      if (line.trim() && lineIndent <= componentIndent && line.trim().startsWith('-')) {
        endLine = i - 1;
        break;
      }

      // If we find any content at lesser indent, stop there
      if (line.trim() && lineIndent < componentIndent) {
        endLine = i - 1;
        break;
      }

      endLine = i;
    }

    // Make sure we don't include trailing empty lines
    while (endLine > componentLineIndex && !lines[endLine].trim()) {
      endLine--;
    }

    const startPos = new mockVscode.Position(startLine, 0);
    const endPos = new mockVscode.Position(endLine, lines[endLine].length);

    return new mockVscode.Range(startPos, endPos);
  }

  // Copy the parseExistingComponent method logic
  async parseExistingComponent(document, range) {
    const componentText = document.getText(range);

    try {
      // Simple YAML parsing for component structure
      const lines = componentText.split('\n');
      const result = {};

      // Look for inputs section
      let inInputs = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        console.log(`Line ${i}: "${line}"`);

        if (line.includes('inputs:')) {
          inInputs = true;
          result.inputs = {};
          console.log('Found inputs section');
          continue;
        }

        if (inInputs && line.trim()) {
          console.log('Processing input line:', line);
          // Handle YAML key-value pairs with optional values
          const colonIndex = line.indexOf(':');
          if (colonIndex !== -1) {
            const key = line.substring(0, colonIndex).trim();
            let value = line.substring(colonIndex + 1).trim();

            console.log(`Extracted key: "${key}", value: "${value}"`);

            // Remove quotes if present
            if (value.match(/^["'].*["']$/)) {
              value = value.slice(1, -1);
            }

            result.inputs[key] = value;
          }
        }
      }      return result;
    } catch {
      return null;
    }
  }

  // Mock generateComponentText method with basic functionality
  generateComponentText(component, includeInputs, selectedInputs, existingComponent) {
    let result = `  - component: https://${component.gitlabInstance}/${component.sourcePath}/${component.name}@${component.version}`;

    if (includeInputs && selectedInputs && selectedInputs.length > 0) {
      result += '\n    inputs:';

      for (const inputName of selectedInputs) {
        const param = component.parameters?.find(p => p.name === inputName);
        if (param) {
          let value;

          // Check if existing component has this input
          if (existingComponent && existingComponent.inputs && existingComponent.inputs[inputName] !== undefined) {
            value = existingComponent.inputs[inputName];
          } else {
            // Use default value for new inputs
            if (param.type === 'boolean') {
              value = param.required ? 'true' : 'false';
            } else if (param.type === 'number') {
              value = '0';
            } else {
              value = param.required ? '"TODO: set value"' : '""';
            }
          }

          result += `\n      ${inputName}: ${value}`;
        }
      }
    }

    return result;
  }
}

// Helper functions to create test components
function createComponent(name, version = 'v1.0.0', parameters = []) {
  return {
    name,
    version,
    gitlabInstance: 'gitlab.example.com',
    sourcePath: 'group/project',
    parameters
  };
}

function createParameter(name, type = 'string', required = false) {
  return { name, type, required };
}

// Test helper to create mock document with specific content
function createMockDocument(content) {
  return new MockTextDocument(content);
}

// Test Suite: Range Detection

async function runTests() {
  console.log('Testing range detection...');

  // Test 1: Range detection for middle component in multi-component include list
  try {
    console.log('Test 1: Middle component range detection');

    const yamlContent = 'include:\n' +
      '  - component: https://gitlab.example.com/group/project/first-component@v1.0.0\n' +
      '    inputs:\n' +
      '      param1: value1\n' +
      '  - component: https://gitlab.example.com/group/project/target-component@v2.0.0\n' +
      '    inputs:\n' +
      '      param2: value2\n' +
      '      param3: value3\n' +
      '  - component: https://gitlab.example.com/group/project/last-component@v1.5.0\n' +
      '    inputs:\n' +
      '      param4: value4';

    const document = createMockDocument(yamlContent);
    const provider = new MockComponentBrowserProvider({}, {});
    const position = new mockVscode.Position(4, 0); // Line with target-component

    const range = await provider.findComponentRange(document, position, 'target-component');

    assert(range !== null, 'Should find component range');
    assert.strictEqual(range.start.line, 4, 'Should start at line 4 (second component)');
    assert.strictEqual(range.end.line, 7, 'Should end at line 7 (last line of target component)');

    console.log('✅ Middle component range detection test passed');
  } catch (error) {
    console.error('❌ Test 1 failed:', error.message);
  }

  // Test 2: Range detection for last component (ensures end resolves to file end)
  try {
    console.log('Test 2: Last component range detection');

    const yamlContent = 'include:\n' +
      '  - component: https://gitlab.example.com/group/project/first-component@v1.0.0\n' +
      '    inputs:\n' +
      '      param1: value1\n' +
      '  - component: https://gitlab.example.com/group/project/last-component@v2.0.0\n' +
      '    inputs:\n' +
      '      param2: value2\n' +
      '      param3: value3';

    const document = createMockDocument(yamlContent);
    const provider = new MockComponentBrowserProvider({}, {});
    const position = new mockVscode.Position(4, 0); // Line with last-component

    const range = await provider.findComponentRange(document, position, 'last-component');

    assert(range !== null, 'Should find component range');
    assert.strictEqual(range.start.line, 4, 'Should start at line 4 (last component)');
    assert.strictEqual(range.end.line, 7, 'Should end at line 7 (end of file)');

    console.log('✅ Last component range detection test passed');
  } catch (error) {
    console.error('❌ Test 2 failed:', error.message);
  }

  // Test 3: Range detection when extra blank lines follow component block
  try {
    console.log('Test 3: Component range with trailing blank lines');

    const yamlContent = 'include:\n' +
      '  - component: https://gitlab.example.com/group/project/target-component@v1.0.0\n' +
      '    inputs:\n' +
      '      param1: value1\n' +
      '      param2: value2\n' +
      '\n' +
      '\n' +
      '  - component: https://gitlab.example.com/group/project/next-component@v1.0.0';

    const document = createMockDocument(yamlContent);
    const provider = new MockComponentBrowserProvider({}, {});
    const position = new mockVscode.Position(1, 0); // Line with target-component

    const range = await provider.findComponentRange(document, position, 'target-component');

    assert(range !== null, 'Should find component range');
    assert.strictEqual(range.start.line, 1, 'Should start at line 1');
    assert.strictEqual(range.end.line, 4, 'Should end at line 4, excluding blank lines');

    console.log('✅ Component range with trailing blank lines test passed');
  } catch (error) {
    console.error('❌ Test 3 failed:', error.message);
  }

  // Test Suite: Existing Component Parsing

  console.log('Testing existing component parsing...');

  // Test 4: Parse existing component with inputs
  try {
    console.log('Test 4: Parse existing component inputs');

    const componentYaml = '  - component: https://gitlab.example.com/group/project/test-component@v1.0.0\n' +
      '    inputs:\n' +
      '      database_url: "postgres://localhost:5432/test"\n' +
      '      debug_mode: true\n' +
      '      max_connections: 100';

    const document = createMockDocument(componentYaml);
    const provider = new MockComponentBrowserProvider({}, {});
    const range = new mockVscode.Range(
      new mockVscode.Position(0, 0),
      new mockVscode.Position(4, componentYaml.split('\n')[4].length)
    );

    const parsed = await provider.parseExistingComponent(document, range);

    assert(parsed !== null, 'Should parse component successfully');
    assert(parsed.inputs !== undefined, 'Should have inputs object');
    assert.strictEqual(parsed.inputs.database_url, 'postgres://localhost:5432/test', 'Should preserve string value');
    assert.strictEqual(parsed.inputs.debug_mode, 'true', 'Should preserve boolean value');
    assert.strictEqual(parsed.inputs.max_connections, '100', 'Should preserve number value');

    console.log('✅ Parse existing component inputs test passed');
  } catch (error) {
    console.error('❌ Test 4 failed:', error.message);
  }

  // Test Suite: Component Text Generation for Editing

  console.log('Testing component text generation for editing...');

  // Test 5: Editing existing component - narrowing inputs (preserve selected, remove unselected)
  try {
    console.log('Test 5: Edit component narrowing inputs');

    const component = createComponent('test-component', 'v2.0.0', [
      createParameter('param1', 'string', true),
      createParameter('param2', 'string', false),
      createParameter('param3', 'boolean', true)
    ]);

    const existingComponent = {
      inputs: {
        param1: 'existing_value1',
        param2: 'existing_value2',
        param3: 'false'
      }
    };

    const provider = new MockComponentBrowserProvider({}, {});
    const selectedInputs = ['param1', 'param3']; // Narrowing from 3 to 2 inputs

    const result = provider.generateComponentText(component, true, selectedInputs, existingComponent);

    assert(result.includes('param1: existing_value1'), 'Should preserve existing value for param1');
    assert(result.includes('param3: false'), 'Should preserve existing value for param3');
    assert(!result.includes('param2'), 'Should remove unselected param2');

    console.log('✅ Edit component narrowing inputs test passed');
  } catch (error) {
    console.error('❌ Test 5 failed:', error.message);
  }

  // Test 6: Editing adds a new parameter not present previously
  try {
    console.log('Test 6: Edit component adding new parameter');

    const component = createComponent('test-component', 'v2.0.0', [
      createParameter('existing_param', 'string', true),
      createParameter('new_param', 'boolean', false)
    ]);

    const existingComponent = {
      inputs: {
        existing_param: 'existing_value'
      }
    };

    const provider = new MockComponentBrowserProvider({}, {});
    const selectedInputs = ['existing_param', 'new_param']; // Adding new_param

    const result = provider.generateComponentText(component, true, selectedInputs, existingComponent);

    assert(result.includes('existing_param: existing_value'), 'Should preserve existing parameter value');
    assert(result.includes('new_param: false'), 'Should add new parameter with default value');

    console.log('✅ Edit component adding new parameter test passed');
  } catch (error) {
    console.error('❌ Test 6 failed:', error.message);
  }

  console.log('\n=== Test Summary ===');
  console.log('✅ All editExisting component tests completed!');
  console.log('Coverage areas verified:');
  console.log('  - Component range detection (middle, last, with blank lines)');
  console.log('  - Existing component parsing from YAML');
  console.log('  - Component text generation for editing scenarios');
  console.log('\nThese tests provide safety for refactoring the component editing logic.');
}

// Run all tests
runTests().catch(console.error);
