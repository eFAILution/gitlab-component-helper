Closes #
<!-- Every PR starts from an issue. Use `Refs #N` instead for partial work. -->

## Summary
- What changed and why?

## Change Type
- [ ] feat
- [ ] fix
- [ ] refactor
- [ ] docs
- [ ] test
- [ ] chore

## Context
### User-facing impact
- What behavior changes for users?

### GitLab scope
- [ ] gitlab.com
- [ ] self-managed GitLab
- [ ] both

### Affected areas
- [ ] Component Browser
- [ ] Hover provider
- [ ] Completion provider
- [ ] Validation provider
- [ ] Cache and refresh behavior
- [ ] GitLab API calls/auth/token storage
- [ ] Docs only

## Validation
### Local checks
- [ ] `npm run compile`
- [ ] `npm test` or targeted tests
- [ ] Manual verification in VS Code Extension Host

### Manual test notes
- Include exact scenario(s), sample `.gitlab-ci.yml`, and observed results.

## Breaking Changes
- [ ] No breaking changes
- [ ] Breaking changes (describe below)

If breaking changes exist, describe migration steps:

## Screenshots / Recordings (if UI behavior changed)
- Add before/after visuals for Component Browser, hover, completion, or validation changes.

## Risk and Rollback
- Main risks:
- Rollback strategy:

## Release Notes Draft
- One short line suitable for CHANGELOG/release notes.

## Checklist
- [ ] Branch is named `<type>/<issue>-<description>` with this PR's issue number (AGENTS.md, Issues, branches, and records)
- [ ] A new decision is `.ai/decisions/ADR-<issue>.yaml` (never a new key in `.ai/decisions.yaml`)
- [ ] Branch is up to date with target branch
- [ ] Commit messages follow conventional commits
- [ ] Added/updated docs for behavior or settings changes
- [ ] Added/updated tests for new behavior
- [ ] No secrets or tokens in code, logs, screenshots, or test fixtures
