# AI Assistant Instructions

This project uses **AI Context as Code (AICaC)** - structured YAML documentation in [`.ai/`](.ai/) for efficient context loading.

**Quick reference:** every change starts from a GitHub issue, one PR per issue, opened as a draft against `beta` with the first commit. Name the branch `<type>/<issue>-<short-description>` (for example `chore/366-issue-keyed-workflow`) and record a new decision as `.ai/decisions/ADR-<issue>.yaml`. Details in [Issues, branches, and records](#issues-branches-and-records).

## Quick Start

**IMPORTANT: Load ONLY the file(s) relevant to your current task to minimize token usage.**

| Query Type | Load This File | Skip These |
|------------|----------------|------------|
| Project overview, setup, dependencies | [`.ai/context.yaml`](.ai/context.yaml) | architecture, workflows, decisions, errors |
| Architecture, components, data flow | [`.ai/architecture.yaml`](.ai/architecture.yaml) | context, workflows, decisions, errors |
| How-to, commands, adding features | [`.ai/workflows.yaml`](.ai/workflows.yaml) | context, architecture, decisions, errors |
| Why decisions were made, trade-offs | [`.ai/decisions.yaml`](.ai/decisions.yaml) and [`.ai/decisions/`](.ai/decisions/) (or `npm run decisions:list`) | context, architecture, workflows, errors |
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
- VS Code Extension API (>=1.120.0)
- TypeScript (strict mode)
- esbuild (bundler)
- Mocha (testing)
- release-it (version + changelog automation; Marketplace publish is a manual workflow dispatch)

### Entry Points
- Extension activation: [`src/extension.ts`](src/extension.ts)
- Providers: [`src/providers/`](src/providers/)
- Services: [`src/services/`](src/services/)
- MCP server: [`src/mcp/main.ts`](src/mcp/main.ts) → `out/mcp/server.js` (see [`docs/mcp.md`](docs/mcp.md))

### Common Commands
```bash
npm run compile          # Compile TypeScript
npm run watch            # Watch mode for development
npm test                 # Run the Mocha unit suite
npm run test:extension-host  # Run real-VS-Code tests
npm run package          # Build production bundle
npm run decisions:check  # Check decision records (add -- --branch <b> --base <ref> for the branch rule)
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
│   └── decisions/          # One decision record per issue (ADR-<issue>.yaml)
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

**Branch naming:** `<type>/<issue>-<short-description>`, with the issue number right after the type, for example `fix/412-hover-crash`. The type is one of the commitlint types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore` or `revert`. Branches that tools name for themselves (`dependabot/`, `copilot/`, `claude/`) only get a warning from the Decision Records check, but when you pick the name, use a type prefix. See [Issues, branches, and records](#issues-branches-and-records).
**Target branch:** PRs go to `beta`. `main` only takes the `beta` -> `main` release PR, whose head is `beta` itself. The check skips the branch rule for that PR, since each record on `beta` already passed it on its own PR, and still validates the stores.
**Commit format:** `type(scope): description`
**Release:** release-it bumps the version + CHANGELOG on push to `beta`/`main` (ci.yml `release` job); publishing to the Marketplace is a manual `workflow_dispatch` (Publish / Publish Beta). See [`docs/RELEASING.md`](docs/RELEASING.md)

### Commit Types
- `feat:` New feature (triggers minor version bump)
- `fix:` Bug fix (triggers patch version bump)
- `docs:` Documentation changes
- `chore:` Maintenance tasks
- `refactor:` Code refactoring
- `test:` Test changes

## Issues, branches, and records

These rules are for people and coding agents alike. GitHub never gives out an issue number twice, so a branch, a PR and a decision record keyed to one can't clash with anyone else's, and parallel sessions stop stepping on each other. The reasoning is in [ADR-366](.ai/decisions/ADR-366.yaml).

### Before you start

1. **Start from an issue.** Every change has a GitHub issue, and each PR covers one issue. Split big work into sub-issues and give each its own PR. If there's no issue yet, open one first.
2. **Name the branch after the issue.** Use `<type>/<issue>-<short-description>` with the number right after the type: `feat/412-version-hover`. A sub-issue's PR uses the sub-issue's number, never the parent's or the epic's. Coding agents use the type prefixes too (`chore/366-...`, not `claude/366-...`).
3. **Check nobody has it, then open a draft PR.** Look for a PR already linked to the issue and for a branch already named for it:
   ```bash
   gh issue view <n> --json closedByPullRequestsReferences --jq '.closedByPullRequestsReferences[].url'
   gh pr list --state open --search "<n>"
   git ls-remote --heads origin "*/<n>-*"
   ```
   If any of them prints something, stop and ask on the issue before doing anything else. If all three are empty, push your first commit and open a draft PR right away (`gh pr create --draft --base beta`), so everyone can see the issue is taken.
4. **Link the issue.** The first line of the PR body is `Closes #<n>`, or `Refs #<n>` when the PR is only part of the work. The PR title is a conventional-commit line, like `chore(ci): key branches and decision records to the issue number`.
5. **Record decisions under the issue number.** A new decision is one file, `.ai/decisions/ADR-<issue>.yaml`. See [Adding a decision](#adding-a-decision).

Nobody edits a decision index by hand. `npm run decisions:list` builds one at read time from both stores. The **Decision Records** workflow ([`.github/workflows/decision-records.yml`](.github/workflows/decision-records.yml)) checks every PR and every push to `beta` and `main`.

### Adding a decision

```bash
npm run decisions:new -- --title "Short decision title"   # the issue number comes from the branch; or add --issue <n>
```

That writes `.ai/decisions/ADR-<issue>.yaml`, a full AICaC v2 document: `version: '2.0'` and a `decisions:` mapping with exactly one key, `ADR-<issue>`, matching the file name. Fill in the entry:

| Field | Required | Shape |
|-------|----------|-------|
| `title` | yes | Text, at least 3 characters |
| `status` | yes | `proposed`, `accepted`, `rejected`, `deprecated` or `superseded` |
| `context` | yes | Text, at least 10 characters: the problem that made the decision necessary |
| `decision` | yes | Text, at least 5 characters: what was decided |
| `date` | | Quoted `'YYYY-MM-DD'` |
| `rationale` | | List of text items |
| `alternatives_considered` | | List of `name` / `rejected_because` mappings (or plain text items) |
| `consequences` | | `positive` and `negative` lists of text items |
| `implementation` | | Text or a mapping |
| `references` | | List of text items (paths, links) |
| `supersedes` | | List of decision keys this one replaces, like `[USE_ESBUILD]` or `[ADR-366]` |

Quote any list item that contains `: `. Unquoted, YAML reads it as a mapping and the sentence is lost; the check catches it.

Rules:

- **Never add a key to `.ai/decisions.yaml`.** It holds the twenty SCREAMING_SNAKE entries it had when #366 closed it. You can still edit an existing entry there (status, wording).
- **One record per PR**, keyed to that PR's issue. A PR with two decisions records both in its one file, or gets split into two issues. A later PR for the same issue edits the existing file.
- **Never renumber a record.** Its number is its issue.
- **Superseding a legacy entry:** set the old entry's `status: superseded` and list its key under `supersedes` in the new file. Don't put the new key in the old entry's `superseded_by`: the AICaC validator only resolves keys inside `.ai/decisions.yaml`, so it would fail.
- See every decision: `npm run decisions:list` (add `-- --format yaml` or `-- --format json` for machine-readable output).
- Check before you push:
  ```bash
  npx tsx scripts/ci/decisionRecords.ts check --branch "$(git branch --show-current)" --base origin/beta
  ```

### If the check fails

| Message | Fix |
|---------|-----|
| `this branch is for issue #N, so its record must be .ai/decisions/ADR-N.yaml` | `git mv` the file to `ADR-N.yaml` and change its key to `ADR-N`. If the decision belongs to another issue, it goes in that issue's PR. |
| `a PR that adds a decision record needs a branch named <type>/<issue>-<description>` | The branch has no issue number. See [Moving to a branch with an issue number](#moving-to-a-branch-with-an-issue-number). |
| `'<KEY>' is a new key, but this file is closed to new entries since #366` | Move the entry out of `.ai/decisions.yaml` into `.ai/decisions/ADR-<issue>.yaml`. |
| `duplicated mapping key at line N` | A key appears twice, usually after a merge. Keep the copy already on `beta` and key yours to your issue. |
| `record files are named ADR-<issue>.yaml` | Rename the file: bare issue number, no zero padding, `.yaml` extension. Only a `README.md` may sit next to the records. |
| `needs a quoted top-level version` | Add `version: '2.0'` (with the quotes) at the top of the file. |
| `'decisions' must hold exactly one entry, keyed ADR-N` | One key per file, and it must match the file name. |
| `'<field>' is required`, `must be one of ...`, `must be a list of text items`, `'date' must be a quoted 'YYYY-MM-DD'` | Fix that field in the record file. |
| `'supersedes' names '<KEY>', which is in neither ...` | Fix the key, or drop it from `supersedes`. |
| `could not diff against base '<ref>'` | Fetch the base first (`git fetch origin beta`) and pass a ref that exists. |
| Warning: `branch '...' has no issue number` | Only a warning. Fine for Dependabot and fork PRs. For anything else, move to a branch with an issue number. |

Fork PRs run the same check with a read-only token and no secrets. A fork's branch name is the contributor's choice, so a fork branch without an issue number gets the warning, and only fails if it adds a record.

### Moving to a branch with an issue number

**Never rename a PR's head branch on GitHub.** Renaming the head branch closes the PR. Push a new, correctly named branch and open a new PR instead:

```bash
git switch -c <type>/<n>-<short-description>          # starts from your current branch and keeps its commits
# If the PR adds a record: git mv it to .ai/decisions/ADR-<n>.yaml, change its key to ADR-<n>, commit
git push -u origin <type>/<n>-<short-description>
gh pr create --draft --base beta --body "Closes #<n>. Replaces #<old-pr>."
gh pr close <old-pr> --comment "Moved to #<new-pr>."
```

## Testing

- **Unit tests:** `npm test` (Mocha, fast, isolated)
- **Extension-host tests:** `npm run test:extension-host` (slower, real VS Code APIs)

All tests must pass before merging. CI runs tests automatically.

## Key Features

1. **Component Browser** - Browse and insert components from any GitLab instance
2. **Smart Autocomplete** - Context-aware suggestions for components and versions
3. **Hover Documentation** - Instant docs and parameter hints
4. **Input Validation** - Real-time validation with Quick Fix suggestions
5. **Multi-source Support** - Public and private GitLab instances
6. **Secure Token Storage** - VS Code SecretStorage for PATs

## Important Constraints

- Must support VS Code >=1.120.0
- Must support Node.js >=22.0.0
- Must work on both gitlab.com and self-hosted GitLab
- Component data must be cached for performance
- Private repositories require token authentication
- All commits must follow conventional commit format
- Every change starts from an issue; branch names and new decision records carry its number

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
- **Releasing:** See [`docs/RELEASING.md`](docs/RELEASING.md)
- **Cache & performance architecture:** See [`.ai/architecture.yaml`](.ai/architecture.yaml)

## About AICaC

This project uses [AI Context as Code (AICaC)](https://github.com/eFAILution/AICaC) - a structured approach to project documentation that:

- **Reduces token usage** by 40-60% compared to prose
- **Improves queryability** with YAML structure
- **Maintains human readability** while optimizing for AI
- **Scales better** than monolithic AGENTS.md files

Learn more: https://github.com/eFAILution/AICaC
