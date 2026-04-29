# Changelog

All notable changes to this project will be documented in this file.

## [0.8.7](https://github.com/eFAILution/gitlab-component-helper/compare/0.8.6...0.8.7) (2026-04-29)

## [0.8.6](https://github.com/eFAILution/gitlab-component-helper/compare/0.8.5...0.8.6) (2026-04-03)


### Bug Fixes

* **ci:** add issues:write permission to AICaC workflow ([4457c0e](https://github.com/eFAILution/gitlab-component-helper/commit/4457c0e1a9c38e1acb9b9b4f3a52872c5bc2e379))

## [0.8.5](https://github.com/eFAILution/gitlab-component-helper/compare/0.8.4...0.8.5) (2026-04-03)

## [0.8.4](https://github.com/eFAILution/gitlab-component-helper/compare/0.8.3...0.8.4) (2026-03-21)

## [0.8.3](https://github.com/eFAILution/gitlab-component-helper/compare/0.8.2...0.8.3) (2026-03-18)

## [0.8.2](https://github.com/eFAILution/gitlab-component-helper/compare/0.8.1...0.8.2) (2026-03-18)

## [0.8.1](https://github.com/eFAILution/gitlab-component-helper/compare/0.8.0...0.8.1) (2026-03-18)

# [0.8.0](https://github.com/eFAILution/gitlab-component-helper/compare/0.7.0...0.8.0) (2026-03-14)


### Bug Fixes

* **ci:** revert release trigger to push with explicit CI status check ([1302f0e](https://github.com/eFAILution/gitlab-component-helper/commit/1302f0e73448b6e355097c962cf61f9b470d2d6f))
* **ci:** scope npm audit to production deps in publish workflows ([2b48ebf](https://github.com/eFAILution/gitlab-component-helper/commit/2b48ebf02588730e1075b1d2a75cbdcc8c580dbf))
* **component-browser:** restore editor context before component insertion ([28a07c1](https://github.com/eFAILution/gitlab-component-helper/commit/28a07c128e805215d7c778f116a3ee7e58e6519e)), closes [#40](https://github.com/eFAILution/gitlab-component-helper/issues/40)
* **componentService:** complex components in templates/ not parsing correctly ([3368b9e](https://github.com/eFAILution/gitlab-component-helper/commit/3368b9e25cc48666d429074f6a551e12fbfc03b6))
* **componentService:** resolve missing inputs for subdirectory template components ([d24af82](https://github.com/eFAILution/gitlab-component-helper/commit/d24af8296f4ce8d7a5dac43f5ad94e9abd30f33b))
* detect component templates in subdirectories (templates/*/*.yaml) ([9ec311b](https://github.com/eFAILution/gitlab-component-helper/commit/9ec311b2d14af13d3022feb0d8811f28acaed51e))
* **pre-commit:** run tests after compilation in pre-commit hook ([d98b099](https://github.com/eFAILution/gitlab-component-helper/commit/d98b099a196dae63082047eba06d4f53f9f8ac9d))


### Features

* **tests:** add comprehensive e2e catalog pipeline tests; fix CI workflow ([4ccfec9](https://github.com/eFAILution/gitlab-component-helper/commit/4ccfec9f9c53d1400ccc766ce1dcf33f9fd6753b))

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2025-09-24

### ✨ Features

- feat: add comprehensive tests for editExistingComponent functionality
- feat: enhance hover source information with clickable links
- feat: update logging behavior and add autoShowOutput configuration option

### 🐛 Bug Fixes

- fix: address Copilot formatting suggestions
- fix: component descriptions

### 🔧 Other Changes

- Merge pull request #10 from eFAILution/pre-release/0.5.x
- chore: update version to 0.5.2 and add .env to .vscodeignore
- test: reorganize tests and enhance test runner functionality; add new integration and unit tests
- Merge pull request #12 from eFAILution/copilot/fix-d1f604cc-d9d8-4a53-ac6f-73cdf65cf681
- Initial plan
- Merge pull request #11 from eFAILution/copilot/fix-2d49ceda-34e6-4169-97a6-ef574dc0f580
- chore: update test execution instructions in test plan
- Update tests/unit/componentBrowser.generateComponentText.test.js
- Update tests/unit/componentBrowser.transform.test.js
- Update tests/unit/componentBrowser.generateComponentText.test.js
- test: add safety harness for component browser provider refactor
- Initial plan
- Merge pull request #9 from eFAILution/8-output-window-always-opens


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
