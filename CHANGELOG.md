# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 🐛 Bug Fixes

- fix: prevent output window from automatically opening during extension activation and debugging
  - Added development mode detection to prevent output panel from showing during extension debugging
  - Added `autoShowOutput` setting to control automatic output channel display
  - Replaced console.log calls with proper Logger calls to avoid triggering output panels
  - Output channel now only shows when explicitly requested by user actions, not during initialization
- fix: change default log level to ERROR to reduce noise and improve user experience

### ✨ Features

- feat: add `autoShowOutput` configuration option (default: false) to control output panel behavior

## [0.4.0] - 2025-08-27

### ✨ Features

- feat: implement input parameter hover functionality with detailed information
- feat: add cache update and reset commands; fix detailed view inputs
- feat(gitlabVariables): add support for using CI_COMMIT_SHA ref
- feat: add autocomplete for inputs
- feat: add editing capability for existing components in detached view
- feat: enhance input with selection in detailed view
- feat: include full input details in suggestions
- feat: add component input validation
- feat: add semantic release scripts and configuration

### 🐛 Bug Fixes

- fix: details for version refs showing full readme and template
- fix: inputs being validated when component has unresolved vars
- fix: gitlab pre-defined vars wrongly evaluated using user config
- fix(logger.ts): only info logs are present
- fix(insert): detailed viewer loses editor context

### 🔧 Other Changes

- Merge pull request #7 from eFAILution/feat/pre-release-0.3.0
- chore: copilot review suggestions
- chore: bump version to 0.3.1
- chore: add local release script to bump but not package or publish
- docs(README): add gifs
- docs: update readme with video demos for component features
- chore: pkg lock
- Merge pull request #6 from AstralDrift/feat/component-validation
- refactor: enhance input suggestion handling with QuickPick UI and command registration
- chore: remove remaining outputChannel imports
- refactor: component cache manager to use a logger instead of output channel
- chore(readme): remove changelog section


## [Unreleased]

### ✨ Features

- feat: add semantic release scripts and configuration

### 🔧 Other Changes

- Add manual release script with dry-run support
- Add GitHub token setup for semantic-release
- Configure Copilot to ignore .env files
- Update changelog with existing release history

## [0.2.0] - 2025-07-15

### ✨ Features

- feat: support instances that require token (#5)
- feat: centralize logging, add log level control, and document all user settings
- feat: add user settings reference and enhance logging throughout the extension

### 🔧 Other Changes

- Implement comprehensive ComponentService performance optimizations
- Add GitHub Actions CI workflow for testing VSCode extension
- Initial plan

## [0.1.8] - 2025-07-09

### ✨ Features

- feat: initial commit for v0.1.8

Initial setup with semantic-release automation.
