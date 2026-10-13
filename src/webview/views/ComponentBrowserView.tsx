import type { ComponentGroup, ProjectGroup, SourceGroup } from '../../providers/componentBrowserTypes';
import { stripTagPrefix } from '../../services/component/tagScoping';
import type { SourceError } from './ErrorsView';
import { InlineMarkdown, JsonScript, Page, PageAssets } from './Page';

export interface ComponentBrowserViewProps extends PageAssets {
  sources: SourceGroup[];
  cacheErrors: SourceError[];
  hasAuthError: boolean;
  /** Per-component version details, read by the client script from `#component-version-data`. */
  versionData: unknown;
}

/**
 * The Component Browser: search and cache controls, any per-source errors, then every configured source, its projects
 * and their components as a collapsible tree.
 *
 * @param props.sources      Sources with their projects and components, already grouped for display.
 * @param props.cacheErrors  Sources that failed, listed in a banner above the tree; empty omits it.
 * @param props.hasAuthError Whether any source failed on its token, which adds an "Update Token" button.
 * @param props.versionData  Per-component version details for the client script.
 * @returns                  The page element, for `renderDocument`.
 */
export function ComponentBrowserView(
  { sources, cacheErrors, hasAuthError, versionData, ...assets }: ComponentBrowserViewProps,
) {
  return (
    <Page title="GitLab CI/CD Components" {...assets}>
      <div class="header">
        <div class="search-container">
          <input type="text" id="search" data-action="filterComponents" placeholder="Search components..." />
        </div>
        <div class="cache-controls">
          <button class="refresh-btn" data-action="refreshComponents" title="Refresh components (reload current data)">
            🔄 Refresh
          </button>
          <button
            class="update-cache-btn"
            data-action="updateCache"
            title="Update cache (force fetch fresh data from all sources)"
          >
            📥 Update Cache
          </button>
          <button class="reset-cache-btn" data-action="resetCache" title="Reset cache (clear all cached data)">
            🗑️ Reset Cache
          </button>
        </div>
      </div>

      {cacheErrors.length > 0 && (
        <div class="error-section">
          <div class="error-header">⚠️ Cache Errors</div>
          {cacheErrors.map(({ source, summary, raw }, index) => (
            <div class="error-item">
              <div class="error-source">{source}</div>
              <div class="error-summary">{summary}</div>
              <button class="error-toggle" data-action="toggleError" data-target={`error-${index}`}>
                Show Details
              </button>
              <div class="error-details is-hidden" id={`error-${index}`}>{raw}</div>
            </div>
          ))}
          {hasAuthError && <button class="update-token-btn" data-action="updateToken">Update Token</button>}
        </div>
      )}

      <div class="components-container">
        {sources.length === 0 ? (
          <p class="no-components">
            No components found. Click "Refresh" to load components from your configured sources.
          </p>
        ) : (
          sources.map(source => <SourceSection source={source} />)
        )}
      </div>

      <div id="contextMenu" class="context-menu">
        <div class="context-menu-item" data-action="setAsDefaultVersion">Set as Default Version</div>
        <div class="context-menu-item" data-action="alwaysUseLatest">Always Use Latest</div>
      </div>

      <JsonScript id="component-version-data" nonce={assets.nonce} data={versionData} />
    </Page>
  );
}

/**
 * One source: a header that toggles its content, and its projects.
 *
 * @param props.source The source group to render.
 * @returns            The `.source-group` element.
 */
function SourceSection({ source }: { source: SourceGroup }) {
  const sourceId = source.source.replace(/[^a-zA-Z0-9]/g, '_');
  const projects = Array.isArray(source.projects) ? source.projects : [];
  return (
    <div class="source-group">
      <div class="source-header" data-action="toggleSource" data-target={sourceId}>
        <span class="source-icon" id={`source-icon-${sourceId}`}>{source.isExpanded ? '▼' : '▶'}</span>
        <span class="source-title">
          {source.source} ({source.projects?.length || 0} projects, {source.totalComponents || 0} components)
        </span>
      </div>
      <div class={`source-content ${source.isExpanded ? '' : 'is-hidden'}`} id={`source-content-${sourceId}`}>
        {projects.map(project => <ProjectSection project={project} sourceId={sourceId} />)}
      </div>
    </div>
  );
}

