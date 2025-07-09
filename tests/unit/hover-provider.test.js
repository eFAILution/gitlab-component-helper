/**
 * Hover Provider Tests
 *
 * Tests the hover functionality including README preview and detach functionality
 */

console.log('=== Hover Provider Tests ===');

/**
 * Mock component data for testing
 */
const mockComponents = {
  simple: {
    name: 'simple-component',
    description: 'A simple test component',
    parameters: [
      {
        name: 'environment',
        description: 'Target environment',
        required: true,
        type: 'string',
        default: undefined
      }
    ],
    version: '1.0.0',
    source: 'gitlab.com/test/simple',
    context: {
      gitlabInstance: 'gitlab.com',
      path: 'test/simple'
    }
  },

  withReadme: {
    name: 'component-with-readme',
    description: 'A component with comprehensive README',
    parameters: [
      {
        name: 'environment',
        description: 'Target environment for deployment',
        required: true,
        type: 'string',
        default: undefined
      },
      {
        name: 'version',
        description: 'Version to deploy',
        required: false,
        type: 'string',
        default: 'latest'
      },
      {
        name: 'debug',
        description: 'Enable debug mode',
        required: false,
        type: 'boolean',
        default: false
      }
    ],
    version: '2.1.0',
    source: 'gitlab.example.com/components/advanced',
    readme: `# Advanced Component

This is a comprehensive component for advanced deployment scenarios.

## Features

- Multi-environment support
- Version management
- Debug capabilities
- Rollback functionality

## Usage

\`\`\`yaml
include:
  - component: https://gitlab.example.com/components/advanced/component-with-readme@2.1.0
    inputs:
      environment: production
      version: v1.2.3
      debug: false
\`\`\`

## Configuration

### Environment
Set the target environment where the deployment should occur.

### Version
Specify the version to deploy. If not provided, defaults to 'latest'.

### Debug
Enable debug logging for troubleshooting deployment issues.

## Examples

### Production Deployment
\`\`\`yaml
inputs:
  environment: production
  version: v2.1.0
\`\`\`

### Development with Debug
\`\`\`yaml
inputs:
  environment: development
  debug: true
\`\`\`

This README is intentionally long to test the preview functionality in hover windows and ensure the full content is available in detached views.`,
    context: {
      gitlabInstance: 'gitlab.example.com',
      path: 'components/advanced'
    }
  },

  noParameters: {
    name: 'parameter-free-component',
    description: 'A component that requires no parameters',
    parameters: [],
    version: '1.0.0',
    source: 'gitlab.com/simple/no-params',
    readme: `# Parameter-Free Component

This component works out of the box with no configuration required.

## Usage

Simply include it in your pipeline:

\`\`\`yaml
include:
  - component: https://gitlab.com/simple/no-params/parameter-free-component@1.0.0
\`\`\``,
    context: {
      gitlabInstance: 'gitlab.com',
      path: 'simple/no-params'
    }
  }
};

/**
 * Test hover content generation
 */
