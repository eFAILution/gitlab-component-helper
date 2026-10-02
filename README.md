<p align="center">
  <img src="images/icon.png" alt="GitLab Component Helper" width="112">
</p>

<h1 align="center">GitLab Component Helper</h1>

<p align="center">
  <strong>Autocomplete, inline docs, and a component browser for GitLab CI/CD, right in VS Code.</strong><br>
  Works with gitlab.com and self-hosted GitLab, public or private.
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=eFAILution.gitlab-component-helper"><img src="https://vsmarketplacebadges.dev/version-short/eFAILution.gitlab-component-helper.svg" alt="Marketplace version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=eFAILution.gitlab-component-helper"><img src="https://vsmarketplacebadges.dev/installs-short/eFAILution.gitlab-component-helper.svg" alt="Installs"></a>
  <a href="https://github.com/eFAILution/gitlab-component-helper/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/eFAILution/gitlab-component-helper/ci.yml?branch=main&label=CI" alt="CI status"></a>
  <a href="https://github.com/eFAILution/gitlab-component-helper/blob/main/LICENSE"><img src="https://img.shields.io/github/license/eFAILution/gitlab-component-helper" alt="MIT license"></a>
  <a href="https://github.com/eFAILution/AICaC"><img src="https://img.shields.io/badge/AICaC-Comprehensive-success.svg" alt="AICaC"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#features">Features</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#settings-reference">Settings</a> ·
  <a href="#troubleshooting">Troubleshooting</a>
</p>

