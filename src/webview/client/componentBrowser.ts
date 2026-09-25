/**
 * Client script for the Component Browser.
 *
 * Runs in the webview, not the extension host. The document still binds its controls with `onclick`/`onchange`
 * attributes, which resolve against the global scope, so the functions they name are assigned to `window` at the end
 * of this file — the bundle is an IIFE and would otherwise keep them private. Those attributes, and this export
 * block with them, go when the browser moves to delegated listeners under a CSP.
 */

import { renderInlineMarkdown } from '../inlineMarkdown';

/** A component version as the browser holds it, keyed by component name then version string. */
interface VersionEntry {
  version: string;
  description?: string;
  sourcePath: string;
  gitlabInstance?: string;
}

/** Which component a context-menu action applies to, captured when the menu opens. */
interface ContextMenuData {
  componentName: string;
  version: string;
  projectId: string;
}

declare global {
  interface Window {
    componentVersionData: Record<string, Record<string, VersionEntry>>;
  }
}

const vscode = acquireVsCodeApi();

window.componentVersionData = readVersionData();

let contextMenuData: ContextMenuData | null = null;

/**
 * Read the version map the document embedded as JSON.
 *
 * @returns The map, or an empty one when the block is missing or malformed.
 */
function readVersionData(): Record<string, Record<string, VersionEntry>> {
  const element = document.getElementById('component-version-data');
  if (!element?.textContent) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(element.textContent);
  } catch {
    return {};
  }

  return isVersionData(parsed) ? parsed : {};
}

/** Narrow a parsed value to the version map: an object whose values are themselves objects. */
function isVersionData(value: unknown): value is Record<string, Record<string, VersionEntry>> {
  return typeof value === 'object'
    && value !== null
    && Object.values(value).every(entry => typeof entry === 'object' && entry !== null);
}

function toggleError(errorId: string): void {
  const errorDiv = document.getElementById(errorId);
  if (!errorDiv) {
    return;
  }
  const hidden = errorDiv.style.display === 'none' || errorDiv.style.display === '';
  errorDiv.style.display = hidden ? 'block' : 'none';
}

function updateToken(): void {
  vscode.postMessage({ command: 'updateToken' });
}

/** Expand or collapse a source group, flipping its disclosure arrow. */
function toggleSource(sourceId: string): void {
  toggleDisclosure(`source-content-${sourceId}`, `source-icon-${sourceId}`);
}

/** Expand or collapse a project group, flipping its disclosure arrow. */
function toggleProject(projectId: string): void {
  toggleDisclosure(`project-content-${projectId}`, `project-icon-${projectId}`);
}

/**
 * Show or hide a collapsible region and point its arrow accordingly.
 *
 * @param contentId Element holding the region's contents.
 * @param iconId    Element holding the disclosure arrow.
 */
function toggleDisclosure(contentId: string, iconId: string): void {
  const content = document.getElementById(contentId);
  const icon = document.getElementById(iconId);
  if (!content || !icon) {
    return;
  }

  const collapsed = content.style.display === 'none';
  content.style.display = collapsed ? 'block' : 'none';
  icon.textContent = collapsed ? '▼' : '▶';
}

/**
 * Ask the extension for a component's versions, showing the card's loading state until they arrive.
 *
 * @param _projectId Unused, but part of the signature the document's `onclick` attributes call with.
 */
function loadComponentVersions(
  componentName: string,
  sourcePath: string,
  gitlabInstance: string,
  _projectId: string
): void {
  const componentKey = `${componentName}-${sourcePath}`;
  const loadingElement = document.getElementById(`loading-${componentKey}`);
  const loadButton = document.querySelector<HTMLElement>(`#component-${componentKey} .load-versions-btn`);
  if (loadingElement) {
    loadingElement.style.display = 'inline';
  }
  if (loadButton) {
    loadButton.style.display = 'none';
  }
  vscode.postMessage({ command: 'fetchVersions', componentName, sourcePath, gitlabInstance });
}

window.addEventListener('message', event => {
  const message = event.data;
  if (message.command === 'versionsLoaded') {
    handleVersionsLoaded(message);
  } else if (message.command === 'versionsError') {
    handleVersionsError(message);
  }
});