/**
 * One project within a source: a header that toggles its content, and its component cards.
 *
 * @param props.project  The project group to render.
 * @param props.sourceId The owning source's id-safe name, which prefixes the project's element ids.
 * @returns              The `.project-group` element.
 */
function ProjectSection({ project, sourceId }: { project: ProjectGroup; sourceId: string }) {
  const projectId = `${sourceId}_${project.path.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const components = Array.isArray(project.components) ? project.components : [];
  return (
    <div class="project-group">
      <div class="project-header" data-action="toggleProject" data-target={projectId}>
        <span class="project-icon" id={`project-icon-${projectId}`}>{project.isExpanded ? '▼' : '▶'}</span>
        <span class="project-title">{project.name} ({components.length})</span>
        <span class="project-path">{project.gitlabInstance}/{project.path}</span>
      </div>
      <div class={`project-content ${project.isExpanded ? '' : 'is-hidden'}`} id={`project-content-${projectId}`}>
        {components.length === 0 ? (
          <p class="no-components">No components found in this project</p>
        ) : (
          components.map(component => <ComponentCard component={component} projectId={projectId} />)
        )}
      </div>
    </div>
  );
}

/**
 * One component's card. With versions known it offers a version choice plus Details and Insert; without, a Load
 * Versions button. The `data-*` attributes and ids are what the client script reads, so they must not change.
 *
 * @param props.component The component group to render.
 * @param props.projectId The owning project's id, which suffixes the card's description and version-info ids.
 * @returns               The `.component-card` element.
 */
function ComponentCard({ component, projectId }: { component: ComponentGroup; projectId: string }) {
  const componentKey = `${component.name}-${component.sourcePath}`;
  const initialVersion = component.defaultVersion || component.availableVersions[0];
  const hasVersions = component.availableVersions && component.availableVersions.length > 0;
  const hasManyVersions = hasVersions && component.availableVersions.length > 1;

  return (
    <div
      class="component-card"
      data-name={component.name}
      data-description={component.description || ''}
      data-component-name={component.name}
      data-project-id={projectId}
      data-source-path={component.sourcePath}
      data-gitlab-instance={component.gitlabInstance}
      data-version={initialVersion}
      id={`component-${componentKey}`}
    >
      <div class="component-header">
        <span class="component-title">
          {component.name}
          {hasManyVersions && <span class="version-badge">{component.availableVersions.length} versions</span>}
        </span>
        <div class="component-actions" id={`actions-${componentKey}`}>
          {hasVersions ? (
            <>
              {hasManyVersions ? (
                <select class="version-dropdown" data-action="selectVersion">
                  <VersionOptions component={component} />
                </select>
              ) : (
                <span class="single-version">{initialVersion || 'latest'}</span>
              )}
              <button data-role="details" data-action="viewDetails">Details</button>
              <button data-role="insert" data-action="insertComponent">Insert</button>
            </>
          ) : (
            <>
              <button class="load-versions-btn" data-action="loadVersions">Load Versions</button>
              <span class="loading-versions is-hidden" id={`loading-${componentKey}`}>Loading...</span>
            </>
          )}
        </div>
      </div>
      <InlineMarkdown
        class="component-description"
        id={`desc-${component.name}-${projectId}`}
        text={component.description || ''}
      />
      {hasManyVersions && (
        <div class="version-info" id={`version-info-${component.name}-${projectId}`}>
          <small>Default version: {component.defaultVersion}</small>
        </div>
      )}
    </div>
  );
}

/**
 * The version dropdown's options, with the component's default pre-selected.
 *
 * For a monorepo source the available versions are full prefixed tags (`<name>-1.1.0`). The option value is always
 * the full tag (the ref inserted into the file); only the visible label is the prefix-stripped form.
 *
 * @param props.component The component whose `availableVersions` become the options.
 * @returns               A fragment of `<option>` elements.
 */
function VersionOptions({ component }: { component: ComponentGroup }) {
  return (
    <>
      {component.availableVersions.map(version => (
        <option value={version} selected={version === component.defaultVersion}>
          {component.tagPattern ? stripTagPrefix(version, component.name, component.tagPattern) : version}
        </option>
      ))}
    </>
  );
}
