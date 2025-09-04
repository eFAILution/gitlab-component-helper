/**
 * Unit test for hover functionality with mock data
 */

// Test the hover functionality with mock data
console.log('Testing hover with README functionality...');

// Mock component data
const mockComponent = {
  name: 'test-component',
  description: 'This is a test component for demonstration',
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
    }
  ],
  version: '1.0.0',
  source: 'gitlab.example.com/components/test',
  readme: `# Test Component

This is a comprehensive test component for demonstrating the README functionality.

## Features

- Feature 1: Does something amazing
- Feature 2: Even more amazing functionality
- Feature 3: The most amazing feature yet

## Usage

\`\`\`yaml
include:
  - component: https://gitlab.example.com/components/test/test-component@1.0.0
    inputs:
      environment: staging
      version: latest
\`\`\`

## Configuration

You can configure this component by setting the following parameters:

- \`environment\`: The target environment
- \`version\`: The version to use

This is a long README to test the preview functionality in the hover window and the full display in the detached view.`,
  context: {
    gitlabInstance: 'gitlab.example.com',
    path: 'components/test'
  }
};

console.log('Mock component created:', mockComponent.name);
console.log('README length:', mockComponent.readme.length, 'characters');
console.log('Parameters count:', mockComponent.parameters.length);

console.log('✅ Test data ready for hover functionality');

module.exports = { mockComponent };
