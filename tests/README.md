# GitLab Component Helper - Tests

This directory contains all tests for the GitLab Component Helper VS Code extension.

## Structure

```
tests/
├── README.md              # This file
├── run-tests.js           # Simple test runner for unit tests
├── performance.test.js    # Performance tests
├── validate-optimizations.js # Optimization validation tests
├── fixtures/              # Test data and sample files
│   ├── mock-data.json     # Mock component data for testing
│   └── sample.gitlab-ci.yml # Sample GitLab CI file
├── unit/                  # Unit tests
│   ├── componentBrowser.*.test.js # Component browser tests
│   ├── description-extraction.test.js # Tests description parsing logic
│   ├── fallback-behavior.test.js     # Tests fallback mechanisms
│   ├── hover-mock-data.test.js       # Tests hover mock data
│   ├── hover-provider.test.js        # Tests hover functionality
│   ├── input-hover.test.js           # Tests input hover
│   ├── template-parsing.test.js      # Tests template parsing
│   └── url-parsing.test.js           # Tests URL parsing logic
└── integration/           # Integration tests (require VS Code environment or compiled output)
    ├── component-service.test.js      # Tests ComponentService integration
    ├── description-fix-verification.test.js # Tests description fix
    └── extension.test.js              # Extension activation and provider tests
```

## Recently Reorganized ✅

**September 2025**: All test files have been successfully moved from the root directory to proper test categories for better organization and maintainability.

### Moved to `integration/`:
- `test-component.js` → `tests/integration/component-service.test.js`
- `test-fix-verification.js` → `tests/integration/description-fix-verification.test.js`

### Moved to `unit/`:
- `test-hover.js` → `tests/unit/hover-mock-data.test.js`
- `test-description-fix.js` → `tests/unit/description-extraction.test.js`
- `test-fallback-behavior.js` → `tests/unit/fallback-behavior.test.js`

### Cleaned up:
- Removed empty placeholder files: `test-url.js`, `test-url-parsing.js`
- Updated import paths to work with new directory structure
- Added proper module exports for reusability

## Running Tests

### Unit Tests

Unit tests can be run independently without VS Code:

```bash
# Run all unit tests with the simple runner
npm test

# Or run specific tests
node tests/unit/description-extraction.test.js
node tests/unit/fallback-behavior.test.js
node tests/unit/hover-mock-data.test.js
```

### Integration Tests

Integration tests require compiled extension code:

```bash
# Compile the extension first
npm run compile

# Then run integration tests
node tests/integration/component-service.test.js
node tests/integration/description-fix-verification.test.js
```

## Test Categories

### Unit Tests (`unit/`)

Tests individual functions and modules in isolation:

- **Description Extraction**: Tests the logic that parses component descriptions from GitLab CI templates
- **Fallback Behavior**: Tests fallback mechanisms when component descriptions are not available
- **Hover Provider**: Tests hover functionality including markdown generation and README preview
- **URL Parsing**: Tests the logic that extracts GitLab instance, project path, component name, and version from component URLs
- **Template Parsing**: Tests parsing of GitLab CI template content
- **Component Browser**: Tests component browser functionality

### Integration Tests (`integration/`)

Tests that require compiled extension code or full component:

- **Component Service**: Tests the ComponentService with real GitLab API calls
- **Description Fix Verification**: Tests the fix for description extraction issues
- **Extension**: Tests extension activation and provider registration

### Performance Tests

- **performance.test.js**: Tests performance characteristics of the extension
- **validate-optimizations.js**: Validates that performance optimizations are working

## Test Data

The `fixtures/` directory contains:

- **mock-data.json**: Mock component data for testing various scenarios
- **sample.gitlab-ci.yml**: Sample GitLab CI file with component includes for testing providers

## Key Test Features

### Description Extraction Tests
- Tests the NEW improved regex for extracting component descriptions
- Compares against OLD problematic regex to ensure fixes work
- Tests fallback behavior when no component description exists

### Integration Tests
- Tests real component fetching from GitLab
- Validates that description fixes prevent extraction of input parameter descriptions
- Tests component service functionality end-to-end

## Future Improvements

- Set up proper VS Code Extension Test Runner for full integration tests
- Add automated testing in CI/CD pipeline
- Add more comprehensive error handling tests
- Add tests for WebView UI components
- Add tests for component caching behavior
