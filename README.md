# 🚀 GitLab Component Helper

[![AICaC](https://img.shields.io/badge/AICaC-Comprehensive-success.svg)](https://github.com/eFAILution/AICaC)

> Browse, insert, and manage reusable GitLab CI/CD components in VS Code — from any GitLab instance, public or private.

### Component Browser
![componentBrowser](https://github.com/user-attachments/assets/6e4ad12e-d3f5-4165-8b72-c59bda51ae38)

---

## ✨ Features

- **Component Browser** — explore and insert components from any GitLab project or group
- **Smart Completion** — context-aware suggestions for components and versions as you type
- **Hover Docs** — full documentation and parameter hints inline
- **Input Validation** — real-time checking of component inputs, with Quick Fix suggestions
- **Local Includes** — the same hover, completion, and validation for `include: - local:` entries that declare a `spec.inputs` block
- **Version Picker & Upgrade Hints** — pick the right tag, and get flagged when a pinned semver falls behind (with one-click updates)
- **Variable Expansion** — resolves GitLab CI/CD variables (`$CI_SERVER_FQDN`, `$CI_PROJECT_PATH`, …) in component URLs
- **Private Access** — add private projects/groups with a token, stored encrypted per instance
- **Fast** — caching and batched API calls keep large catalogs responsive

![componentAutofill](https://github.com/user-attachments/assets/a76ba19a-240b-4799-a08f-88a78a5cf004)

---

## 🛠️ Quick Start

1. **Install** "GitLab Component Helper" from the VS Code Extensions view.
2. **Browse** — `Ctrl+Shift+P` → **GitLab CI: Browse Components**.
3. **Add a source** — **GitLab CI: Add Component Project/Group** (public or private; token optional).
4. **Author** — type `component:` in a `.gitlab-ci.yml` and accept the versioned suggestions.
5. **Hover** any component URL for instant documentation.

![hoverContext](https://github.com/user-attachments/assets/3c92f336-db04-4a68-80cf-43732d96b6f1)

---

## 🔒 Private Components

Add a private project or group with a personal access token — once per GitLab instance, then it's reused for that instance. Tokens are stored with VS Code **SecretStorage** (encrypted, never in plain text or files) and used only for API calls to the instance you added.

Create the token with the **`read_api`** scope, and ensure its user has at least **Reporter** access to the project.

> ⚠️ The legacy `gitlabComponentHelper.gitlabToken` setting stores tokens in plain text in `settings.json` and is **deprecated**. Use **GitLab CI: Add Component Project/Group** instead, then clear the field.

---

## ⚡ Example

```yaml
include:
  - component: https://gitlab.com/components/terraform@v1.0.0
    inputs:
      terraform_version: "1.5.0"
      workspace: "default"
```

Local templates work the same way — point a `- local:` entry at a workspace YAML that declares a `spec.inputs` block and you get the same hover, completion, and validation:

```yaml
include:
  - local: "gitlab/templates/nx-test.yml"
    inputs:
      job_name: test-nightly
      job_type: nightly
```

![insertInputs](https://github.com/user-attachments/assets/098f4eaf-3c4a-45a8-9caf-9a1351730b93)
![inputsValidation](https://github.com/user-attachments/assets/54d4b2ce-ad84-4bbc-8cd7-911a01565536)

---

## 🆙 Stay on the Latest Version

When a component is pinned to a semantic version (`X.Y.Z`), the extension checks whether a newer **stable** release exists and helps you upgrade:

- **Hover** shows the latest available version next to the one you're on — `✓ up to date` or `⚠️ update available`.
- An outdated pin gets a **warning squiggle** on the version ref, with an **Update to `X.Y.Z`** quick fix (`Ctrl+.`).
- **GitLab CI: Update All Component Versions to Latest** rewrites every outdated pin in the active file at once.

Only clean `X.Y.Z` pins (optionally `v`-prefixed) are checked — floating refs (`main`, `latest`, `~latest`), partial pins (`1`, `1.2`), and commit SHAs are left untouched, and pre-release tags are never suggested. The check runs when a CI file is opened or saved (not on every keystroke) and reuses the version cache. Toggle it with `gitlabComponentHelper.versionCheck.enabled`; soften the squiggle to an informational underline with `gitlabComponentHelper.versionCheck.severity`.

---

## ⚙️ Configuration

Point the extension at your component sources in VS Code settings:

```json
"gitlabComponentHelper.componentSources": [
  { "name": "OpenTofu Components", "path": "components/opentofu", "gitlabInstance": "gitlab.com" },
  { "name": "Internal CI Components", "path": "devops/ci-components", "gitlabInstance": "gitlab.company.com" }
]
```

To recognise CI files kept outside the defaults (`.gitlab-ci.yml`, `.gitlab-ci.yaml`, and anything under `.gitlab/`), add globs — they're merged with the built-in defaults and match at any depth:

```jsonc
"gitlabComponentHelper.additionalFileGlobs": ["**/ci/*.yml", "**/pipelines/**/*.yaml"]
```

**Advanced setups** have their own guides:
- [Component discovery tuning](https://github.com/eFAILution/gitlab-component-helper/blob/main/docs/discovery.md) — scan custom directories or depths for repos that pre-date the [GitLab Components spec](https://docs.gitlab.com/ci/components/#directory-structure).
- [Monorepo tag conventions](https://github.com/eFAILution/gitlab-component-helper/blob/main/docs/monorepo-tags.md) — scope per-component tags in a tag-per-component monorepo.

Every setting is listed in the [Settings Reference](#-settings-reference) below and editable from the VS Code Settings UI.

---

## 📝 Template Header Spec (Optional)

Add spec-compliant header comments to the top of a template to surface consistent context in the Component Browser. Supported keys: `summary`, `usage`, `note`.

```yaml
# @gitlab-component-helper: summary: Push a Helm chart to Sonic
# @gitlab-component-helper: usage: include + set SONIC_TARGET_* variables
# @gitlab-component-helper: note: Requires a protected ref for publish
```

The short prefix `# @gch:` works too. Headers must appear before any non-comment content; multiple `note` lines are allowed, and the section stays hidden if no header is present. Component details also include a **Raw YAML** toggle for inspecting the original template.

---

## 🧩 Commands

Run from the Command Palette (`Ctrl+Shift+P`):

- **GitLab CI: Browse Components** — explore and insert from your sources
- **GitLab CI: Add Component Project/Group** — add a project/group (optional token for private access)
- **GitLab CI: Update All Component Versions to Latest** — bump outdated semver pins in the active file
- **GitLab CI: Refresh Components Cache** / **Update Cache** / **Reset Cache** — refresh, force a full re-fetch, or clear cached data
- **GitLab CI: Show Cache Status** — cache info and stats

Debugging commands are also available: **Debug Cache (Detailed)**, **Show Performance Statistics**, and **Test Providers**.

---

## 🆘 Troubleshooting

- **No components showing?** Confirm the file's language mode is YAML and that component sources are configured.
- **HTTP 401 / "token expired" errors?** The token is expired or invalid — re-add it via **GitLab CI: Add Component Project/Group**, or the **Update Token** action in the error view. Confirm it has the **`read_api`** scope and at least **Reporter** access.
- **Version dropdown not loading?** Check connectivity to the GitLab instance, verify token/permissions, and refresh the cache.
- **Still stuck?** Set `gitlabComponentHelper.logLevel` to `DEBUG`, reproduce, and open an issue with the output and your configuration.

---

## ⚙️ Settings Reference

Add these to `settings.json` or configure them via the Settings UI.

| Setting | Type | Default | Description |
|--------|------|---------|-------------|
| `gitlabComponentHelper.componentSources` | array | _see [Configuration](#-configuration)_ | GitLab repositories with reusable components. Each item takes `name`, `path`, `gitlabInstance`, and optionally a `discovery` block or a `tagPattern` (see the advanced guides). |
| `gitlabComponentHelper.additionalFileGlobs` | array | `[]` | Extra GitLab CI file globs, merged with the built-in defaults. Patterns match at any depth (e.g. `ci/*.yml` → `**/ci/*.yml`). |
| `gitlabComponentHelper.versionCheck.enabled` | boolean | `true` | Warn when a component pinned to a semantic version has a newer stable release. Checked on open/save. |
| `gitlabComponentHelper.versionCheck.severity` | string | `warning` | Severity of the "newer version available" diagnostic. One of `warning`, `information`. |
| `gitlabComponentHelper.cacheTime` | number | `3600` | Component cache lifetime, in seconds. |
| `gitlabComponentHelper.logLevel` | string | `ERROR` | Logging level. One of `DEBUG`, `INFO`, `WARN`, `ERROR`. |
| `gitlabComponentHelper.autoShowOutput` | boolean | `false` | Show the output channel automatically when the log level changes. |
| `gitlabComponentHelper.httpTimeout` | number | `10000` | HTTP request timeout, in milliseconds. |
| `gitlabComponentHelper.retryAttempts` | number | `3` | Retry attempts for failed HTTP requests. |
| `gitlabComponentHelper.batchSize` | number | `5` | Components processed in parallel per batch. |
| `gitlabComponentHelper.discovery.templateRoots` | array | `["templates"]` | Directories scanned for components (up to 5). See [discovery tuning](https://github.com/eFAILution/gitlab-component-helper/blob/main/docs/discovery.md). |
| `gitlabComponentHelper.discovery.maxDepth` | number | `1` | Subdirectory depth to recurse under each root. Range `0`–`3`. |
| `gitlabComponentHelper.discovery.filePatterns` | array | `["*.yml", "*.yaml"]` | Filename globs for template files (filename only — no path globs). |
| `gitlabComponentHelper.discovery.templateFileNames` | array | `["template.yml", "template.yaml"]` | Filenames recognised inside per-component subfolders. |
| `gitlabComponentHelper.gitlabToken` | string | `""` | ⚠️ **Deprecated** — stores tokens in plain text. Use **GitLab CI: Add Component Project/Group** instead. |

---

## 🔌 API

The extension is designed to expose a programmatic API for other extensions to consume — see [docs/api.md](https://github.com/eFAILution/gitlab-component-helper/blob/main/docs/api.md). **Status: not yet exposed** (`activate()` does not return the API today); the doc describes the intended contract.

---

## 🧑‍💻 Development

**Prerequisites:** VS Code 1.120.0+, Node.js 22.x+, npm.

```bash
git clone https://github.com/eFAILution/gitlab-component-helper.git
cd gitlab-component-helper
npm install
npm run compile
```

Press `F5` to launch an Extension Development Host with the extension loaded.

---

## 🤝 Contributing

1. Fork and branch (`git checkout -b feat/your-feature`).
2. Commit using [conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, …).
3. Open a Pull Request.

Releases are automated with [semantic-release](https://semantic-release.gitbook.io/) — version, `CHANGELOG.md`, and the GitHub release are derived from commit messages on merge. See [docs/SEMANTIC_RELEASE.md](https://github.com/eFAILution/gitlab-component-helper/blob/main/docs/SEMANTIC_RELEASE.md).

---

## 📄 License

MIT — see [`LICENSE`](./LICENSE).
