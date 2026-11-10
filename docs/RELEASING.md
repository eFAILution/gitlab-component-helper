# Releasing

Releases are **two-stage**: versioning cuts the version, changelog and tag, and publishing puts that version on the VS Code Marketplace. On `beta` versioning runs on every push. On `main` both stages are **manually dispatched** GitHub Actions workflows.

> There is **no `semantic-release`** in this project (it isn't a dependency). Version/changelog automation is [release-it](https://github.com/release-it/release-it); the Marketplace publish is a gated `workflow_dispatch` workflow.

## Branch & version convention

The minor-version parity encodes the channel, and the publish workflows enforce it:

| Branch | Channel | Minor | Example |
|--------|---------|-------|---------|
| `beta` | pre-release | **odd** | `0.15.x` |
| `main` | stable | **even** | `0.16.x` |

A beta line (`0.15.x`) promotes to the next even stable minor (`0.16.0`) when `beta` is merged to `main`.

## Stage 1 — Versioning

The `release` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs release-it after the unit and extension-host suites pass:

- `beta` → `release-it --config .release-it.beta.json --ci`, on **every push** to `beta`.
- `main` → `release-it --config .release-it.json --ci`, **only when you dispatch it**: GitHub → **Actions** → **CI** → **Run workflow**, branch `main`. A push to `main` runs the tests and nothing else.

Why `main` is manual ([ADR-388](../.ai/decisions/ADR-388.yaml)): GitHub skips every workflow on a push whose commit message contains `[skip ci]` anywhere, and the `beta` → `main` merge commit can list `beta`'s `chore(release): ... [skip ci]` commits in its body. That silently skipped the 0.22.0 release. Back-to-back pushes to `main` also raced for the same version, and the losing run's rollback deleted the winner's tag. A dispatch runs on purpose, once, and the job's `concurrency` group queues a second click instead of racing it.

To cut a stable release:

1. Merge the `beta` → `main` release PR.
2. Wait for CI on `main` to pass.
3. Dispatch **CI** on `main`. The release job cuts the version (`requireEvenMinor` rolls an odd `beta` minor to the next even one), pushes the commit and tag, and creates the GitHub Release with the `.vsix`.
4. Go on to Stage 2.

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

The `npm run release:*` scripts and `scripts/` helpers (release-it wrappers plus `scripts/manual-release.js`) exist for local dry-runs and recovery — e.g. `npm run release:main:dry` previews the next version and changelog without pushing. Day to day, the CI `release` job handles versioning; reach for these only to verify or to bump manually.
