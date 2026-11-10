# Releasing

`beta` and `main` release differently. `beta` cuts a pre-release version on every push and publishes it to the Marketplace when you dispatch **Publish Beta**. `main` does both in one manual **Release** workflow.

> There is **no `semantic-release`** in this project (it isn't a dependency). Version/changelog automation is [release-it](https://github.com/release-it/release-it).

## Branch & version convention

The minor-version parity encodes the channel, and release-it and the publish workflows enforce it:

| Branch | Channel | Minor | Example |
|--------|---------|-------|---------|
| `beta` | pre-release | **odd** | `0.15.x` |
| `main` | stable | **even** | `0.16.x` |

A beta line (`0.15.x`) promotes to the next even stable minor (`0.16.0`) when it's released from `main`.

## Stable releases (`main`)

1. Merge the `beta` → `main` release PR.
2. Wait for **CI** and **Security Hardening** to pass on that push to `main`.
3. GitHub → **Actions** → **Release** → **Run workflow** on `main`. Or: `gh workflow run release.yml --ref main`.
4. Approve the `publish-main` deployment when GitHub asks.

[`.github/workflows/release.yml`](../.github/workflows/release.yml) has three jobs:

- **verify** stops unless CI and Security Hardening both succeeded on the exact commit being released. It doesn't run the tests again.
- **release** stops if HEAD is already a `chore(release):` commit, runs `npm audit --omit=dev --audit-level=high`, then runs `release-it --config .release-it.json --ci`. release-it computes the version from the conventional commits (`requireEvenMinor` rolls an odd `beta` minor to the next even one), updates `package.json` and `CHANGELOG.md`, packages the `.vsix`, pushes a `chore(release): <version> [skip ci]` commit and tag, and creates the GitHub Release with the `.vsix` attached.
- **publish** runs in the protected `publish-main` environment and publishes that same `.vsix` with `vsce publish --packagePath`. If it fails, re-run only this job. The version, tag and GitHub Release already exist.

A push to `main` never cuts a release. Why ([ADR-391](../.ai/decisions/ADR-391.yaml)):

- GitHub skips every workflow on a push whose commit message contains `[skip ci]` anywhere. The `beta` → `main` merge commit can list `beta`'s `chore(release): ... [skip ci]` commits in its body, which silently skipped 0.22.0.
- Back-to-back pushes to `main` raced for the same version, and the losing run's rollback deleted the winner's tag.
- The tests already ran on the PR and on the push to `main`. Running them again before releasing and again before publishing only re-tested a version bump.

The workflow's `concurrency` group queues a second dispatch instead of racing it.

## Pre-releases (`beta`)

- **Versioning:** on every push to `beta`, the `release` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs `release-it --config .release-it.beta.json --ci` after the test suites pass. It commits the version bump but doesn't tag or create a GitHub Release.
- **Publishing:** GitHub → **Actions** → **Publish Beta** → **Run workflow** on `beta`, entering the exact version (it must match `package.json`). It runs in the protected `publish-beta` environment and checks the branch, the version, that HEAD is a `chore(release):` commit, the test suite, `npm audit --omit=dev --audit-level=high`, a gitleaks scan, and the odd minor before `vsce publish --pre-release`.

## Local tooling

The `npm run release:*` scripts and `scripts/` helpers (release-it wrappers plus `scripts/manual-release.js`) exist for local dry-runs and recovery. For example, `npm run release:main:dry` previews the next version and changelog without pushing. Day to day, the workflows above handle versioning. Reach for these only to verify or to bump manually.
