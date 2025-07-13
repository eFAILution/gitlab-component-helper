# GitLab Component Helper

## Overview

GitLab Component Helper is a sophisticated VSCode extension designed to streamline the development workflow when working with GitLab CI/CD component libraries. It provides intelligent code completion, hover documentation, component browsing, and real-time validation for GitLab CI/CD component structures.

## Features

### 🎯 Core Features
- **Component Browser**: Hierarchical, collapsible browser with version dropdowns and live updates
- **Intelligent Completion**: Context-aware suggestions for GitLab CI/CD components with real available versions
- **Version Management**: Robust version/tag management with deduplication and caching
- **Component Insertion**: Insert components with their input parameters and default values
- **Hover Documentation**: Inline documentation and parameter hints for components
- **GitLab Variables Support**: Full support for GitLab predefined variables like `$CI_SERVER_FQDN`

### 🚀 Advanced Features (v0.1.5+)
- **Hierarchical Component Browser**: Tree view with sources → projects → components structure
- **Version Dropdown Selection**: Choose specific versions/tags with live fetching
- **Component Details View**: Dedicated panel showing parameters, descriptions, and insertion options
- **Persistent Cache**: VS Code globalState-based caching across sessions
- **Dynamic Version Fetching**: Real-time fetching of specific component versions
- **Right-click Context Menus**: Set default versions or always-use-latest preferences
- **GitLab Variable Expansion**: Automatic expansion of variables in component URLs
- **Component Input Templates**: Insert components with all parameters and default values

### 🔧 Technical Improvements
- **Efficient Caching**: Deduplication of redundant version fetches
- **Professional UI**: Modern, VS Code-native interface
- **Error Handling**: Comprehensive error reporting and recovery
- **Type Safety**: Full TypeScript implementation with proper error checking
- **Performance**: Optimized for large component libraries

## Requirements

- VSCode 1.60.0 or higher
- Node.js 14.x or higher
- Git (for version control integration)
- Access to GitLab instance (gitlab.com or private instances)

## Installation

1. Open VSCode
2. Navigate to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "GitLab Component Helper"
4. Click Install

Alternatively, install via command line:

```bash
code --install-extension username.gitlab-component-helper
```

## Usage

## Usage

### Component Browser

Open the component browser to explore available components:

1. **Command Palette**: `Ctrl+Shift+P` → "GitLab: Browse Components"
2. **Right-click**: In any `.gitlab-ci.yml` file → "Browse GitLab Components"

The browser provides:
- **Hierarchical View**: Sources → Projects → Components
- **Version Dropdowns**: Select specific tags/versions for each component
- **Search**: Filter components by name or description
- **Component Details**: View parameters, descriptions, and documentation
- **Insert Options**: Insert with or without input parameters

### Component Completion

Type `component:` in your `.gitlab-ci.yml` file to trigger intelligent completion:

```yaml
include:
  - component: # Trigger completion here
```

Features:
- Real available versions (not just 'latest')
- Version suggestions after `@`
- GitLab variable support (e.g., `$CI_SERVER_FQDN`)

### Hover Documentation

Hover over component URLs to see detailed information:

```yaml
include:
  - component: https://gitlab.com/components/terraform@v1.0.0  # Hover here
```

### GitLab Variables Support

Full support for GitLab predefined variables:

```yaml
include:
  - component: $CI_SERVER_FQDN/components/build-image@2.0.0  # Variables are expanded
    with:
      image: $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA  # Variables preserved in parameters
```

Supported variables include:
- `$CI_SERVER_FQDN` - GitLab instance hostname
- `$CI_PROJECT_PATH` - Project path with namespace
- `$CI_REGISTRY_IMAGE` - Container registry image path
- `$CI_COMMIT_REF_NAME` - Branch or tag name
- And many more...

### Component Insertion with Parameters

When inserting components, you can choose to include all input parameters:

```yaml
include:
  - component: https://gitlab.com/components/terraform@v1.0.0
    with:
      terraform_version: "1.5.0"  # required
      workspace: "default"        # optional
      apply: true                 # optional
```

## Configuration

Configure component sources in your VS Code settings to enable the extension:

```json
{
    "gitlabComponentHelper.componentSources": [
        {
            "name": "OpenTofu Components",
            "path": "components/opentofu",
            "gitlabInstance": "gitlab.com"
            "type": "project"
        },
        {
            "name": "Internal CI Components",
            "path": "devops/ci-components",
            "gitlabInstance": "gitlab.company.com",
            "type": "group"
        }
    ]
}
```

### Settings Reference

- **componentSources**: Array of GitLab projects/groups containing CI components
  - **name**: Display name for the source (shown in browser)
  - **path**: GitLab project/group path (e.g., "components/opentofu")
  - **gitlabInstance**: GitLab instance hostname (defaults to "gitlab.com")

### Advanced Configuration

The extension also supports these additional settings:

```json
{
    "gitlabComponentHelper.cacheTime": 3600,
    "gitlabComponentHelper.componentSource": "gitlab",
    "gitlabComponentHelper.enableGitLabVariables": true,
    "gitlabComponentHelper.autoExpandVariables": true
}
```

- **cacheTime**: Cache duration in seconds (default: 3600)
- **componentSource**: Legacy source type ("local", "gitlab", "url")
- **enableGitLabVariables**: Enable GitLab variable support (default: true)
- **autoExpandVariables**: Auto-expand variables in URLs (default: true)

