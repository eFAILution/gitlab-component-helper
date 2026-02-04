# 🚀 GitLab Component Helper

[![AICaC](https://img.shields.io/badge/AICaC-Comprehensive-success.svg)](https://github.com/eFAILution/AICaC)


> Turbocharge your GitLab CI/CD workflow in VS Code! Instantly browse, insert, and manage reusable components from any GitLab instance—public or private.

### 🎬 See it in Action: Component Browser
![componentBrowser](https://github.com/user-attachments/assets/6e4ad12e-d3f5-4165-8b72-c59bda51ae38)

---

## ✨ Key Features

- **Component Browser**: Explore and insert components from any GitLab project or group
- **Smart Completion**: Context-aware suggestions for components and versions as you type
- **Hover Docs**: See full documentation and parameter hints instantly
- **Input Validation**: Real-time validation of component inputs with intelligent Quick Fix suggestions
- **Version/Tag Picker**: Always use the right version—no more guessing
- **Variable Expansion**: Full support for GitLab CI/CD variables in URLs and parameters
- **Lightning Fast**: Caching, batch API calls, and performance optimizations for huge catalogs
- **Private Access**: 🔑 Add private projects/groups with a token (per GitLab instance)

### 🎬 Smart Autocomplete in Action
![componentAutofill](https://github.com/user-attachments/assets/a76ba19a-240b-4799-a08f-88a78a5cf004)

---

## 🛠️ Quick Start

1. **Install**: Search "GitLab Component Helper" in VS Code Extensions and click Install
2. **Browse Components**: `Ctrl+Shift+P` → "GitLab: Browse Components"
3. **Add Project/Group**: `Ctrl+Shift+P` → "GitLab CI: Add Component Project/Group" (add public or private sources, with or without a token)
4. **Insert & Complete**: Type `component:` in `.gitlab-ci.yml` and get instant, real versioned suggestions
5. **Hover for Docs**: Hover any component URL for instant documentation

### 🎬 Hover Documentation Demo
![hoverContext](https://github.com/user-attachments/assets/3c92f336-db04-4a68-80cf-43732d96b6f1)

---

## 🔒 Private Components? No Problem!

Add any private project or group with a personal access token—just once per GitLab instance! The extension will use your token for all future requests to that instance.

**Your security matters:**
- Tokens are stored securely using VS Code's built-in SecretStorage—never in plain text or files.
- Tokens are only used for authenticated API calls to your specified GitLab instance and are never sent to third parties.

---

## ⚡ Example Usage

```yaml
include:
  - component: https://gitlab.com/components/terraform@v1.0.0
    with:
      terraform_version: "1.5.0"
      workspace: "default"
      apply: true
```

### 🎬 Adding Component Inputs
![insertInputs](https://github.com/user-attachments/assets/098f4eaf-3c4a-45a8-9caf-9a1351730b93)

### 🎬 Input Validation & Quick Fixes
![inputsValidation](https://github.com/user-attachments/assets/54d4b2ce-ad84-4bbc-8cd7-911a01565536)

---

## 📝 Template Header Spec (Optional Context)

To provide consistent context in the Component Browser, you can add **spec-compliant header comments** at the top of a template file. Only these keys are displayed; all other comments are ignored.

**Supported keys (must be at top of file):**
- `summary`
- `usage`
- `note`

**Full format:**
```yaml
# @gitlab-component-helper: summary: Push a Helm chart to Sonic
# @gitlab-component-helper: usage: include + set SONIC_TARGET_* variables
# @gitlab-component-helper: note: Requires a protected ref for publish
```

**Short format:**
```yaml
# @gch: summary: Push a Helm chart to Sonic
# @gch: usage: include + set SONIC_TARGET_* variables
# @gch: note: Requires a protected ref for publish
```

Notes:
- Header comments must appear **before any non-comment content**.
- Multiple `note` entries are supported.
- If no header is present, the Context section stays hidden.

---

## 📄 Raw YAML Toggle

Component details include a **Raw YAML** toggle so you can inspect the original template when needed. This is available regardless of whether header comments are present.

---

## ⚙️ Configuration

Add your favorite sources in VS Code settings:

```json
"gitlabComponentHelper.componentSources": [
  {
    "name": "OpenTofu Components",
    "path": "components/opentofu",
    "gitlabInstance": "gitlab.com",
    "type": "project"
  },
  {
    "name": "Internal CI Components",
    "path": "devops/ci-components",
    "gitlabInstance": "gitlab.company.com",
    "type": "group"
  }
]
```

---

## 🧩 Commands
#### Use the Command Palette (`Ctrl+Shift+P`) to access:
- **GitLab CI: Browse Components** — Explore and insert from all your sources
- **GitLab CI: Add Component Project/Group** — Add any project/group (with optional token for private access)
- **GitLab CI: Refresh Component Cache** — Refreshes cached data
- **GitLab CI: Show Cache Status** — See cache info and stats

---

## 🆘 Troubleshooting

**Component browser not showing components?**
- Check file language mode is set to YAML
- Verify component sources are configured

**Version dropdown not loading?**
- Check network connectivity to GitLab instance
- Verify project permissions and access tokens
- Review cache status and refresh if needed

If you encounter issues:
1. Enable debug output and check for error messages
2. Verify your configuration matches the examples above
3. Test with a simple, known-working component source
4. Submit an issue with debug output and configuration details

---

## 🔌 API Reference

The extension exposes the following API for other extensions to consume:

```typescript
interface GitLabComponentAPI {
    getComponentList(): Promise<Component[]>;
    getComponentDetails(name: string, version?: string): Promise<ComponentDetails>;
    validateComponent(component: Component): ValidationResult;
    expandGitLabVariables(text: string, context?: VariableContext): string;
    openComponentBrowser(context?: ComponentContext): Promise<void>;
}

interface Component {
    name: string;
    description: string;
    parameters: ComponentParameter[];
    version?: string;
    source?: string;
    gitlabInstance?: string;
    sourcePath?: string;
    availableVersions?: string[];
    originalUrl?: string;
}

interface ComponentParameter {
    name: string;
    description?: string;
    required: boolean;
    type?: string;
    default?: any;
}
```

Access through:

```typescript
const api = await vscode.extensions.getExtension('username.gitlab-component-helper')?.activate();
if (api) {
    const components = await api.getComponentList();
    // Use components...
}
```

---

## 🧑‍💻 Development

**Prerequisites:**
- VSCode 1.102.0 or higher
- Node.js 22.x or higher
- Yarn or npm

**Setup:**
```bash
git clone https://github.com/username/gitlab-component-helper.git
cd gitlab-component-helper
yarn install # or npm install
```

**Build:**
```bash
yarn compile # or npm run compile
```

**Debug:**
1. Open the project in VSCode
2. Press F5 to start debugging
3. A new VSCode window will open with the extension loaded

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes using [conventional commits](https://www.conventionalcommits.org/):
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation changes
   - `chore:` for maintenance tasks
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Automated Releases

This project uses [semantic-release](https://semantic-release.gitbook.io/) for automated versioning and releases. When your PR is merged to `main`:

- Version is automatically bumped based on commit messages
- CHANGELOG.md is updated
- GitHub release is created with packaged extension
- No manual versioning needed!

See [SEMANTIC_RELEASE.md](./SEMANTIC_RELEASE.md) for more details.

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

## ⚙️ User Settings Reference

The following settings are available for the GitLab Component Helper extension. Add these to your VS Code `settings.json` or configure via the Settings UI:

| Setting | Type | Default | Description |
|--------|------|---------|-------------|
| `gitlabComponentHelper.componentSource` | string | `local` | Source for component definitions. One of: `local`, `gitlab`, `url` |
| `gitlabComponentHelper.gitlabUrl` | string | `https://gitlab.com` | GitLab instance URL |
| `gitlabComponentHelper.gitlabProjectId` | string | `""` | GitLab project ID containing component definitions |
| `gitlabComponentHelper.gitlabToken` | string | `""` | GitLab API access token |
| `gitlabComponentHelper.gitlabComponentsFilePath` | string | `components.json` | Path to components JSON file in GitLab repository |
| `gitlabComponentHelper.componentsUrl` | string | `""` | URL to a JSON file containing component definitions |
| `gitlabComponentHelper.cacheTime` | number | `3600` | Cache time for components in seconds |
| `gitlabComponentHelper.logLevel` | string | `INFO` | Logging level for component service. One of: `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `gitlabComponentHelper.httpTimeout` | number | `10000` | HTTP request timeout in milliseconds |
| `gitlabComponentHelper.retryAttempts` | number | `3` | Number of retry attempts for failed HTTP requests |
| `gitlabComponentHelper.batchSize` | number | `5` | Number of components to process in parallel batches |
| `gitlabComponentHelper.componentSources` | array | See below | GitLab repositories containing reusable CI/CD components |

### Example `componentSources` value:
```json
"gitlabComponentHelper.componentSources": [
  {
    "name": "GitLab CI Examples",
    "path": "gitlab-org/gitlab-foss",
    "gitlabInstance": "gitlab.com"
  },
  {
    "name": "OpenTofu Components",
    "path": "components/opentofu",
    "gitlabInstance": "gitlab.com"
  }
]
```

> For more details on each setting, see the extension's package.json or the VS Code Settings UI.
