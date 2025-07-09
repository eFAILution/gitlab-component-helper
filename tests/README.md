# GitLab Component Helper - Tests

This directory contains all tests for the GitLab Component Helper VS Code extension.

## Structure

```
tests/
├── README.md              # This file
├── run-tests.js           # Simple test runner for unit tests
├── fixtures/              # Test data and sample files
│   ├── mock-data.json     # Mock component data for testing
│   └── sample.gitlab-ci.yml # Sample GitLab CI file
├── unit/                  # Unit tests
│   ├── url-parsing.test.js    # Tests URL parsing logic
│   └── hover-provider.test.js # Tests hover functionality
└── integration/           # Integration tests (require VS Code environment)
    └── extension.test.js  # Extension activation and provider tests
```

## Running Tests

### Unit Tests

Unit tests can be run independently without VS Code:

```bash
# Run all unit tests
npm test

# Or run specific tests
node tests/unit/url-parsing.test.js
node tests/unit/hover-provider.test.js
```

### Integration Tests

Integration tests require the VS Code Extension Test Runner:

```bash
# Note: Integration tests are currently placeholders
# Full integration tests would require @vscode/test-electron setup
node tests/integration/extension.test.js
```

## Test Categories

### Unit Tests (`unit/`)

Tests individual functions and modules in isolation:

- **URL Parsing**: Tests the logic that extracts GitLab instance, project path, component name, and version from component URLs
- **Hover Provider**: Tests hover functionality including markdown generation, README preview, and detach commands

### Integration Tests (`integration/`)

Tests that require the full VS Code extension environment:

- Extension activation
- Provider registration and integration
- Command execution
- WebView functionality
- Component caching behavior

### Fixtures (`fixtures/`)

Test data and sample files:

- **mock-data.json**: Mock component data for testing various scenarios
- **sample.gitlab-ci.yml**: Sample GitLab CI file with various component includes

## Writing Tests

### Unit Tests

Unit tests should:
- Test a single function or module
- Be independent and not rely on external services
- Use mock data from fixtures where needed
- Provide clear test descriptions and expected outcomes

Example:
```javascript
function testUrlParsing() {
  const testCases = [
    {
      name: 'Full GitLab component URL with version',
      url: 'https://gitlab.com/project/component@1.0.0',
      expected: {
        gitlabInstance: 'gitlab.com',
        projectPath: 'project',
        componentName: 'component',
        version: '1.0.0'
      }
    }
  ];

  testCases.forEach(testCase => {
    console.log(`Testing: ${testCase.name}`);
    const result = parseComponentUrl(testCase.url);
    // Assert result matches expected
  });
}
```

### Integration Tests

Integration tests would typically use `@vscode/test-electron` and test:
- Extension loading and activation
- Provider registration with VS Code
- Command palette integration
- WebView functionality
- File system interactions

## Test Data

The `fixtures/` directory contains:

- **Mock Components**: Sample component data with various parameter types and README content
- **Test URLs**: Various GitLab component URL formats for testing URL parsing
- **Sample Files**: GitLab CI files with component includes for testing providers

## Future Improvements

- Set up proper VS Code Extension Test Runner for integration tests
- Add automated testing in CI/CD pipeline
- Add performance tests for component fetching and caching
- Add tests for WebView UI components
- Add tests for error handling and edge cases