/** Populate a component's actions with the versions the extension fetched. */
function handleVersionsLoaded(message: {
  componentName: string;
  sourcePath: string;
  versions: string[];
  defaultVersion: string;
  gitlabInstance?: string;
  versionLabels?: Record<string, string>;
}): void {
  const { componentName, sourcePath, versions, defaultVersion } = message;
  const componentKey = `${componentName}-${sourcePath}`;

  if (!window.componentVersionData[componentName]) {
    window.componentVersionData[componentName] = {};
  }
  versions.forEach(v => {
    window.componentVersionData[componentName][v] = {
      version: v,
      sourcePath,
      gitlabInstance: message.gitlabInstance || 'gitlab.com',
    };
  });

  const componentCard = document.getElementById(`component-${componentKey}`);
  if (!componentCard) {
    return;
  }

  const projectId = componentCard.getAttribute('data-project-id');
  const actionsDiv = document.getElementById(`actions-${componentKey}`);
  if (actionsDiv) {
    if (versions.length > 1) {
      // For monorepo sources the version values are full tags (e.g. <name>-1.1.0); the server sends a
      // versionLabels map (full tag → stripped {version}) so we display the short form while keeping the
      // full tag as the option value (the inserted ref).
      const labels = message.versionLabels || {};
      // Build the dropdown shell + buttons as markup, then append options via the DOM so the untrusted
      // version strings (tag names can contain <, >, &) are never interpolated into HTML.
      actionsDiv.innerHTML = '<select class="version-dropdown" onchange="updateComponentVersion(&#39;' + componentName + '&#39;, this.value, &#39;' + projectId + '&#39;)"></select><button onclick="viewDetailsById(&#39;' + componentName + '&#39;, &#39;' + defaultVersion + '&#39;, &#39;' + projectId + '&#39;)">Details</button><button onclick="insertComponentById(&#39;' + componentName + '&#39;, &#39;' + defaultVersion + '&#39;, &#39;' + projectId + '&#39;)">Insert</button>';
      const select = actionsDiv.querySelector('.version-dropdown');
      versions.forEach(v => {
        const option = document.createElement('option');
        option.value = v;
        option.textContent = labels[v] || v;
        if (v === defaultVersion) {
          option.selected = true;
        }
        select?.appendChild(option);
      });

      const descElement = document.getElementById(`desc-${componentName}-${projectId}`);
      if (descElement && !document.getElementById(`version-info-${componentName}-${projectId}`)) {
        const versionInfo = document.createElement('div');
        versionInfo.className = 'version-info';
        versionInfo.id = `version-info-${componentName}-${projectId}`;
        versionInfo.innerHTML = '<small>Default version: ' + defaultVersion + '</small>';
        descElement.parentNode?.insertBefore(versionInfo, descElement.nextSibling);
      }
    } else {
      const singleVersion = versions[0] || 'latest';
      actionsDiv.innerHTML = '<span class="single-version">' + singleVersion + '</span><button onclick="viewDetailsById(&#39;' + componentName + '&#39;, &#39;' + singleVersion + '&#39;, &#39;' + projectId + '&#39;)">Details</button><button onclick="insertComponentById(&#39;' + componentName + '&#39;, &#39;' + singleVersion + '&#39;, &#39;' + projectId + '&#39;)">Insert</button>';
    }
  }

  const titleSpan = componentCard.querySelector('.component-title');
  if (titleSpan && versions.length > 1 && !titleSpan.querySelector('.version-badge')) {
    const badge = document.createElement('span');
    badge.className = 'version-badge';
    badge.textContent = `${versions.length} versions`;
    titleSpan.appendChild(badge);
  }
}

/** Replace a component's actions with a failure message and a retry button. */
function handleVersionsError(message: {
  componentName: string;
  sourcePath: string;
  gitlabInstance?: string;
}): void {
  const componentKey = `${message.componentName}-${message.sourcePath}`;
  const loadingElement = document.getElementById(`loading-${componentKey}`);
  if (loadingElement) {
    loadingElement.style.display = 'none';
  }

  const actionsDiv = document.getElementById(`actions-${componentKey}`);
  if (actionsDiv) {
    actionsDiv.innerHTML = '<span class="error-message" style="color: red; font-size: 0.9em;">Failed to load versions</span><button class="load-versions-btn" onclick="loadComponentVersions(&#39;' + message.componentName + '&#39;, &#39;' + message.sourcePath + '&#39;, &#39;' + (message.gitlabInstance || 'gitlab.com') + '&#39;, &#39;&#39;)">Retry</button>';
  }
}