## Commands

The extension provides the following VS Code commands:

- **GitLab: Browse Components** - Opens the component browser
- **GitLab: Refresh Component Cache** - Refreshes cached component data
- **GitLab: Show Cache Status** - Displays cache information and statistics

Access via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) or right-click context menus.

## Debug Output

The extension provides comprehensive debug output to help troubleshoot configuration and component fetching:

### Viewing Debug Output

1. Open the **Output** panel in VS Code (View → Output)
2. Select **"GitLab Component Helper"** from the dropdown
3. The extension will log detailed information about:
   - Component source configuration and validation
   - Cache operations and performance metrics
   - Component fetching and version resolution
   - GitLab variable expansion and URL processing
   - Browser and completion provider activities

### Debug Information Includes

- **Extension Activation**: Settings loaded at startup
- **Configuration Changes**: Real-time updates when settings change
- **Component Fetching**:
  - GitLab API requests and responses
  - Component parsing and transformation
  - Version fetching and caching operations
  - Error handling and retry logic
- **Component Browser**:
  - Hierarchical data transformation
  - Version dropdown population
  - Dynamic version fetching
- **Completion Provider**:
  - Trigger conditions and context detection
  - Component URL generation and validation
  - GitLab variable expansion results
- **Hover Provider**:
  - Component detection at cursor position
  - Parameter and documentation lookup
  - GitLab variable information display
- **Cache Management**:
  - Persistent cache operations using VS Code globalState
  - Cache hits/misses and performance metrics
  - Version deduplication results

### Example Debug Output

```
[Extension] User settings loaded:
[Extension]   - Component sources: [{"name":"OpenTofu Components","path":"components/opentofu","gitlabInstance":"gitlab.com"}]
[ComponentBrowser] Retrieved 15 component groups from cache
[ComponentBrowser] Fetching available versions for terraform-plan...
[ComponentCache] Found 8 versions for terraform-plan: [v2.1.0, v2.0.0, v1.5.2, ...]
[ComponentDetector] Component URL contains GitLab variables: CI_SERVER_FQDN
[ComponentDetector] Expanded URL: https://gitlab.company.com/devops/ci-components/build-image@2.0.0
[CompletionProvider] Created completion item: terraform-plan@v2.1.0
[HoverProvider] Found GitLab variable: CI_PROJECT_PATH
```

## Troubleshooting

### Common Issues

1. **No components showing in browser**
   - Check your `componentSources` configuration
   - Verify GitLab instance accessibility
   - Check debug output for API errors

2. **Components not completing**
   - Ensure you're in a `.gitlab-ci.yml` file
   - Check file language mode is set to YAML
   - Verify component sources are configured

3. **GitLab variables not expanding**
   - Ensure `enableGitLabVariables` is true
   - Check if component sources provide context for expansion
   - Review debug output for variable detection

4. **Version dropdown not loading**
   - Check network connectivity to GitLab instance
   - Verify project permissions and access tokens
   - Review cache status and refresh if needed

### Getting Help

If you encounter issues:
1. Enable debug output and check for error messages
2. Verify your configuration matches the examples above
3. Test with a simple, known-working component source
4. File an issue with debug output and configuration details

## Changelog

### v0.1.8 (Latest)
- **Reduced vsix package size**: Optimized for faster downloads

### v0.1.7
- **GitLab Variables Support**: Full support for GitLab predefined variables like `$CI_SERVER_FQDN`
- **Variable Completion**: Auto-completion for GitLab predefined variables
- **Variable Hover**: Detailed information when hovering over GitLab variables
- **Smart URL Expansion**: Automatic expansion of variables in component URLs
- **Enhanced Error Handling**: Better error messages and recovery for variable-related issues
- **Version-Specific Details**: Component details view now updates when different versions are selected
- **Dynamic Content Updates**: Parameters and descriptions update based on selected version

### v0.1.6
- **Bug Fixes**: TypeScript compilation errors resolved
- **Performance Improvements**: Optimized component fetching and caching
- **UI Polish**: Enhanced browser interface and user experience

### v0.1.5
- **Component Browser**: New hierarchical, collapsible component browser
- **Version Management**: Dropdown selection for component versions/tags
- **Component Details View**: Dedicated panel for viewing component information
- **Dynamic Version Fetching**: Real-time fetching of specific component versions
- **Insert with Parameters**: Option to insert components with all input parameters
- **Persistent Cache**: VS Code globalState-based caching across sessions
- **Right-click Context Menus**: Set default versions or always-use-latest preferences
- **Professional UI**: Modern, VS Code-native interface with proper theming

### v0.1.0-0.1.4
- **Core Completion**: Basic component completion and hover support
- **GitLab Integration**: Connection to GitLab API for component discovery
- **Cache System**: File-based caching for performance
- **Multiple Sources**: Support for multiple GitLab component sources
- **YAML Detection**: Automatic detection of GitLab CI files

## API Reference

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

## Development

### Prerequisites

- VSCode
- Node.js 14.x or higher
- Yarn or npm

### Setup

```bash
git clone https://github.com/username/gitlab-component-helper.git
cd gitlab-component-helper
yarn install # or npm install
```

### Build

```bash
yarn compile # or npm run compile
```

### Debug

1. Open the project in VSCode
2. Press F5 to start debugging
3. A new VSCode window will open with the extension loaded

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

Distributed under the MIT License. See `LICENSE` for more information.

## User Settings Reference

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
