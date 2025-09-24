# Test Plan: ComponentBrowserProvider Refactor Safety Harness

## Overview

This document outlines the testing strategy for the upcoming refactoring of `componentBrowserProvider.ts`. The file is currently ~2,600 lines and needs to be decomposed into smaller, more maintainable modules. Before beginning this refactor, we have implemented a comprehensive test suite to lock in current behavior and ensure no regressions occur during the decomposition process.

## Why These Tests Exist

The `componentBrowserProvider.ts` file contains complex logic for:
- Component data transformation and hierarchical grouping
- Version selection and semantic version prioritization  
- YAML generation for component insertion with parameter handling
- GitLab variable preservation and URL construction
- UI state management and webview communication

These tests serve as a safety net to ensure the refactor maintains identical behavior while improving code organization.

## Current Test Coverage

### 1. Transform Logic Tests (`componentBrowser.transform.test.js`)

**Purpose**: Test the `transformCachedComponentsToGroups` method that converts flat component data into hierarchical display structure.

**Scenarios Covered**:
- ✅ Single component transformation (basic hierarchy creation)
- ✅ Multiple versions with semantic prioritization (v2.0.0 > latest > main > v1.2.3)
- ✅ Component filtering (skip components with missing critical fields)
- ✅ Complex multi-source, multi-project hierarchy organization
- ✅ Version priority edge cases (v10.0.0 > v2.10.0 > v2.1.0)

**Key Behaviors Locked In**:
- **Version Selection Logic**: 'latest' resolves to highest semantic version, not literally 'latest'
- **Grouping Hierarchy**: Source → Project → Component → Versions structure
- **Data Validation**: Components missing `name`, `source`, or `sourcePath` are skipped
- **Version Priority**: Semantic versions > 'latest' > 'main' > 'master' > other tags

### 2. Component Text Generation Tests (`componentBrowser.generateComponentText.test.js`) ✅

**Purpose**: Test the `generateComponentText` method that creates YAML for component insertion.

**Scenarios Covered**:
- ✅ Basic component without inputs (URL construction)
- ✅ Required vs optional parameter placeholders with type-specific defaults
- ✅ Selected inputs filtering (only include chosen parameters)
- ✅ Existing component editing (preserve selected inputs, remove unselected)
- ✅ GitLab variable preservation (`"${CI_PROJECT_PATH}"` stays quoted and unmodified)
- ✅ Original URL with variables (`originalUrl` field handling)
- ✅ Type-specific default value formatting (string/boolean/number)

**Key Behaviors Locked In**:
- **Parameter Defaults**: Required strings → `"TODO: set value"`, booleans → `true`, numbers → `0`
- **Optional Defaults**: Strings → `""`, booleans → `false`, numbers → `0`
- **GitLab Variables**: Always preserved in double quotes, never expanded
- **Input Filtering**: `selectedInputs` removes unselected parameters, adds new ones with defaults
- **Existing Input Preservation**: When editing, existing values kept for selected inputs

### 3. Edit Existing Component Tests (`componentBrowser.editExisting.test.js`) ✅

**Purpose**: Test the `editExistingComponent` functionality including range finding, existing component parsing, and edit logic behavior.

**Scenarios Covered**:
- ✅ Component range detection for middle component in multi-component include list
- ✅ Component range detection for last component (ensures end resolves to file end)
- ✅ Component range detection when extra blank lines follow component block (trims trailing blank lines)
- ✅ Existing component parsing from YAML snippets with mixed input types
- ✅ Component text generation when editing: preserves existing selected inputs, removes unselected when narrowing
- ✅ Component text generation when editing: adds new parameters not present previously

**Key Behaviors Locked In**:
- **Range Detection**: Correctly identifies component block boundaries in various positions
- **Trailing Line Handling**: Excludes blank lines from component ranges
- **Input Parsing**: Preserves string, boolean, and numeric values from existing YAML
- **Edit Preservation**: Maintains existing values for selected inputs during editing
- **Input Management**: Removes unselected inputs, adds new inputs with appropriate defaults

## Test Structure and Approach

### Reflection-Based Testing
Since the methods being tested are private, tests use bracket notation (`provider['methodName']`) to access them. This is acceptable for transitional safety nets and avoids modifying production code.

### Mock Strategy
- **Minimal VSCode API Mocking**: Only mock what's needed for constructor compatibility
- **No Network Dependencies**: All tests are deterministic and run offline
- **Isolated Logic Testing**: Focus on pure functions without UI interactions

