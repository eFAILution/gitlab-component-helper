#!/usr/bin/env node
/**
 * Test template parsing logic for GitLab CI/CD components
 * Ensures the parser properly stops at the '---' separator
 */

/**
 * Test the template parsing logic that extracts component inputs from template files
 */
function testTemplateParsing() {
  console.log('🧪 Testing GitLab Component Template Parsing');
  console.log('='.repeat(50));

  const testCases = [
    {
      name: 'Component with spec separator',
      template: `spec:
  inputs:
    environment:
      description: "Target environment"
      default: "development"
      type: "string"
    debug:
      description: "Enable debug mode"
      default: false
      type: "boolean"
---
deploy-job:
  stage: deploy
  variables:
    ENV_VAR: "should not be parsed"
    ANOTHER_VAR: "also should not be parsed"
  script:
    - echo "Deploying to \$[[ inputs.environment ]]"
  after_script:
    - echo "Cleanup"`,
      expected: {
        inputCount: 2,
        inputs: [
          { name: 'environment', type: 'string', default: 'development' },
          { name: 'debug', type: 'boolean', default: 'false' }
        ],
        shouldNotInclude: ['ENV_VAR', 'ANOTHER_VAR', 'script', 'after_script']
      }
    },
    {
      name: 'Component without separator (legacy format)',
      template: `spec:
  inputs:
    version:
      description: "Version to deploy"
      default: "latest"
variables:
  LEGACY_VAR: "value"
deploy:
  script: echo "deploying"`,
      expected: {
        inputCount: 1,
        inputs: [
          { name: 'version', type: 'string', default: 'latest' }
        ],
        shouldNotInclude: ['LEGACY_VAR', 'script']
      }
    },
    {
      name: 'Component with variables in job section',
      template: `spec:
  inputs:
    stage:
      default: test
---
component-job:
  script: echo job 1
  stage: \$[[ inputs.stage ]]
  variables:
    JOB_VAR: "should not be extracted"
    ANOTHER_JOB_VAR: "also should not be extracted"
    CI_DEBUG_TRACE: true`,
      expected: {
        inputCount: 1,
        inputs: [
          { name: 'stage', default: 'test' }
        ],
        shouldNotInclude: ['JOB_VAR', 'ANOTHER_JOB_VAR', 'CI_DEBUG_TRACE', 'script']
      }
    }
  ];

  let passed = 0;
  let failed = 0;

  testCases.forEach((testCase, index) => {
    console.log(`\nTest ${index + 1}: ${testCase.name}`);
    console.log('-'.repeat(30));

    try {
      // Simulate the parsing logic from fetchTemplateContent
      const content = testCase.template;
      let extractedVariables = [];

      // Split content by the GitLab component spec separator '---'
      const parts = content.split(/^---\s*$/m);
      const specSection = parts[0] || '';

      console.log(`Found ${parts.length} sections (spec + jobs)`);
      console.log(`Spec section length: ${specSection.length} chars`);

      // Extract variables from GitLab CI/CD component spec format - ONLY from spec section
      const specMatches = specSection.match(/spec:\s*\n\s*inputs:([\s\S]*?)(?=\n---|\ndescription:|\nvariables:|\n[a-zA-Z][a-zA-Z0-9_-]*:|$)/);
      if (specMatches) {
        console.log('Found spec inputs section');

        // Parse component spec format
        const inputsSection = specMatches[1];
        const inputLines = inputsSection.split('\n')
          .filter(line => line.trim() && !line.trim().startsWith('#'));

        let currentInput = null;

        for (const line of inputLines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          // Stop if we hit a top-level key (indicating we've left the inputs section)
          if (line.match(/^[a-zA-Z][a-zA-Z0-9_-]*:/)) {
            console.log(`Stopping at top-level key: ${trimmedLine}`);
            break;
          }

          // New input parameter (indented under inputs)
          if (line.match(/^\s{4}[a-zA-Z_][a-zA-Z0-9_]*:/) || line.match(/^\s{2}[a-zA-Z_][a-zA-Z0-9_]*:/)) {
            if (currentInput) {
              extractedVariables.push(currentInput);
            }
            const inputName = trimmedLine.split(':')[0];
            currentInput = {
              name: inputName,
              description: `Parameter: ${inputName}`,
              required: false,
              type: 'string',
              default: undefined
            };
            console.log(`Found input parameter: ${inputName}`);
          }
          // Property of current input (more deeply indented)
          else if (currentInput && line.match(/^\s{6,}/)) {
            if (trimmedLine.startsWith('description:')) {
              currentInput.description = trimmedLine.substring(12).replace(/['"]/g, '').trim();
            } else if (trimmedLine.startsWith('default:')) {
              currentInput.default = trimmedLine.substring(8).replace(/['"]/g, '').trim();
            } else if (trimmedLine.startsWith('type:')) {
              currentInput.type = trimmedLine.substring(5).replace(/['"]/g, '').trim();
            }
          }
        }

        // Add the last input
        if (currentInput) {
          extractedVariables.push(currentInput);
        }
      } else {
        console.log('No spec inputs found, trying fallback parsing');

        // Fallback to old format for backward compatibility - also only in spec section
        // Look for variables section that's ONLY within the spec section
        const variableMatches = specSection.match(/spec:\s*[\s\S]*?variables:([\s\S]*?)(?=\n[a-zA-Z][a-zA-Z0-9_-]*:|$)/);
        if (variableMatches) {
          console.log('Found variables section in spec for fallback parsing');
          const variableSection = variableMatches[1];
          const varLines = variableSection.split('\n').slice(0); // Don't skip first line since we captured just the content

          extractedVariables = varLines
            .filter(line => {
              const trimmed = line.trim();
              // Only include properly indented variable definitions
              return trimmed &&
                     line.match(/^\s{2,}/) && // Must be indented
                     trimmed.includes(':') &&
                     !trimmed.startsWith('#') &&
                     !line.match(/^[a-zA-Z][a-zA-Z0-9_-]*:/); // Not a top-level key
            })
            .map(line => {
              const parts = line.trim().split(':');
              const varName = parts[0].trim();
              const defaultValue = parts.slice(1).join(':').trim();

              return {
                name: varName,
                description: `Parameter: ${varName}`,
                required: false,
                type: 'string',
                default: defaultValue || undefined
              };
            });

          console.log(`Extracted ${extractedVariables.length} variables from fallback parsing`);
        } else {
          console.log('No variables found in fallback parsing');
        }
      }

      // Validate results
      const actualInputCount = extractedVariables.length;
      const expectedInputCount = testCase.expected.inputCount;

      console.log(`Extracted ${actualInputCount} inputs (expected: ${expectedInputCount})`);

      let testPassed = true;

      // Check input count
      if (actualInputCount !== expectedInputCount) {
        console.log(`❌ Input count mismatch: got ${actualInputCount}, expected ${expectedInputCount}`);
        testPassed = false;
      }

      // Check specific inputs
      testCase.expected.inputs.forEach(expectedInput => {
        const actualInput = extractedVariables.find(v => v.name === expectedInput.name);
        if (!actualInput) {
          console.log(`❌ Missing expected input: ${expectedInput.name}`);
          testPassed = false;
        } else {
          if (expectedInput.type && actualInput.type !== expectedInput.type) {
            console.log(`❌ Input ${expectedInput.name} type mismatch: got ${actualInput.type}, expected ${expectedInput.type}`);
            testPassed = false;
          }
          if (expectedInput.default !== undefined && actualInput.default !== expectedInput.default) {
            console.log(`❌ Input ${expectedInput.name} default mismatch: got ${actualInput.default}, expected ${expectedInput.default}`);
            testPassed = false;
          }
        }
      });

      // Check that unwanted variables are NOT included
      testCase.expected.shouldNotInclude.forEach(unwantedVar => {
        const foundUnwanted = extractedVariables.find(v => v.name === unwantedVar);
        if (foundUnwanted) {
          console.log(`❌ Unwanted variable found: ${unwantedVar} (should be excluded from job section)`);
          testPassed = false;
        }
      });

      if (testPassed) {
        console.log('✅ PASS');
        passed++;
      } else {
        console.log('❌ FAIL');
        failed++;
      }

      // Log extracted variables for debugging
      if (extractedVariables.length > 0) {
        console.log('Extracted variables:');
        extractedVariables.forEach(v => {
          console.log(`  - ${v.name}: ${v.type || 'string'} = ${v.default || 'undefined'}`);
        });
      }

    } catch (error) {
      console.log(`❌ FAIL - Error: ${error.message}`);
      failed++;
    }
  });

  console.log(`\n${'='.repeat(50)}`);
  console.log('📊 Template Parsing Test Summary');
  console.log(`Total tests: ${testCases.length}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ${failed > 0 ? '❌' : ''}`);
  console.log(`Success rate: ${Math.round((passed / testCases.length) * 100)}%`);

  return failed === 0;
}

// Run the test if this file is executed directly
if (require.main === module) {
  testTemplateParsing();
}

module.exports = { testTemplateParsing };