/** Repoint a component's card, description and action buttons at the newly selected version. */
function updateComponentVersion(componentName: string, selectedVersion: string, projectId: string): void {
  const componentData = window.componentVersionData[componentName];
  if (!componentData || !componentData[selectedVersion]) {
    console.warn('Version data not found for', componentName, selectedVersion);

    // Try to fetch this version dynamically
    const componentCard = document.querySelector(
      `[data-component-name="${componentName}"][data-project-id="${projectId}"]`
    );
    if (componentCard) {
      const sourcePath = componentCard.getAttribute('data-source-path');
      const gitlabInstance = componentCard.getAttribute('data-gitlab-instance');

      if (sourcePath && gitlabInstance) {
        // Show loading state
        const versionInfoElement = document.getElementById(`version-info-${componentName}-${projectId}`);
        if (versionInfoElement) {
          versionInfoElement.innerHTML = '<small>Loading version ' + selectedVersion + '...</small>';
        }

        vscode.postMessage({
          command: 'fetchVersion',
          componentName,
          sourcePath,
          gitlabInstance,
          version: selectedVersion,
        });
      }
    }
    return;
  }

  const versionData = componentData[selectedVersion];

  const descElement = document.getElementById(`desc-${componentName}-${projectId}`);
  if (descElement) {
    descElement.innerHTML = renderInlineMarkdown(versionData.description || '');
  }

  const versionInfoElement = document.getElementById(`version-info-${componentName}-${projectId}`);
  if (versionInfoElement) {
    versionInfoElement.innerHTML = '<small>Selected version: ' + selectedVersion + '</small>';
  }

  // The selected version lives in the buttons' `onclick` text, so it is rewritten rather than stored.
  const insertButton = document.querySelector(
    `[data-component-name="${componentName}"][data-project-id="${projectId}"] button[onclick*="insertComponent"]`
  );
  if (insertButton) {
    insertButton.setAttribute(
      'onclick',
      `insertComponentById("${componentName}", "${selectedVersion}", "${projectId}")`
    );
  }

  const detailsButton = document.querySelector(
    `[data-component-name="${componentName}"][data-project-id="${projectId}"] button[onclick*="viewDetails"]`
  );
  if (detailsButton) {
    detailsButton.setAttribute(
      'onclick',
      `viewDetailsById("${componentName}", "${selectedVersion}", "${projectId}")`
    );
  }
}

function refreshComponents(): void {
  vscode.postMessage({ command: 'refreshComponents' });
}

function updateCache(): void {
  vscode.postMessage({ command: 'updateCache' });
}

function resetCache(): void {
  vscode.postMessage({ command: 'resetCache' });
}

/** Open the details panel for a component at a given version. */
function viewDetailsById(componentName: string, version: string): void {
  const componentData = window.componentVersionData[componentName];
  if (componentData && componentData[version]) {
    // Send the raw component data; the server computes the template-file URL when it renders the details panel.
    const component = { ...componentData[version], name: componentName, version };
    vscode.postMessage({ command: 'viewComponentDetails', component });
  }
}

/** Insert a component at a given version into the active editor. */
function insertComponentById(componentName: string, version: string): void {
  const componentData = window.componentVersionData[componentName];
  if (componentData && componentData[version]) {
    const versionData = componentData[version];
    vscode.postMessage({
      command: 'insertComponent',
      component: {
        name: componentName,
        sourcePath: versionData.sourcePath,
        version,
        gitlabInstance: versionData.gitlabInstance || 'gitlab.com',
      },
    });
  }
}

/**
 * Filter the tree to components matching the search box, hiding projects and sources left with no matches and
 * expanding those that still have some.
 */
function filterComponents(): void {
  const search = document.getElementById('search');
  const searchText = search instanceof HTMLInputElement ? search.value.toLowerCase() : '';
  const cards = document.getElementsByClassName('component-card');

  const visibleProjects = new Set<string>();
  const visibleSources = new Set<string>();

  for (const card of cards) {
    if (!(card instanceof HTMLElement)) {
      continue;
    }
    const name = (card.getAttribute('data-name') || '').toLowerCase();
    const description = (card.getAttribute('data-description') || '').toLowerCase();

    if (name.includes(searchText) || description.includes(searchText)) {
      card.style.display = '';

      const projectContent = card.closest('.project-content');
      const sourceContent = card.closest('.source-content');
      if (projectContent) {
        visibleProjects.add(projectContent.id.replace('project-content-', ''));
      }
      if (sourceContent) {
        visibleSources.add(sourceContent.id.replace('source-content-', ''));
      }
    } else {
      card.style.display = 'none';
    }
  }

  revealGroups('project-group', '.project-content', 'project-content-', 'project-icon-', visibleProjects, searchText);
  revealGroups('source-group', '.source-content', 'source-content-', 'source-icon-', visibleSources, searchText);
}