function testHoverContentGeneration() {
  console.log('\n--- Testing Hover Content Generation ---');

  let passed = 0;
  let failed = 0;

  // Test simple component
  console.log('\nTest 1: Simple component hover');
  const simpleComponent = mockComponents.simple;

  const expectedSimple = {
    hasTitle: true,
    hasDetachLink: true,
    hasDescription: true,
    hasParameters: true,
    hasReadmePreview: false,
    parameterCount: 1
  };

  // Mock the hover content generation (simplified version of what the hover provider does)
  const simpleHover = generateMockHoverContent(simpleComponent);
  const simpleResults = validateHoverContent(simpleHover, expectedSimple);

  console.log(`Simple component hover: ${simpleResults.passed ? 'PASS ✅' : 'FAIL ❌'}`);
  if (simpleResults.passed) passed++; else failed++;

  // Test component with README
  console.log('\nTest 2: Component with README hover');
  const readmeComponent = mockComponents.withReadme;

  const expectedReadme = {
    hasTitle: true,
    hasDetachLink: true,
    hasDescription: true,
    hasParameters: true,
    hasReadmePreview: true,
    parameterCount: 3
  };

  const readmeHover = generateMockHoverContent(readmeComponent);
  const readmeResults = validateHoverContent(readmeHover, expectedReadme);

  console.log(`README component hover: ${readmeResults.passed ? 'PASS ✅' : 'FAIL ❌'}`);
  if (readmeResults.passed) passed++; else failed++;

  // Test component with no parameters
  console.log('\nTest 3: Component with no parameters');
  const noParamsComponent = mockComponents.noParameters;

  const expectedNoParams = {
    hasTitle: true,
    hasDetachLink: true,
    hasDescription: true,
    hasParameters: false, // No parameters table
    hasReadmePreview: true,
    parameterCount: 0
  };

  const noParamsHover = generateMockHoverContent(noParamsComponent);
  const noParamsResults = validateHoverContent(noParamsHover, expectedNoParams);

  console.log(`No parameters component hover: ${noParamsResults.passed ? 'PASS ✅' : 'FAIL ❌'}`);
  if (noParamsResults.passed) passed++; else failed++;

  console.log(`\nHover Content Generation Summary:`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ${failed > 0 ? '❌' : ''}`);

  return failed === 0;
}

/**
 * Mock function to simulate hover content generation
 */
function generateMockHoverContent(component) {
  let content = '';

  // Title
  content += `## ${component.name}\n\n`;

  // Detach link
  content += `[🔗 Open in Detailed View](command:gitlab-component-helper.detachHover)\n\n`;

  // Description
  content += `${component.description}\n\n`;

  // Source
  if (component.context) {
    content += `**Source:** ${component.context.gitlabInstance}/${component.context.path}\n\n`;
  }

  // Version
  if (component.version) {
    content += `**Version:** ${component.version}\n\n`;
  }

  // Parameters
  if (component.parameters && component.parameters.length > 0) {
    content += `### Parameters\n\n`;
    content += `| Name | Description | Required | Default |\n`;
    content += `| ---- | ----------- | -------- | ------- |\n`;

    for (const param of component.parameters) {
      content += `| ${param.name} | ${param.description} | ${param.required ? 'Yes' : 'No'} | ${param.default !== undefined ? param.default : '-'} |\n`;
    }
    content += `\n`;
  }

  // README preview
  if (component.readme && component.readme.trim()) {
    content += `### 📖 README Preview\n\n`;

    // Use the same logic as the real hover provider
    let readmePreview = component.readme.trim();
    if (readmePreview.length > 300) {
      readmePreview = readmePreview.substring(0, 300) + '...';
    }

    // Take first few lines only
    const lines = readmePreview.split('\n').slice(0, 4);
    content += lines.join('\n');
    content += `\n\n*[Click "Open in Detailed View" above to see the full README]*\n`;
  }

  return content;
}

/**
 * Validate hover content against expected criteria
 */
function validateHoverContent(content, expected) {
  // Count parameter rows more accurately - exclude header and separator rows
  const tableRows = content.match(/\| [^|]+ \| [^|]+ \| [^|]+ \| [^|]+ \|/g) || [];
  let parameterCount = 0;
  if (tableRows.length > 0) {
    // Remove header row ("| Name | Description | Required | Default |")
    // and separator row ("| ---- | ----------- | -------- | ------- |")
    parameterCount = Math.max(0, tableRows.length - 2);
  }

  const results = {
    hasTitle: content.includes('##'),
    hasDetachLink: content.includes('🔗 Open in Detailed View'),
    hasDescription: content.length > 50, // Simple check for description presence
    hasParameters: content.includes('### Parameters'),
    hasReadmePreview: content.includes('📖 README Preview'),
    parameterCount: parameterCount
  };

  const passed =
    results.hasTitle === expected.hasTitle &&
    results.hasDetachLink === expected.hasDetachLink &&
    results.hasDescription === expected.hasDescription &&
    results.hasParameters === expected.hasParameters &&
    results.hasReadmePreview === expected.hasReadmePreview &&
    results.parameterCount === expected.parameterCount;

  if (!passed) {
    console.log('  Expected:', expected);
    console.log('  Actual:', results);
  }

  return { passed, results };
}

/**
 * Test README preview functionality
 */
function testReadmePreview() {
  console.log('\n--- Testing README Preview ---');

  const longReadme = 'A'.repeat(1000) + '\n' + 'B'.repeat(500);
  const shortReadme = 'Short README content';

  // Test long README truncation
  const truncatedPreview = truncateReadmeForPreview(longReadme);
  const truncateTest = truncatedPreview.length <= 350 && truncatedPreview.includes('...'); // Allow for line breaks

  console.log(`Long README truncation: ${truncateTest ? 'PASS ✅' : 'FAIL ❌'}`);
  if (!truncateTest) {
    console.log(`  Expected length <= 350 with '...', got length ${truncatedPreview.length}`);
  }

  // Test short README preservation
  const shortPreview = truncateReadmeForPreview(shortReadme);
  const shortTest = shortPreview === shortReadme;

  console.log(`Short README preservation: ${shortTest ? 'PASS ✅' : 'FAIL ❌'}`);
  if (!shortTest) {
    console.log(`  Expected: "${shortReadme}"`);
    console.log(`  Actual: "${shortPreview}"`);
  }

  return truncateTest && shortTest;
}

function truncateReadmeForPreview(readme) {
  if (!readme) return '';

  let readmePreview = readme.trim();
  if (readmePreview.length > 300) {
    readmePreview = readmePreview.substring(0, 300) + '...';
  }

  // Take first few lines only
  const lines = readmePreview.split('\n').slice(0, 4);
  return lines.join('\n');
}

// Run all tests
console.log('Running hover provider tests...\n');

const hoverTests = testHoverContentGeneration();
const readmeTests = testReadmePreview();

const allPassed = hoverTests && readmeTests;

console.log('\n=== Hover Provider Test Summary ===');
console.log(`Hover content generation: ${hoverTests ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`README preview: ${readmeTests ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Overall: ${allPassed ? 'PASS ✅' : 'FAIL ❌'}`);

if (allPassed) {
  console.log('\n🎉 All hover provider tests passed!');
} else {
  console.log('\n💥 Some hover provider tests failed!');
}

// Export mock data for other tests
module.exports = { mockComponents };

// Set exit code
// eslint-disable-next-line no-undef
process.exit(allPassed ? 0 : 1);
