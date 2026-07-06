# Releasing

Releases are **two-stage**: versioning is automated when changes land, and publishing to the VS Code Marketplace is a **manually-dispatched** GitHub Actions workflow.

> There is **no `semantic-release`** in this project (it isn't a dependency). Version/changelog automation is [release-it](https://github.com/release-it/release-it); the Marketplace publish is a gated `workflow_dispatch` workflow.

## Branch & version convention

The minor-version parity encodes the channel, and the publish workflows enforce it:

| Branch | Channel | Minor | Example |
|--------|---------|-------|---------|
| `beta` | pre-release | **odd** | `0.15.x` |
| `main` | stable | **even** | `0.16.x` |

A beta line (`0.15.x`) promotes to the next even stable minor (`0.16.0`) when `beta` is merged to `main`.

## Stage 1 — Versioning (automatic, on merge)

When commits land on `beta` or `main`, the `release` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — after the unit and extension-host suites pass — runs release-it in CI:

- `beta` → `release-it --config .release-it.beta.json --ci`
- `main` → `release-it --config .release-it.json --ci`

release-it (with `@release-it/conventional-changelog`) computes the next version from the conventional-commit history, updates `package.json` and `CHANGELOG.md`, and pushes a `chore(release): <version> [skip ci]` commit and matching git tag. No manual version bump is required.

## Stage 2 — Publishing (manual dispatch)

Publishing to the Marketplace is **never automatic**. Dispatch it deliberately:

1. Confirm the `chore(release):` commit for the version you want to ship is the tip of `beta`/`main`.
2. GitHub → **Actions** → **Publish** (for `main`) or **Publish Beta** (for `beta`) → **Run workflow**, entering the exact version (it must match `package.json`).
3. The workflow runs in the protected `publish-main` / `publish-beta` environment and enforces these guardrails before `vsce publish`:

   1. Correct branch (`main` for Publish, `beta` for Publish Beta).
   2. Input version matches `package.json`.
   3. HEAD is a `chore(release):` commit (i.e. Stage 1 has run).
   4. Full test suite passes.
   5. `npm audit --omit=dev --audit-level=high`.
   6. Gitleaks secret scan.
   7. Version minor parity matches the channel (even for stable, odd for pre-release).

   `main` publishes a stable build; `beta` publishes with `--pre-release`. Both upload the `.vsix` as a workflow artifact.

## Local tooling

The `npm run release:*` scripts and `scripts/` helpers (release-it wrappers plus `scripts/manual-release.js`) exist for local dry-runs and recovery — e.g. `npm run release:main:dry` previews the next version and changelog without pushing. Day to day, Stage 1 handles versioning automatically; reach for these only to verify or to bump manually.
