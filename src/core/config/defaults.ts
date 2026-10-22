/**
 * Defaults for every `gitlabComponentHelper.*` setting, copied from package.json `contributes.configuration`. The
 * extension host already applies the package.json defaults itself; this copy is what hosts without VS Code (unit
 * tests, the MCP server) fall back to. `tests/unit/configDefaults.test.ts` keeps the two in sync.
 */

import type { ComponentSource } from '../../types/api';

export const CONFIG_SECTION = 'gitlabComponentHelper';

export interface ConfigValues {
  gitlabToken: string;
  cacheTime: number;
  logLevel: string;
  autoShowOutput: boolean;
  httpTimeout: number;
  retryAttempts: number;
  batchSize: number;
  componentSources: ComponentSource[];
  'discovery.templateRoots': string[];
  'discovery.maxDepth': number;
  'discovery.filePatterns': string[];
  'discovery.templateFileNames': string[];
  additionalFileGlobs: string[];
  'versionCheck.enabled': boolean;
  'versionCheck.severity': 'warning' | 'information';
  versionPreferences: Record<string, string>;
  'mcp.enabled': boolean;
}

/** A setting name without the `gitlabComponentHelper.` prefix. */
export type ConfigKey = keyof ConfigValues;

/**
 * The settings a workspace (a cloned repository's files or `.vscode/settings.json`) may set for the MCP server:
 * catalog and checking behavior only. Everything else (network, cache, logging) comes from user scope.
 */
export const WORKSPACE_SETTABLE_KEYS: ReadonlySet<ConfigKey> = new Set<ConfigKey>([
  'componentSources',
  'discovery.templateRoots',
  'discovery.maxDepth',
  'discovery.filePatterns',
  'discovery.templateFileNames',
  'additionalFileGlobs',
  'versionCheck.enabled',
  'versionCheck.severity',
  'versionPreferences',
]);

export const CONFIG_DEFAULTS: Readonly<ConfigValues> = Object.freeze({
  gitlabToken: '',
  cacheTime: 3600,
  logLevel: 'ERROR',
  autoShowOutput: false,
  httpTimeout: 10000,
  retryAttempts: 3,
  batchSize: 5,
  componentSources: [
    { name: 'GitLab CI Examples', path: 'gitlab-org/gitlab-foss', gitlabInstance: 'gitlab.com' },
    { name: 'OpenTofu Components', path: 'components/opentofu', gitlabInstance: 'gitlab.com' },
    { name: 'Detect Secrets Components', path: 'components/detect-secrets', gitlabInstance: 'gitlab.com' },
  ],
  'discovery.templateRoots': ['templates'],
  'discovery.maxDepth': 1,
  'discovery.filePatterns': ['*.yml', '*.yaml'],
  'discovery.templateFileNames': ['template.yml', 'template.yaml'],
  additionalFileGlobs: [],
  'versionCheck.enabled': true,
  'versionCheck.severity': 'warning',
  versionPreferences: {},
  'mcp.enabled': true,
});
