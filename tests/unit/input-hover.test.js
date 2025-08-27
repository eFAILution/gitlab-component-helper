#!/usr/bin/env node
/**
 * Test component input parameter hover functionality
 * Ensures hover shows input-specific information when hovering over component inputs
 */

/**
 * Test the input hover logic
 */
function testInputHover() {
  console.log('🧪 Testing Component Input Parameter Hover');
  console.log('='.repeat(50));

  const testCases = [
    {
      name: 'Hover over component input parameter',
      yamlContent: `include:
  - component: https://gitlab.com/components/opentofu/full-pipeline@2.6.1
    inputs:
      environment: "development"
      debug: true
      version: "1.0.0"
stages:
  - build
  - test`,
      hoverLine: 3, // Line with "environment: "development"" (0-indexed)
      hoverColumn: 6, // Position on "environment"
      expectedInput: 'environment',
      expectedComponentUrl: 'https://gitlab.com/components/opentofu/full-pipeline@2.6.1'
    },
    {
      name: 'Hover over different input parameter',
      yamlContent: `include:
  - component: https://gitlab.com/components/opentofu/full-pipeline@2.6.1
    inputs:
      environment: "production"
      debug: false
      timeout: 300
stages:
  - deploy`,
      hoverLine: 4, // Line with "debug: false" (0-indexed)
      hoverColumn: 6, // Position on "debug"
      expectedInput: 'debug',
      expectedComponentUrl: 'https://gitlab.com/components/opentofu/full-pipeline@2.6.1'
    },
    {
      name: 'Hover over input with complex indentation',
      yamlContent: `include:
  - component: https://gitlab.com/my-group/my-component@v1.0.0
    inputs:
      complex_param: |
        multi-line
        value
      simple_param: "test"`,
      hoverLine: 6, // Line with "simple_param: "test"" (0-indexed)
      hoverColumn: 6, // Position on "simple_param"
      expectedInput: 'simple_param',
      expectedComponentUrl: 'https://gitlab.com/my-group/my-component@v1.0.0'
    },
    {
      name: 'Not in inputs section (should not trigger)',
      yamlContent: `include:
  - component: https://gitlab.com/components/test@1.0.0
variables:
  MY_VAR: "value"
stages:
  - build`,
      hoverLine: 3, // Line with "MY_VAR: "value"" (0-indexed)
      hoverColumn: 2, // Position on "MY_VAR"
      expectedInput: null, // Should not detect as input parameter
      expectedComponentUrl: null
    }
  ];

  let passed = 0;
  let failed = 0;

  testCases.forEach((testCase, index) => {
    console.log(`\nTest ${index + 1}: ${testCase.name}`);
    console.log('-'.repeat(30));

    try {
      // Simulate the input detection logic
      const lines = testCase.yamlContent.split('\n');
      const currentLine = lines[testCase.hoverLine];

      console.log(`Hover line ${testCase.hoverLine + 1}: "${currentLine}"`);

      // Check if current line looks like an input parameter
      const inputMatch = currentLine.match(/^(\s+)([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);

      if (testCase.expectedInput === null) {
        // We expect this NOT to be detected as an input parameter
        // This could either be because:
        // 1. The line doesn't match input parameter pattern
        // 2. The line matches pattern but isn't in an inputs section

        if (!inputMatch) {
          console.log('✅ PASS - Correctly did not detect as input parameter (no pattern match)');
          passed++;
          return;
        }

        // If pattern matches, we still need to check if it's in an inputs section
        // Continue with the rest of the logic to see if it's in an inputs section
      }

      if (!inputMatch) {
        console.log('❌ FAIL - No input parameter pattern found');
        failed++;
        return;
      }

      const inputIndent = inputMatch[1].length;
      const inputName = inputMatch[2];
      const inputValue = inputMatch[3];

      console.log(`Found input parameter: "${inputName}" with indent ${inputIndent}, value: ${inputValue}`);

      // Find closest component above this line
      let closestComponent = null;
      let closestDistance = Infinity;

      for (let i = testCase.hoverLine - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.includes('component:')) {
          const componentMatch = line.match(/component:\s*(.+?)(?:\s|$)/);
          if (componentMatch) {
            const distance = testCase.hoverLine - i;
            if (distance < closestDistance) {
              closestDistance = distance;
              closestComponent = {
                url: componentMatch[1],
                lineIndex: i
              };
            }
            break; // Take the first (closest) component found
          }
        }
      }

      if (!closestComponent) {
        console.log('❌ FAIL - No component found above input parameter');
        failed++;
        return;
      }

      console.log(`Found closest component: ${closestComponent.url} at line ${closestComponent.lineIndex + 1}`);

      // Check if we're in an inputs section
      let inInputsSection = false;
      let inputsSectionIndent = -1;

      for (let i = closestComponent.lineIndex + 1; i < testCase.hoverLine; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        if (trimmedLine === 'inputs:') {
          // Found inputs section, check indentation
          const indentMatch = line.match(/^(\s*)/);
          inputsSectionIndent = indentMatch ? indentMatch[1].length : 0;
          inInputsSection = true;
        } else if (inInputsSection && trimmedLine && !line.startsWith(' '.repeat(inputsSectionIndent + 1))) {
          // We've left the inputs section if we find a line that's not more indented
          if (trimmedLine !== '' && !trimmedLine.startsWith('#')) {
            inInputsSection = false;
          }
        }
      }

      // Additional check: the input parameter should be indented more than the inputs: line
      if (inInputsSection && inputsSectionIndent >= 0) {
        if (inputIndent <= inputsSectionIndent) {
          inInputsSection = false;
        }
      }      if (!inInputsSection) {
        if (testCase.expectedInput === null) {
          console.log('✅ PASS - Correctly did not detect input parameter (not in inputs section)');
          passed++;
        } else {
          console.log('❌ FAIL - Input parameter not found within inputs section');
          failed++;
        }
        return;
      }

      console.log('✅ Confirmed input parameter is within inputs section');

      // Validate expectations
      let testPassed = true;

      if (inputName !== testCase.expectedInput) {
        console.log(`❌ Input name mismatch: got "${inputName}", expected "${testCase.expectedInput}"`);
        testPassed = false;
      }

      if (closestComponent.url !== testCase.expectedComponentUrl) {
        console.log(`❌ Component URL mismatch: got "${closestComponent.url}", expected "${testCase.expectedComponentUrl}"`);
        testPassed = false;
      }

      if (testPassed) {
        console.log('✅ PASS');
        passed++;
      } else {
        console.log('❌ FAIL');
        failed++;
      }

    } catch (error) {
      console.log(`❌ FAIL - Error: ${error.message}`);
      failed++;
    }
  });

  console.log(`\n${'='.repeat(50)}`);
  console.log('📊 Input Hover Test Summary');
  console.log(`Total tests: ${testCases.length}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ${failed > 0 ? '❌' : ''}`);
  console.log(`Success rate: ${Math.round((passed / testCases.length) * 100)}%`);

  return failed === 0;
}

// Run the test if this file is executed directly
if (require.main === module) {
  testInputHover();
}

module.exports = { testInputHover };
