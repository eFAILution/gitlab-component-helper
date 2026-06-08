/**
 * Pure helpers for filtering and naming the YAML template files that `ComponentFetcher.fetchCatalogData` indexes
 * out of a project's `templates/` directory.
 *
 * Separated from `componentFetcher.ts` so the unit suite can exercise the filtering and naming logic against
 * synthetic `GitLabTreeItem` lists without spinning up `HttpClient`. The fetch loop, batching, and template-content
 * resolution stay in the class.
 */

import type { GitLabTreeItem } from '../../types/api';
import type { ParsedCatalogComponent } from '../../types/gitlab-catalog';
import { GitLabSpecParser } from '../../parsers/specParser';

/**
 * Filter a list of repository-tree entries down to the YAML *blobs* (not subdirectories). Used for both the
 * top-level `templates/` scan and the one-level-deep subdirectory scans.
 *
 * @param items Tree entries from `…/repository/tree` for a given path.
 * @returns Only the entries with `type === 'blob'` and a `.yml` / `.yaml` extension.
 */
export function filterYamlBlobs(items: readonly GitLabTreeItem[]): GitLabTreeItem[] {
  return items.filter(
    (item) => item.type === 'blob' && (item.name.endsWith('.yml') || item.name.endsWith('.yaml')),
  );
}

/**
 * Filter a list of repository-tree entries down to its subdirectory entries. Used to find which child folders of
 * `templates/` to recurse into.
 *
 * @param items Tree entries from `…/repository/tree`.
 * @returns Only the entries with `type === 'tree'`.
 */
export function filterSubdirectories(items: readonly GitLabTreeItem[]): GitLabTreeItem[] {
  return items.filter((item) => item.type === 'tree');
}

/**
 * Derive the component name for a `templates/`-rooted file path, following GitLab's two recognised component
 * layouts:
 *
 *  - **Single-file form** — `templates/<name>.yml` → component `<name>`.
 *  - **Directory form** — `templates/<name>/<entryFile>.yml` where `<entryFile>.yml` is one of `templateFileNames`
 *    (default `template.yml` / `template.yaml`) → component `<name>`.
 *
 * Files nested under `templates/<name>/` that *aren't* the canonical entry file (e.g. `templates/security/scanner.yml`,
 * `templates/security/README.yml`) are **not** valid components on their own and return `null`. Prior to this fix
 * those files collided into a single (silently-overwriting) component named `<name>` (the directory).
 *
 * @param filePath          Repo-relative path of the YAML file, e.g. `templates/foo/template.yml`. Paths outside
 *                          `templates/` return `null`.
 * @param templateFileNames Filenames recognised as the canonical entry file inside a per-component subdirectory.
 *                          Defaults to `['template.yml', 'template.yaml']`.
 * @returns The component name, or `null` if the file isn't a recognised component entry.
 */
