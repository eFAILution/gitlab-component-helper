/**
 * Pure helpers for filtering and naming the YAML template files that `ComponentFetcher.fetchCatalogData` indexes
 * out of a project's `templates/` directory.
 *
 * Separated from `componentFetcher.ts` so the unit suite can exercise the filtering and naming logic against
 * synthetic `GitLabTreeItem` lists without spinning up `HttpClient`. The fetch loop, batching, and template-content
 * resolution stay in the class.
 */

import type { GitLabTreeItem } from '../../types/api';

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
