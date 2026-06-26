# Extension API

> **Status: not yet exposed.** `activate()` does not currently return this API, so `getExtension(...).activate()` resolves to `undefined`. This documents the *intended* contract for other extensions to consume; track its implementation before depending on it. See the [README](../README.md) for user-facing features.

## Intended interface

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
    default?: unknown;
}
```

## Intended usage

```typescript
const api = await vscode.extensions.getExtension('eFAILution.gitlab-component-helper')?.activate();
if (api) {
    const components = await api.getComponentList();
    // Use components...
}
```