### Test Organization
- **Common Structure**: All tests use Node.js `assert` module for consistency with existing test infrastructure
- **Clear Test Names**: Each test case clearly describes the scenario being validated
- **Comprehensive Assertions**: Tests validate both structure and specific behavior details

## Planned Expansion During Refactor

As the refactor proceeds and logic is extracted into smaller modules, the test suite will be expanded to cover:

### ✅ Step 1: Core Data Transformation (Completed)
- **Transform Logic**: Component grouping and hierarchical organization ✅
- **Component Text Generation**: YAML creation with parameter handling ✅

### ✅ Step 2: Component Editing Logic (Completed)  
- **Range Detection**: Component boundary identification in YAML files ✅
- **Existing Component Parsing**: Input extraction from YAML snippets ✅
- **Edit Logic**: Input preservation and modification during component updates ✅

### 🔄 Step 3: Version Management & Context Handling (Next Target)
- **Version Resolution Edge Cases**: Test complex version selection scenarios
  - Multiple versions with mixed semantic and non-semantic tags
  - Version precedence with custom branch patterns
  - Fallback behavior when preferred versions are unavailable
- **Context Source Injection**: Test component URL construction edge cases  
  - Mixed gitlab instances in multi-source environments
  - Variable expansion and preservation in different contexts
  - Original URL preservation vs constructed URL logic
- **Configuration Integration**: Test settings and preference handling
  - Custom gitlab instances and authentication contexts
  - Source filtering and component visibility rules
  - User-specific version defaults and always-latest preferences

### Phase 4: UI Component Decomposition (Future)  
- **Panel Lifecycle Management**: Test webview creation, disposal, and state management
- **Message Handling**: Test webview↔extension communication protocols
- **Search and Filtering**: Test component search and display filtering logic

### Phase 5: Cache and State Management (Future)
- **Cache Action Handlers**: Test cache update, reset, and refresh operations
- **Component Version Fetching**: Test dynamic version loading and caching
- **Error State Handling**: Test error display and recovery scenarios

### Phase 6: Integration Points (Future)
- **Extension Integration**: Test command handling and editor integration
- **Configuration Management**: Test settings and user preference handling
- **Error Recovery**: Test fallback behaviors and user guidance

## Test Maintenance Guidelines

### During Refactor
1. **Run Tests After Each Move**: Ensure tests pass after extracting each method/class
2. **Update Test Imports**: Adjust test imports as code moves between files
3. **Maintain Behavior Contracts**: New modules should pass existing behavioral tests
4. **Add New Test Coverage**: Each new module should get dedicated unit tests

### Test Evolution
- **Keep Safety Tests**: Maintain transform and generateText tests until refactor is complete
- **Add Module Tests**: Create focused tests for each new extracted module
- **Integration Testing**: Add tests that verify modules work together correctly
- **Remove Reflection**: Once refactor is complete, replace bracket notation with public APIs

## Success Criteria

The refactor will be considered successful when:

1. **All Current Tests Pass**: Existing safety harness tests continue to pass
2. **Improved Test Coverage**: Each extracted module has comprehensive unit tests  
3. **No Behavioral Changes**: End-user functionality remains identical
4. **Better Maintainability**: Code is organized into focused, testable modules
5. **Clear Module Boundaries**: Each module has a single responsibility and clear API

## Running Tests

```bash
# Run all tests including new safety harness
npm test

# Run specific test files directly (recommended for safety harness)
node tests/unit/componentBrowser.transform.test.js
node tests/unit/componentBrowser.generateComponentText.test.js
```

## Risk Mitigation

### Identified Risks
- **Complex Logic**: Version selection has many edge cases and precedence rules
- **GitLab Variable Handling**: Must preserve exact quoting and variable syntax
- **UI State Dependencies**: Webview communication and state management is complex
- **Configuration Integration**: Settings and user preferences affect behavior

### Mitigation Strategies
- **Comprehensive Test Coverage**: Tests cover edge cases and integration points
- **Incremental Refactor**: Move small pieces at a time, testing after each change
- **Behavioral Preservation**: Focus on maintaining exact current behavior
- **Rollback Plan**: Git branching strategy allows reverting problematic changes

---

This test plan ensures that the componentBrowserProvider refactor can proceed safely with confidence that no functionality will be broken during the decomposition process.
