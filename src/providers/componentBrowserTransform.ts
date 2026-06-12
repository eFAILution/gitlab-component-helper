/**
 * Pure helpers for the Component Browser's "what to show in the tree" stage. Given the flat list of cached
 * components, produce a nested `source → project → component → versions` array shape the webview consumes.
 */

import type { CachedComponent } from '../types/cache';
import type {
  SourceGroup,
  SourceGroupBuilder,
  ProjectGroupBuilder,
  ComponentGroupBuilder,
} from './componentBrowserTypes';
import { compileTagTemplate } from '../services/component/tagScoping';

/**
 * Convert a `https://host/group/project/name@version` component URL into the public GitLab project URL by stripping
 * the trailing `name` segment and the `@version` suffix.
 *
 * @param componentUrl  The component URL from the catalog, or `undefined`. Strings that aren't valid URLs are
 *                      returned verbatim so the caller's UI still renders something.
 * @returns             A project URL like `https://host/group/project`, or `''` when no URL was supplied.
 */
export function extractProjectUrl(componentUrl: string | undefined): string {
  try {
    if (!componentUrl) {
      return '';
    }
    const urlWithoutVersion = componentUrl.includes('@') ? componentUrl.split('@')[0] : componentUrl;
    const url = new URL(urlWithoutVersion);
    const pathParts = url.pathname.substring(1).split('/');
    if (pathParts.length > 0) {
      pathParts.pop();
    }
    return `${url.protocol}//${url.host}/${pathParts.join('/')}`;
  } catch {
    return componentUrl || '';
  }
}

/**
 * Score function used to pick a component's default version. Higher score wins. Branch names get fixed priorities
 * (`latest` > `main` > `master`); semantic versions get a packed integer score derived from `major.minor.patch`.
 * Anything else (unrecognised) scores 0.
 */
export function versionPriority(version: string | undefined): number {
  if (!version) return 0;
  if (version === 'latest') return 1000;
  if (version === 'main') return 900;
  if (version === 'master') return 800;

  const semanticMatch = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (semanticMatch) {
    const major = parseInt(semanticMatch[1]);
    const minor = parseInt(semanticMatch[2]);
    const patch = parseInt(semanticMatch[3]);
    return major * 1000000 + minor * 1000 + patch;
  }

  return 0;
}

/**
 * Pick a default version from `availableVersions`. Wins go to the highest `versionPriority`; if the winner is the
 * synthetic `'latest'` tag, resolve it by re-running the priority pass on the remaining versions so users land on a
 * pinned semver instead of the floating tag.
 *
 * @param availableVersions  Candidates. May include falsy entries (filtered out internally). For a monorepo source
 *                           these are full tags (`<name>-1.1.0`, `apps/<name>/v1.1.0`).
 * @param fallback           Returned when `availableVersions` has no truthy entries.
 * @param monorepoComponent  When set, candidates are scored with the tag-version template applied (the `{version}`
 *                           capture), so monorepo tags rank by their underlying semver. The returned value is the
 *                           original (full) tag.
 */
export function selectDefaultVersion(
  availableVersions: string[],
  fallback: string,
  monorepoComponent?: { name: string; tagPattern?: string },
): string {
  const validVersions = availableVersions.filter(Boolean);
  if (validVersions.length === 0) return fallback;

  const matcher = monorepoComponent
    ? compileTagTemplate(monorepoComponent.tagPattern, monorepoComponent.name)
    : null;
  const score = (version: string): number =>
    versionPriority(matcher?.extractVersion(version) ?? version);

  const bestVersionString = validVersions.reduce(
    (best, current) => (score(current) > score(best) ? current : best),
    validVersions[0],
  );

  if (bestVersionString !== 'latest') return bestVersionString;

  // Best is the floating `latest` tag — resolve it to the highest non-latest version.
  const nonLatestVersions = validVersions.filter((v) => v !== 'latest');
  if (nonLatestVersions.length === 0) return bestVersionString;
  return nonLatestVersions.reduce(
    (best, current) => (score(current) > score(best) ? current : best),
    nonLatestVersions[0],
  );
}

/** Optional hook for surfacing skipped entries — production passes the logger, tests can omit it. */
export type OnSkip = (component: unknown, reason: string) => void;

/**
 * Build the nested `source → project → component → versions` tree the Component Browser webview consumes from a
 * flat list of cached components.
 *
 * Each cached entry must carry `source`, `sourcePath`, and `name` to be included — anything missing is dropped via
 * `onSkip`. Components with the same `name` inside the same project are merged: each subsequent entry contributes
 * its `version` to the component's `versions` map (and any `availableVersions` are union-merged).
 *
 * @param cachedComponents  The flat list pulled from `ComponentCacheManager`.
 * @param onSkip            Called once per dropped entry. Tests typically omit this.
 * @returns                 An array of source-group objects.
 */