![Browsing and inserting a component from the Component Browser](https://github.com/user-attachments/assets/6e4ad12e-d3f5-4165-8b72-c59bda51ae38)

[GitLab CI/CD components](https://docs.gitlab.com/ci/components/) make pipelines reusable, but writing them means jumping between your editor, the catalog, and each component's docs to find the right path, version, and inputs. This extension brings all of that into the file you're editing.

## Quick start

1. Install **GitLab Component Helper** from the Extensions view, or run `code --install-extension eFAILution.gitlab-component-helper`.
2. Open a `.gitlab-ci.yml` and type `component:`. Suggestions come with versions already filled in.
3. Hover any component URL to read its docs and inputs.
4. Run **GitLab CI: Browse Components** from the Command Palette to explore everything your sources offer.

Want your own components in the list? Run **GitLab CI: Add Component Project/Group** and point it at a project or group. A token is only needed for private ones.

## Features

### Browse and insert

The Component Browser lists every component from your configured projects and groups, on any GitLab instance. Pick one, choose a version, and insert it, with its inputs stubbed out if you want them. A **Raw YAML** toggle shows the original template.

### Complete as you type

Context-aware completion for component paths, versions, and input names. GitLab CI/CD variables such as `$CI_SERVER_FQDN` and `$CI_PROJECT_PATH` are resolved in component URLs.

![Autocompleting a component and its version](https://github.com/user-attachments/assets/a76ba19a-240b-4799-a08f-88a78a5cf004)

### Docs on hover

Hover a component to see its description, inputs, defaults, and version status. If a component has no description of its own, the opening paragraph of its `README.md` stands in.

![Hover documentation for a component](https://github.com/user-attachments/assets/3c92f336-db04-4a68-80cf-43732d96b6f1)

### Inputs that check themselves

Inputs are checked as you type. Unknown names and missing required inputs get flagged, with Quick Fixes to add what's missing.

```yaml
include:
  - component: gitlab.com/components/terraform@v1.0.0
    inputs:
      terraform_version: "1.5.0"
      workspace: "default"
```

![Inserting component inputs](https://github.com/user-attachments/assets/098f4eaf-3c4a-45a8-9caf-9a1351730b93)
![Validating component inputs](https://github.com/user-attachments/assets/54d4b2ce-ad84-4bbc-8cd7-911a01565536)

### Local includes too

`include: - local:` entries get the same hover, completion, and validation, as long as the target file declares a `spec.inputs` block.

```yaml
include:
  - local: "gitlab/templates/nx-test.yml"
    inputs:
      job_name: test-nightly
      job_type: nightly
```

### Stay on the latest version

When a component is pinned to a semantic version (`X.Y.Z`, optionally `v`-prefixed), the extension checks for a newer **stable** release:

- Hover shows `✓ up to date` or `⚠️ update available` next to your version.
- An outdated pin gets a warning squiggle with an **Update to `X.Y.Z`** Quick Fix (`Ctrl+.` / `Cmd+.`).
- **GitLab CI: Update All Component Versions to Latest** bumps every outdated pin in the file at once.

Floating refs (`main`, `latest`, `~latest`), partial pins (`1`, `1.2`), and commit SHAs are left alone, and pre-releases are never suggested. The check runs when a CI file is opened or saved and reuses the version cache.

<details>
<summary><strong>Choosing a default version per component</strong></summary>
<br>

Completion and the Component Browser offer the same default for each component: the highest semantic version, falling back to `main` or `master` when the project has no releases.

To change that, open the Component Browser, load a component's versions, and right-click the version dropdown:

- **Set as Default Version** pins the version you picked.
- **Always Use Latest** always offers the highest stable version.

Choosing one replaces the other. The choice is saved in `gitlabComponentHelper.versionPreferences` in your user settings, keyed by `<instance>/<project path>/<component>`, with `~latest` meaning Always Use Latest. You can edit or clear it there. A workspace entry for the same component wins over your user setting.

</details>

### Private components

Add a private project or group with **GitLab CI: Add Component Project/Group**. You enter a token once per GitLab instance, and it's reused for everything on that instance.

- Tokens live in VS Code **SecretStorage**: encrypted, never in plain text or settings files.
- They're only sent to the instance you added them for.
- Use the **`read_api`** scope, on a user with at least **Reporter** access to the project.

> **Heads up:** the old `gitlabComponentHelper.gitlabToken` setting stores tokens in plain text and is deprecated. Re-add the source with the command above, then clear that field.

### Fast on big catalogs

Component data is cached (one hour by default) and API calls are batched, so large groups stay responsive.

## Configuration

Most people only need component sources. Add them with the command above, or in `settings.json`:

```jsonc
"gitlabComponentHelper.componentSources": [
  { "name": "OpenTofu Components", "path": "components/opentofu", "gitlabInstance": "gitlab.com" },
  { "name": "Internal CI Components", "path": "devops/ci-components", "gitlabInstance": "gitlab.company.com" }
]
```

CI files are recognised at `.gitlab-ci.yml`, `.gitlab-ci.yaml`, and anywhere under `.gitlab/`. Keep pipelines somewhere else? Add globs. They're merged with the defaults and match at any depth:

```jsonc
"gitlabComponentHelper.additionalFileGlobs": ["**/ci/*.yml", "**/pipelines/**/*.yaml"]
```

<details>
<summary><strong>Advanced setups</strong></summary>
<br>

- **[Component discovery tuning](https://github.com/eFAILution/gitlab-component-helper/blob/main/docs/discovery.md):** scan custom directories or depths for repos that pre-date the [GitLab components layout](https://docs.gitlab.com/ci/components/#directory-structure).
- **[Monorepo tag conventions](https://github.com/eFAILution/gitlab-component-helper/blob/main/docs/monorepo-tags.md):** scope per-component tags in a tag-per-component monorepo.

</details>

<details>
<summary><strong>Template header comments (for component authors)</strong></summary>
<br>

Add header comments to the top of a template to show consistent context in the Component Browser. Supported keys are `summary`, `usage`, and `note`.

```yaml
# @gitlab-component-helper: summary: Push a Helm chart to Sonic
# @gitlab-component-helper: usage: include + set SONIC_TARGET_* variables
# @gitlab-component-helper: note: Requires a protected ref for publish
```

- The short prefix `# @gch:` works too.
- Headers must come before any non-comment content.
- Multiple `note` lines are allowed.
- The section stays hidden when no header is present.

When a component or project has no description, the browser and hover use the opening paragraph of its `README.md`, checked next to the template first and then at the repository root.

</details>

## Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type **GitLab CI**.

| Command | What it does |
| --- | --- |
| **Browse Components** | Explore and insert components from your sources |
| **Add Component Project/Group** | Add a project or group, with an optional token for private access |
| **Update All Component Versions to Latest** | Bump every outdated semver pin in the active file |
| **Refresh Components Cache** | Refresh cached component data |
| **Update Cache** | Force a full re-fetch |
| **Reset Cache** | Clear all cached data |
| **Show Cache Status** | Show cache info and stats |

For debugging there's also **Debug Cache (Detailed)**, **Show Performance Statistics**, and **Test Providers**.

## Settings reference

Every setting is also editable from the Settings UI under **GitLab Component Helper**.

<details>
<summary><strong>All settings</strong></summary>
<br>

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `gitlabComponentHelper.componentSources` | array | _see [Configuration](#configuration)_ | GitLab repositories with reusable components. Each item takes `name`, `path`, `gitlabInstance`, and optionally a `discovery` block or a `tagPattern` (see the advanced guides). |
| `gitlabComponentHelper.additionalFileGlobs` | array | `[]` | Extra GitLab CI file globs, merged with the built-in defaults. Patterns match at any depth (e.g. `ci/*.yml` → `**/ci/*.yml`). |
| `gitlabComponentHelper.versionCheck.enabled` | boolean | `true` | Warn when a component pinned to a semantic version has a newer stable release. Checked on open/save. |
| `gitlabComponentHelper.versionCheck.severity` | string | `warning` | Severity of the "newer version available" diagnostic. One of `warning`, `information`. |
| `gitlabComponentHelper.versionPreferences` | object | `{}` | Version offered per component, keyed by `<instance>/<project path>/<component>`: a version, or `~latest` for the highest stable version. Set via **Set as Default Version** or **Always Use Latest** in the Component Browser. |
| `gitlabComponentHelper.cacheTime` | number | `3600` | Component cache lifetime, in seconds. |
| `gitlabComponentHelper.logLevel` | string | `ERROR` | Logging level. One of `DEBUG`, `INFO`, `WARN`, `ERROR`. |
| `gitlabComponentHelper.autoShowOutput` | boolean | `false` | Show the output channel automatically when the log level changes. |
| `gitlabComponentHelper.httpTimeout` | number | `10000` | HTTP request timeout, in milliseconds. |
| `gitlabComponentHelper.retryAttempts` | number | `3` | Retry attempts for failed HTTP requests. |
| `gitlabComponentHelper.batchSize` | number | `5` | Components processed in parallel per batch. |
| `gitlabComponentHelper.discovery.templateRoots` | array | `["templates"]` | Directories scanned for components (up to 5). See [discovery tuning](https://github.com/eFAILution/gitlab-component-helper/blob/main/docs/discovery.md). |
| `gitlabComponentHelper.discovery.maxDepth` | number | `1` | Subdirectory depth to recurse under each root. Range `0`–`3`. |
| `gitlabComponentHelper.discovery.filePatterns` | array | `["*.yml", "*.yaml"]` | Filename globs for template files (filename only, no path globs). |
| `gitlabComponentHelper.discovery.templateFileNames` | array | `["template.yml", "template.yaml"]` | Filenames recognised inside per-component subfolders. |
| `gitlabComponentHelper.gitlabToken` | string | `""` | **Deprecated.** Stores tokens in plain text. Use **GitLab CI: Add Component Project/Group** instead. |

</details>

## Troubleshooting

<details>
<summary><strong>No components showing up</strong></summary>
<br>

Check that the file's language mode is YAML and that at least one component source is configured.

</details>

<details>
<summary><strong>HTTP 401 or "token expired"</strong></summary>
<br>

The token is expired or invalid. Re-add it with **GitLab CI: Add Component Project/Group**, or use the **Update Token** action in the error view. Make sure it has the **`read_api`** scope and at least **Reporter** access.

</details>

<details>
<summary><strong>Version dropdown won't load</strong></summary>
<br>

Check that you can reach the GitLab instance, verify the token and its permissions, then run **GitLab CI: Refresh Components Cache**.

</details>

<details>
<summary><strong>Still stuck?</strong></summary>
<br>

Set `gitlabComponentHelper.logLevel` to `DEBUG`, reproduce the problem, and [open an issue](https://github.com/eFAILution/gitlab-component-helper/issues) with the output and your configuration (leave out any tokens).

</details>

## Contributing

Issues and pull requests are welcome.

```bash
git clone https://github.com/eFAILution/gitlab-component-helper.git
cd gitlab-component-helper
npm install
npm run compile
```

Press `F5` to launch an Extension Development Host with the extension loaded. You'll need VS Code 1.120.0+ and Node.js 22+.

- Branch from `beta` and use [conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, …).
- `npm test` runs the unit suite. `npm run test:extension-host` runs the tests inside real VS Code.
- Releases are cut by [release-it](https://github.com/release-it/release-it) when changes land on `beta` or `main`. Publishing to the Marketplace is a manual workflow. See [docs/RELEASING.md](https://github.com/eFAILution/gitlab-component-helper/blob/main/docs/RELEASING.md).

A programmatic API for other extensions is planned but not exposed yet. [docs/api.md](https://github.com/eFAILution/gitlab-component-helper/blob/main/docs/api.md) describes the intended contract.

## License

[MIT](https://github.com/eFAILution/gitlab-component-helper/blob/main/LICENSE)
