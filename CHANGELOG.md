# Changelog

All notable changes to this project will be documented in this file.

## [0.14.5](https://github.com/eFAILution/gitlab-component-helper/compare/0.14.4...0.14.5) (2026-07-06)

## [0.14.4](https://github.com/eFAILution/gitlab-component-helper/compare/0.14.3...0.14.4) (2026-07-06)

## [0.14.3](https://github.com/eFAILution/gitlab-component-helper/compare/0.14.2...0.14.3) (2026-07-06)

## [0.14.2](https://github.com/eFAILution/gitlab-component-helper/compare/0.14.1...0.14.2) (2026-07-06)

## [0.14.1](https://github.com/eFAILution/gitlab-component-helper/compare/0.14.0...0.14.1) (2026-06-28)

# [0.14.0](https://github.com/eFAILution/gitlab-component-helper/compare/0.12.2...0.14.0) (2026-06-28)


### Bug Fixes

* **deps:** pin @types/vscode to ^1.120.0 to match engines.vscode ([a6c7626](https://github.com/eFAILution/gitlab-component-helper/commit/a6c7626801519f0388ee188c69008a4975ec8038)), closes [#188](https://github.com/eFAILution/gitlab-component-helper/issues/188) [188/#190](https://github.com/eFAILution/gitlab-component-helper/issues/190)
* diff diagnostics ([#180](https://github.com/eFAILution/gitlab-component-helper/issues/180)) ([fc0ec6a](https://github.com/eFAILution/gitlab-component-helper/commit/fc0ec6a8bf0683430fbd9194c6ac23b41a86a41b))
* Duplicate include line scoping ([#176](https://github.com/eFAILution/gitlab-component-helper/issues/176)) ([625f2ff](https://github.com/eFAILution/gitlab-component-helper/commit/625f2fff5b895550f803c391aa7d3da467a9b928))
* Improve expired token user experience ([#198](https://github.com/eFAILution/gitlab-component-helper/issues/198)) ([2cad09f](https://github.com/eFAILution/gitlab-component-helper/commit/2cad09fb6900244327193b18ca33b076558512af))
* input completions offered outside the input-name slot ([#185](https://github.com/eFAILution/gitlab-component-helper/issues/185)) ([f922edb](https://github.com/eFAILution/gitlab-component-helper/commit/f922edb01d6b34d6e4a927a469ccb0f1d34018b6))
* re-requesting input suggestions after typing part of a new input name returns nothing ([#192](https://github.com/eFAILution/gitlab-component-helper/issues/192)) ([a7c4026](https://github.com/eFAILution/gitlab-component-helper/commit/a7c4026b463a6e549439a8769bedc7fe9d5c196c))
* recognise braced ${VAR} GitLab variables in component URLs ([#182](https://github.com/eFAILution/gitlab-component-helper/issues/182)) ([d522fe4](https://github.com/eFAILution/gitlab-component-helper/commit/d522fe4ca9df90274b3e5f8eee21781b5c883fd3))
* revalidate on edit ([#178](https://github.com/eFAILution/gitlab-component-helper/issues/178)) ([622ff97](https://github.com/eFAILution/gitlab-component-helper/commit/622ff97da16c2e9c82ee5339b16583c4b6cf30ba))
* **version-check:** expand GitLab variables before fetching versions ([#195](https://github.com/eFAILution/gitlab-component-helper/issues/195)) ([54aa5fd](https://github.com/eFAILution/gitlab-component-helper/commit/54aa5fd9beb18894fe8b8de05f7d61d59d3905e8)), closes [#193](https://github.com/eFAILution/gitlab-component-helper/issues/193)


### Features

* **version-check:** detect outdated component versions ([#194](https://github.com/eFAILution/gitlab-component-helper/issues/194)) ([60af4ec](https://github.com/eFAILution/gitlab-component-helper/commit/60af4ec9bfc429b83893950a4d376718960a169d)), closes [#193](https://github.com/eFAILution/gitlab-component-helper/issues/193)

## [0.12.2](https://github.com/eFAILution/gitlab-component-helper/compare/0.12.1...0.12.2) (2026-06-12)

## [0.12.1](https://github.com/eFAILution/gitlab-component-helper/compare/0.12.0...0.12.1) (2026-06-12)

# [0.12.0](https://github.com/eFAILution/gitlab-component-helper/compare/0.10.4...0.12.0) (2026-06-12)


### Bug Fixes

* **api:** paginate tag and version fetches ([#151](https://github.com/eFAILution/gitlab-component-helper/issues/151)) ([ec1ed84](https://github.com/eFAILution/gitlab-component-helper/commit/ec1ed84b32aa6306b4e9299fcf08fc443af6e20b))
* **cache:** cache branch-referenced components with HEAD-SHA revalidation ([#153](https://github.com/eFAILution/gitlab-component-helper/issues/153)) ([6165620](https://github.com/eFAILution/gitlab-component-helper/commit/6165620937779babf69b983e0d3408ebc1dff501))
* completion options enum dropdown ([#169](https://github.com/eFAILution/gitlab-component-helper/issues/169)) ([f09345e](https://github.com/eFAILution/gitlab-component-helper/commit/f09345eb03bf458b7cfa9a3c9e011a27c50b0f0f))
* **completion,validation:** resolve GitLab repo from the active file, not workspace[0] ([#123](https://github.com/eFAILution/gitlab-component-helper/issues/123)) ([db3c570](https://github.com/eFAILution/gitlab-component-helper/commit/db3c5706b10f0de9c8776f7b7af901fe2bccf944))
* component: URLs and Component Browser "Template File" links ([#131](https://github.com/eFAILution/gitlab-component-helper/issues/131)) ([e7da2cd](https://github.com/eFAILution/gitlab-component-helper/commit/e7da2cdfb8efa1b1ae969a637e6cdc379723fed0))
* input completions break after a multi-line array input ([#164](https://github.com/eFAILution/gitlab-component-helper/issues/164)) ([13f5c22](https://github.com/eFAILution/gitlab-component-helper/commit/13f5c2292df48ba174c02ede729ac4fb07c58022))
* Remove legacy single source settings ([#155](https://github.com/eFAILution/gitlab-component-helper/issues/155)) ([f866e29](https://github.com/eFAILution/gitlab-component-helper/commit/f866e2902ec5ff3c8a46353ca791017896158321))


### Features

* monorepo tag scoping ([#171](https://github.com/eFAILution/gitlab-component-helper/issues/171)) ([35cbf52](https://github.com/eFAILution/gitlab-component-helper/commit/35cbf5268e67acea391f4ed39be9bed3c245275c))
* recognise non-canonical GitLab CI file names via additionalFileGlobs ([#125](https://github.com/eFAILution/gitlab-component-helper/issues/125)) ([32aa5a8](https://github.com/eFAILution/gitlab-component-helper/commit/32aa5a85be3c88cd8c8a617b5f1d2c5fc1fd7911))
* support local includes as first-class components ([#129](https://github.com/eFAILution/gitlab-component-helper/issues/129)) ([7ad82cd](https://github.com/eFAILution/gitlab-component-helper/commit/7ad82cd4b78618e4c2fdfab7e7aae927869348f8))

## [0.10.4](https://github.com/eFAILution/gitlab-component-helper/compare/0.10.3...0.10.4) (2026-05-28)


### Bug Fixes

* **ci:** skip release-it dry-run for fork PRs ([#119](https://github.com/eFAILution/gitlab-component-helper/issues/119)) ([ef7a600](https://github.com/eFAILution/gitlab-component-helper/commit/ef7a6001837525f8970785924586d4f15befe25d))
* **completion:** expand GitLab variables in component URLs before parsing ([#114](https://github.com/eFAILution/gitlab-component-helper/issues/114)) ([0999a54](https://github.com/eFAILution/gitlab-component-helper/commit/0999a5452f5c4d4803a8ea1442176d31330b6a90))
* **deps:** bump engines.vscode to match @types/vscode 1.120 ([#120](https://github.com/eFAILution/gitlab-component-helper/issues/120)) ([e36d203](https://github.com/eFAILution/gitlab-component-helper/commit/e36d203295ea3ae7fdbfb82102aeaeea53bfc6ed)), closes [#118](https://github.com/eFAILution/gitlab-component-helper/issues/118)
* **syntax:** correct grammar filename to restore syntax highlighting ([#116](https://github.com/eFAILution/gitlab-component-helper/issues/116)) ([8dab15a](https://github.com/eFAILution/gitlab-component-helper/commit/8dab15a25a495b965e45db6c3e9dece46c422931))

## [0.10.3](https://github.com/eFAILution/gitlab-component-helper/compare/0.10.2...0.10.3) (2026-05-14)

## [0.10.2](https://github.com/eFAILution/gitlab-component-helper/compare/0.10.1...0.10.2) (2026-05-07)


### Bug Fixes

* **ai:** satisfy AICaC v2 schema and remove stale references ([0910a4a](https://github.com/eFAILution/gitlab-component-helper/commit/0910a4a8246f4fb5dd43efe538dfe5d7cdf97a89))

## [0.10.1](https://github.com/eFAILution/gitlab-component-helper/compare/0.10.0...0.10.1) (2026-05-07)

# [0.10.0](https://github.com/eFAILution/gitlab-component-helper/compare/0.8.8...0.10.0) (2026-05-07)


### Bug Fixes

* **componentBrowserProvider:** escape HTML characters in version dropdown and error messages ([dac2e5c](https://github.com/eFAILution/gitlab-component-helper/commit/dac2e5cad4651e2921f92055cee31e65dc0be082))
* **component:** resolve inputs for project-style complex components ([8bae7d1](https://github.com/eFAILution/gitlab-component-helper/commit/8bae7d13a550c8341da0b131479d8d454be7d0a7))
* **deps:** pin @types/vscode to match engines.vscode ([17e756a](https://github.com/eFAILution/gitlab-component-helper/commit/17e756a0333d1ff94de9f742fc1ed0e1eb1ff67b))
* **package:** replace em-dash in markdownDescription with hyphen ([b36cf82](https://github.com/eFAILution/gitlab-component-helper/commit/b36cf824ba6118e07cc3728c10cc1def6c11fb4f))
* **security:** deprecate plain-text gitlabToken setting and prefer SecretStorage ([093f725](https://github.com/eFAILution/gitlab-component-helper/commit/093f725bff8bc37ac677182ffaa65bc5f60ff6e5))


### Features

* **componentService:** enhance component processing to include YAML fragments with reusable anchors ([739f9bb](https://github.com/eFAILution/gitlab-component-helper/commit/739f9bb0ddb12ae8f354f3ca489417b86913e107))
* **discovery:** add configurable template discovery schema and helpers ([8fd7856](https://github.com/eFAILution/gitlab-component-helper/commit/8fd7856eb9a28cc80a182382451495477dd9e1a3))

## [0.8.8](https://github.com/eFAILution/gitlab-component-helper/compare/0.8.7...0.8.8) (2026-04-29)

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