export function transformCachedComponentsToGroups(
  cachedComponents: Array<Partial<CachedComponent>>,
  onSkip?: OnSkip,
): SourceGroup[] {
  const hierarchy = new Map<string, SourceGroupBuilder>();

  for (const comp of cachedComponents) {
    if (!comp.source || !comp.sourcePath || !comp.name) {
      onSkip?.(comp, 'missing source/sourcePath/name');
      continue;
    }

    const mainSource = comp.source.split('/')[0];

    // For group sources `Source/Project`, the project label is the trailing segment; for a bare source it's the
    // whole string.
    let projectName = comp.source;
    const projectPath = comp.sourcePath;
    if (comp.source.includes('/')) {
      const parts = comp.source.split('/');
      projectName = parts[parts.length - 1];
    }

    let sourceGroup = hierarchy.get(mainSource);
    if (!sourceGroup) {
      sourceGroup = {
        source: mainSource,
        type: 'source',
        isExpanded: true,
        projects: new Map<string, ProjectGroupBuilder>(),
        totalComponents: 0,
        totalVersions: 0,
      };
      hierarchy.set(mainSource, sourceGroup);
    }

    const gitlabInstance = comp.gitlabInstance || 'gitlab.com';
    const projectKey = `${projectPath}@${gitlabInstance}`;
    let projectGroup = sourceGroup.projects.get(projectKey);
    if (!projectGroup) {
      projectGroup = {
        name: projectName,
        path: projectPath,
        gitlabInstance,
        type: 'project',
        isExpanded: false,
        components: new Map<string, ComponentGroupBuilder>(),
      };
      sourceGroup.projects.set(projectKey, projectGroup);
    }

    let componentGroup = projectGroup.components.get(comp.name);
    if (!componentGroup) {
      componentGroup = {
        name: comp.name,
        description: comp.description || 'No description available',
        summary: comp.summary,
        usage: comp.usage,
        notes: comp.notes,
        rawYaml: comp.rawYaml,
        parameters: comp.parameters || [],
        source: comp.source,
        sourcePath: comp.sourcePath,
        gitlabInstance: comp.gitlabInstance || 'gitlab.com',
        documentationUrl: comp.url ? extractProjectUrl(comp.url) : '',
        versions: new Map(),
        defaultVersion: comp.version || 'latest',
        availableVersions: comp.availableVersions || [],
        tagPattern: comp.tagPattern,
      };
      projectGroup.components.set(comp.name, componentGroup);
      sourceGroup.totalComponents++;
    } else if (comp.availableVersions) {
      // Same component name seen again — union the available-versions lists.
      const merged = new Set([...componentGroup.availableVersions, ...comp.availableVersions]);
      componentGroup.availableVersions = Array.from(merged);
    }

    componentGroup.versions.set(comp.version || 'latest', {
      version: comp.version || 'latest',
      description: comp.description || 'No description available',
      summary: comp.summary,
      usage: comp.usage,
      notes: comp.notes,
      rawYaml: comp.rawYaml,
      parameters: comp.parameters || [],
      documentationUrl: comp.url ? extractProjectUrl(comp.url) : '',
      source: comp.source,
      sourcePath: comp.sourcePath,
      gitlabInstance: comp.gitlabInstance || 'gitlab.com',
    });

    sourceGroup.totalVersions++;
  }

  return Array.from(hierarchy.values()).map((source) => ({
    ...source,
    projectCount: source.projects.size,
    componentCount: source.totalComponents,
    projects: Array.from(source.projects.values()).map((project) => ({
      ...project,
      components: Array.from(project.components.values()).map((component) => {
        const availableVersions: string[] =
          component.availableVersions && component.availableVersions.length > 0
            ? component.availableVersions
            : component.versions.size > 0
              ? Array.from(component.versions.keys()) as string[]
              : [component.defaultVersion || 'latest'];

        const versions = availableVersions.filter(Boolean).map((version: string) => {
          const versionData = component.versions.get(version);
          return {
            version,
            description: versionData?.description || component.description || 'No description available',
            summary: versionData?.summary || component.summary,
            usage: versionData?.usage || component.usage,
            notes: versionData?.notes || component.notes,
            rawYaml: versionData?.rawYaml || component.rawYaml,
            parameters: versionData?.parameters || component.parameters || [],
            documentationUrl: versionData?.documentationUrl || component.documentationUrl || '',
            source: versionData?.source || component.source,
            sourcePath: versionData?.sourcePath || component.sourcePath,
            gitlabInstance: versionData?.gitlabInstance || component.gitlabInstance || 'gitlab.com',
          };
        });

        const defaultVersion = selectDefaultVersion(
          availableVersions,
          component.defaultVersion || 'latest',
          component.tagPattern
            ? { name: component.name, tagPattern: component.tagPattern }
            : undefined,
        );

        return {
          ...component,
          versions,
          versionCount: availableVersions.filter(Boolean).length,
          defaultVersion,
          availableVersions: availableVersions.filter(Boolean),
          description: component.description || 'No description available',
          parameters: component.parameters || [],
          gitlabInstance: component.gitlabInstance || 'gitlab.com',
        };
      }),
    })),
  }));
}
