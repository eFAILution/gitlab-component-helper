# 🚀 GitLab Component Helper

> Turbocharge your GitLab CI/CD workflow in VS Code! Instantly browse, insert, and manage reusable components from any GitLab instance—public or private.

---

## ✨ Key Features

- **Component Browser**: Explore and insert components from any GitLab project or group
- **Smart Completion**: Context-aware suggestions for components and versions as you type
- **Hover Docs**: See full documentation and parameter hints instantly
- **Version/Tag Picker**: Always use the right version—no more guessing
- **Variable Expansion**: Full support for GitLab CI/CD variables in URLs and parameters
- **Lightning Fast**: Caching, batch API calls, and performance optimizations for huge catalogs
- **Private Access**: 🔑 Add private projects/groups with a token (per GitLab instance)

---

## 🛠️ Quick Start

1. **Install**: Search "GitLab Component Helper" in VS Code Extensions and click Install
2. **Browse Components**: `Ctrl+Shift+P` → "GitLab: Browse Components"
3. **Add Project/Group**: `Ctrl+Shift+P` → "GitLab CI: Add Component Project/Group" (add public or private sources, with or without a token)
4. **Insert & Complete**: Type `component:` in `.gitlab-ci.yml` and get instant, real versioned suggestions
5. **Hover for Docs**: Hover any component URL for instant documentation

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

- **GitLab: Browse Components** — Explore and insert from all your sources
- **GitLab CI: Add Component Project/Group** — Add any project/group (with optional token for private access)
- **GitLab: Refresh Component Cache** — Refreshes cached data
- **GitLab: Show Cache Status** — See cache info and stats

---

## 💡 Pro Tips

- Tokens are saved per GitLab instance—add once, use everywhere
- Works with both public and private GitLab servers
- All features are blazing fast, even with huge catalogs

---

## 🆘 Troubleshooting

**Component browser not showing components?**
- Check file language mode is set to YAML
- Verify component sources are configured

**GitLab variables not expanding?**
- Ensure `enableGitLabVariables` is true
- Check if component sources provide context for expansion
- Review debug output for variable detection

**Version dropdown not loading?**
- Check network connectivity to GitLab instance
- Verify project permissions and access tokens
- Review cache status and refresh if needed

If you encounter issues:
1. Enable debug output and check for error messages
2. Verify your configuration matches the examples above
3. Test with a simple, known-working component source
4. File an issue with debug output and configuration details

---

## 📝 Changelog

See the [CHANGELOG](./CHANGELOG.md) or below for highlights:

### v0.1.11 (pre-release)
- Added support for private GitLab projects/groups with token authentication

### v0.1.8 (stable)
- Reduced vsix package size for faster downloads

### v0.1.7
- GitLab Variables Support: Predefined variable completion, hover, and expansion
- Enhanced error handling and dynamic content updates

### v0.1.6
- Bug fixes, performance improvements, and UI polish

### v0.1.5
- Hierarchical component browser, version management, and persistent cache

### v0.1.0-0.1.4
- Core completion, GitLab integration, and YAML detection

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
- VSCode
- Node.js 14.x or higher
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
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

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
