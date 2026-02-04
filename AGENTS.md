# AI Assistant Instructions

This project uses **AI Context as Code (AICaC)** - structured YAML documentation in [`.ai/`](.ai/) for efficient context loading.

## Quick Start

**IMPORTANT: Load ONLY the file(s) relevant to your current task to minimize token usage.**

| Query Type | Load This File | Skip These |
|------------|----------------|------------|
| Project overview, setup, dependencies | [`.ai/context.yaml`](.ai/context.yaml) | architecture, workflows, decisions, errors |
| Architecture, components, data flow | [`.ai/architecture.yaml`](.ai/architecture.yaml) | context, workflows, decisions, errors |
| How-to, commands, adding features | [`.ai/workflows.yaml`](.ai/workflows.yaml) | context, architecture, decisions, errors |
| Why decisions were made, trade-offs | [`.ai/decisions.yaml`](.ai/decisions.yaml) | context, architecture, workflows, errors |
| Errors, debugging, troubleshooting | [`.ai/errors.yaml`](.ai/errors.yaml) | context, architecture, workflows, decisions |

## Examples

- **"How do I add a new provider?"** → Load [`.ai/workflows.yaml`](.ai/workflows.yaml) only
- **"Why use esbuild instead of webpack?"** → Load [`.ai/decisions.yaml`](.ai/decisions.yaml) only
- **"Fix component not loading error"** → Load [`.ai/errors.yaml`](.ai/errors.yaml) only
- **"What is the component architecture?"** → Load [`.ai/architecture.yaml`](.ai/architecture.yaml) only

## Project Quick Reference

**Name:** GitLab Component Helper
**Type:** VS Code Extension
**Language:** TypeScript
**Purpose:** Smart autocomplete, hover docs, and component browsing for GitLab CI/CD

### Tech Stack
- VS Code Extension API (>=1.102.0)
- TypeScript (strict mode)
- esbuild (bundler)
- Mocha (testing)
- semantic-release (automated releases)

### Entry Points
- Extension activation: [`src/extension.ts`](src/extension.ts)
- Providers: [`src/providers/`](src/providers/)
- Services: [`src/services/`](src/services/)

### Common Commands
```bash
npm run compile          # Compile TypeScript
npm run watch            # Watch mode for development
npm test                 # Run all tests
npm run test:unit        # Run unit tests only
npm run package          # Build production bundle
```

### Development
1. Clone repo: `git clone https://github.com/eFAILution/gitlab-component-helper.git`
2. Install: `npm install`
3. Compile: `npm run compile`
4. Debug: Press `F5` in VS Code (opens Extension Development Host)

### Directory Structure
```
gitlab-component-helper/
├── .ai/                    # AI Context as Code (structured docs)
├── src/
│   ├── extension.ts        # Extension entry point
│   ├── providers/          # VS Code language providers
│   │   ├── completionProvider.ts
│   │   ├── hoverProvider.ts
│   │   ├── validationProvider.ts
│   │   └── componentBrowserProvider.ts
│   ├── services/           # Business logic
│   │   ├── componentService.ts
│   │   └── componentCacheManager.ts
│   ├── types/              # TypeScript types
│   └── utils/              # Utilities
├── tests/                  # Test suite
│   ├── unit/
│   ├── integration/
│   └── performance.test.js
└── out/                    # Compiled output
```

## Code Style

- **TypeScript strict mode** enabled
- **Functional patterns** preferred over imperative
- **Early returns** to reduce nesting
- **Single responsibility** per file/function
- **Conventional commits** for all changes (feat, fix, docs, chore, etc.)

## Git Workflow

**Branch naming:** `feature/description` or `fix/description`
**Commit format:** `type(scope): description`
**Release:** Automated via semantic-release on push to main

### Commit Types
- `feat:` New feature (triggers minor version bump)
- `fix:` Bug fix (triggers patch version bump)
- `docs:` Documentation changes
- `chore:` Maintenance tasks
- `refactor:` Code refactoring
- `test:` Test changes

## Testing

- **Unit tests:** `npm run test:unit` (fast, isolated)
- **Integration tests:** `npm run test:integration` (slower, real VS Code APIs)
- **Performance tests:** `npm run test:performance`

All tests must pass before merging. CI runs tests automatically.

## Key Features

1. **Component Browser** - Browse and insert components from any GitLab instance
2. **Smart Autocomplete** - Context-aware suggestions for components and versions
3. **Hover Documentation** - Instant docs and parameter hints
4. **Input Validation** - Real-time validation with Quick Fix suggestions
5. **Multi-source Support** - Public and private GitLab instances
6. **Secure Token Storage** - VS Code SecretStorage for PATs

## Important Constraints

- Must support VS Code >=1.102.0
- Must support Node.js >=22.0.0
- Must work on both gitlab.com and self-hosted GitLab
- Component data must be cached for performance
- Private repositories require token authentication
- All commits must follow conventional commit format

## Architecture Highlights

### Provider Pattern
Language feature providers (hover, completion, validation) implement VS Code provider interfaces and are registered in `extension.ts`.

### Singleton Services
ComponentService and ComponentCacheManager use singleton pattern for shared state management.

### Cache-Aside Pattern
Components are cached with TTL (default 3600s) to minimize GitLab API calls.

### Batch Processing
API requests are batched (default 5 concurrent) to respect rate limits.

## For More Details

- **Full specification:** See [`.ai/`](.ai/) directory
- **User documentation:** See [`README.md`](README.md)
- **Semantic release:** See [`SEMANTIC_RELEASE.md`](SEMANTIC_RELEASE.md)
- **Cache management:** See [`CACHE_MANAGEMENT.md`](CACHE_MANAGEMENT.md)
- **Performance:** See [`PERFORMANCE_OPTIMIZATIONS.md`](PERFORMANCE_OPTIMIZATIONS.md)

## About AICaC

This project uses [AI Context as Code (AICaC)](https://github.com/eFAILution/AICaC) - a structured approach to project documentation that:

- **Reduces token usage** by 40-60% compared to prose
- **Improves queryability** with YAML structure
- **Maintains human readability** while optimizing for AI
- **Scales better** than monolithic AGENTS.md files

Learn more: https://github.com/eFAILution/AICaC