/**
 * Show the groups that still contain a match and hide the rest, expanding a matching group while a search is active.
 *
 * @param groupClass    Class on the group wrapper.
 * @param contentSelect Selector for the group's collapsible content.
 * @param idPrefix      Prefix stripped from the content element's id to recover the group id.
 * @param iconPrefix    Prefix of the group's disclosure-arrow element id.
 * @param visible       Ids of the groups holding at least one match.
 * @param searchText    The current query; empty restores every group.
 */
function revealGroups(
  groupClass: string,
  contentSelect: string,
  idPrefix: string,
  iconPrefix: string,
  visible: Set<string>,
  searchText: string
): void {
  for (const group of document.getElementsByClassName(groupClass)) {
    if (!(group instanceof HTMLElement)) {
      continue;
    }
    const content = group.querySelector(contentSelect);
    if (!(content instanceof HTMLElement)) {
      continue;
    }

    const id = content.id.replace(idPrefix, '');
    const hasMatch = visible.has(id);

    if (hasMatch || searchText === '') {
      group.style.display = '';
      if (searchText !== '' && hasMatch) {
        content.style.display = 'block';
        const icon = document.getElementById(iconPrefix + id);
        if (icon) {
          icon.textContent = '▼';
        }
      }
    } else {
      group.style.display = 'none';
    }
  }
}

function showContextMenu(event: MouseEvent, componentName: string, version: string, projectId: string): void {
  event.preventDefault();
  event.stopPropagation();

  const contextMenu = document.getElementById('contextMenu');
  if (!contextMenu) {
    return;
  }

  contextMenuData = { componentName, version, projectId };
  contextMenu.style.display = 'block';
  contextMenu.style.left = `${event.pageX}px`;
  contextMenu.style.top = `${event.pageY}px`;
}

function hideContextMenu(): void {
  const contextMenu = document.getElementById('contextMenu');
  if (contextMenu) {
    contextMenu.style.display = 'none';
  }
  contextMenuData = null;
}

function setAsDefaultVersion(): void {
  if (contextMenuData) {
    vscode.postMessage({
      command: 'setDefaultVersion',
      componentName: contextMenuData.componentName,
      version: contextMenuData.version,
      projectId: contextMenuData.projectId,
    });
  }
  hideContextMenu();
}

function alwaysUseLatest(): void {
  if (contextMenuData) {
    vscode.postMessage({
      command: 'setAlwaysUseLatest',
      componentName: contextMenuData.componentName,
      projectId: contextMenuData.projectId,
    });
  }
  hideContextMenu();
}

document.addEventListener('click', event => {
  if (event.target instanceof Element && !event.target.closest('.context-menu')) {
    hideContextMenu();
  }
});

window.addEventListener('message', event => {
  const message = event.data;
  if (message.command !== 'versionFetched') {
    return;
  }

  if (!window.componentVersionData[message.componentName]) {
    window.componentVersionData[message.componentName] = {};
  }
  window.componentVersionData[message.componentName][message.version] = message.component;

  const projectId = findProjectIdForComponent(message.componentName);
  if (projectId) {
    updateComponentVersion(message.componentName, message.version, projectId);
  }
});

/** Find which project a component card belongs to, for messages that carry only a component name. */
function findProjectIdForComponent(componentName: string): string | null {
  const componentCard = document.querySelector(`[data-component-name="${componentName}"]`);
  return componentCard ? componentCard.getAttribute('data-project-id') : null;
}

// The document's `onclick`/`onchange` attributes resolve against the global scope, which this bundle's IIFE is not.
Object.assign(window, {
  alwaysUseLatest,
  filterComponents,
  insertComponentById,
  loadComponentVersions,
  refreshComponents,
  resetCache,
  setAsDefaultVersion,
  showContextMenu,
  toggleError,
  toggleProject,
  toggleSource,
  updateCache,
  updateComponentVersion,
  updateToken,
  viewDetailsById,
});

export {};