export function deriveComponentName(
  filePath: string,
  templateFileNames: readonly string[] = ['template.yml', 'template.yaml'],
): string | null {
  if (!filePath.startsWith('templates/')) return null;

  const relativePath = filePath.slice('templates/'.length);
  if (!relativePath) return null;

  const slashCount = (relativePath.match(/\//g) ?? []).length;

  if (slashCount === 0) {
    // Single-file form: templates/<name>.yml
    const name = relativePath.replace(/\.ya?ml$/, '');
    return name === relativePath ? null : name; // Reject non-YAML
  }

  if (slashCount === 1) {
    // Directory form: templates/<name>/<entryFile>
    const [directory, fileName] = relativePath.split('/');
    if (!templateFileNames.includes(fileName)) return null;
    return directory;
  }

  // Deeper nesting isn't part of GitLab's component layout — skip.
  return null;
}

/**
 * The slice of `HttpClient` the catalog pipeline needs. Typed structurally rather than against the concrete
 * `HttpClient` class so this module stays free of the `vscode` import that `HttpClient` carries — letting the
 * pipeline run under the plain-Node Mocha suite with a duck-typed mock. The real `HttpClient` satisfies it.
 */
export interface CatalogHttpClient {
  fetchJson<T = unknown>(url: string, options?: { headers?: Record<string, string> }): Promise<T>;
  fetchText(url: string, options?: { headers?: Record<string, string> }): Promise<string>;
  processBatch<T, R>(items: T[], processor: (item: T) => Promise<R>, batchSize?: number): Promise<R[]>;
}

/**
 * Fetch the YAML template files for a project, scanning `templates/` plus one nested directory level.
 *
 * Subdirectory contents that fail to fetch degrade to an empty list so one bad folder doesn't sink the scan.
 *
 * @param http        HTTP client used for the tree requests.
 * @param apiBaseUrl  GitLab API v4 base, e.g. `https://gitlab.com/api/v4`.
 * @param projectPath URL-path of the project, e.g. `group/project`.
 * @param ref         Git ref to read the tree at.
 * @param fetchOptions Optional request headers (e.g. a `PRIVATE-TOKEN`).
 * @returns The YAML blob entries from the top level and each immediate subdirectory.
 */
export async function fetchAllTemplateFiles(
  http: CatalogHttpClient,
  apiBaseUrl: string,
  projectPath: string,
  ref: string,
  fetchOptions?: { headers?: Record<string, string> },
): Promise<GitLabTreeItem[]> {
  const treeUrl = `${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}/repository/tree?path=templates&ref=${ref}`;
  const topLevel = await http
    .fetchJson<GitLabTreeItem[]>(treeUrl, fetchOptions)
    .catch(() => [] as GitLabTreeItem[]);

  const yamlFiles: GitLabTreeItem[] = filterYamlBlobs(topLevel);

  const subdirs = filterSubdirectories(topLevel);
  for (const subdir of subdirs) {
    const subdirUrl = `${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}/repository/tree?path=${encodeURIComponent('templates/' + subdir.name)}&ref=${ref}`;
    const subdirContents = await http
      .fetchJson<GitLabTreeItem[]>(subdirUrl, fetchOptions)
      .catch(() => [] as GitLabTreeItem[]);
    yamlFiles.push(...filterYamlBlobs(subdirContents));
  }

  return yamlFiles;
}

/**
 * Resolve a list of YAML template files into catalog components, fetching and parsing each in batches.
 *
 * A file is dropped (no component emitted) when any of these hold:
 *  - its path isn't a recognised component layout (`deriveComponentName` returns `null`),
 *  - its content can't be fetched,
 *  - its content has no valid `spec:` section (`isValidComponent` is false).
 *
 * @param http        HTTP client used for the raw-file requests.
 * @param apiBaseUrl  GitLab API v4 base.
 * @param projectId   Numeric or string project id for the raw-file endpoint.
 * @param yamlFiles   Template files to resolve (typically from `fetchAllTemplateFiles`).
 * @param ref         Git ref to read each file at; also becomes each component's `latest_version`.
 * @param batchSize   Concurrency for the per-file fetch.
 * @param fetchOptions Optional request headers.
 * @returns One `ParsedCatalogComponent` per surviving file.
 */
export async function buildCatalogComponents(
  http: CatalogHttpClient,
  apiBaseUrl: string,
  projectId: string | number,
  yamlFiles: readonly GitLabTreeItem[],
  ref: string,
  batchSize: number,
  fetchOptions?: { headers?: Record<string, string> },
): Promise<ParsedCatalogComponent[]> {
  const results = await http.processBatch(
    [...yamlFiles],
    async (file: GitLabTreeItem): Promise<ParsedCatalogComponent | null> => {
      const name = deriveComponentName(file.path);
      if (name === null) return null;

      const relativePath = file.path.slice('templates/'.length);

      try {
        const contentUrl = `${apiBaseUrl}/projects/${projectId}/repository/files/${encodeURIComponent('templates/' + relativePath)}/raw?ref=${ref}`;
        const content = await http.fetchText(contentUrl, fetchOptions);
        const parsedSpec = GitLabSpecParser.parse(content, relativePath);
        if (!parsedSpec.isValidComponent) return null;

        return {
          name,
          description: parsedSpec.description || `${name} component`,
          variables: parsedSpec.variables,
          latest_version: ref,
          templatePath: file.path,
        };
      } catch {
        // Couldn't fetch or parse the template — drop just this one (don't abort the whole catalog).
        return null;
      }
    },
    batchSize,
  );

  return results.filter((c): c is ParsedCatalogComponent => c !== null);
}
