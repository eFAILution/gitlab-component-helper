/**
 * Client script for the Component Browser.
 *
 * Runs in the webview, not the extension host, under a nonce CSP that forbids inline handlers. Controls carry a
 * `data-action` naming an entry in `ACTIONS`; one delegated listener per event type dispatches them, so controls this
 * script builds at runtime need no binding of their own.
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
  sourcePath: string;
  gitlabInstance: string;
}

const vscode = acquireVsCodeApi();

/**
 * Every version the browser knows about, by component name then version string.
 *
 * Maps rather than plain objects: both keys are set by whoever publishes the component, and `__proto__` is a legal
 * file name and git tag. On an object, `data[name][version] = …` with either key set to `__proto__` writes through
 * to `Object.prototype`, and reading `data['constructor']` returns a function. A `Map` has no such keys.
 */
const versionStore = readVersionData();

let contextMenuData: ContextMenuData | null = null;

/**
 * Read the version map the document embedded as JSON.
 *
 * @returns The map, or an empty one when the block is missing or malformed. Only well-formed entries are kept.
 */
function readVersionData(): Map<string, Map<string, VersionEntry>> {
  const store = new Map<string, Map<string, VersionEntry>>();
  const element = document.getElementById('component-version-data');
  if (!element?.textContent) {
    return store;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(element.textContent);
  } catch {
    return store;
  }
  if (!isObject(parsed)) {
    return store;
  }

  for (const [componentName, versions] of Object.entries(parsed)) {
    if (!isObject(versions)) {
      continue;
    }
    const entries = Object.entries(versions).filter((pair): pair is [string, VersionEntry] => isObject(pair[1]));
    store.set(componentName, new Map(entries));
  }
  return store;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Record one version of a component. */
function storeVersion(componentName: string, version: string, entry: VersionEntry): void {
  let versions = versionStore.get(componentName);
  if (!versions) {
    versions = new Map();
    versionStore.set(componentName, versions);
  }
  versions.set(version, entry);
}

/** A component's entry at one version, if the browser has it. */
function findVersion(componentName: string, version: string): VersionEntry | undefined {
  return versionStore.get(componentName)?.get(version);
}

/**
 * Build the Details and Insert buttons for a component at a version.
 *
 * Built as elements with listeners rather than as markup with `onclick` text: the component name and version are set
 * by whoever publishes the component, and git accepts quotes and angle brackets in a tag name, so interpolating them
 * into HTML or into a handler's JavaScript lets a tag run code in this panel.
 */
function actionButtons(componentName: string, version: string): HTMLButtonElement[] {
  const details = document.createElement('button');
  details.textContent = 'Details';
  details.dataset.role = 'details';
  details.onclick = () => viewDetailsById(componentName, version);

  const insert = document.createElement('button');
  insert.textContent = 'Insert';
  insert.dataset.role = 'insert';
  insert.onclick = () => insertComponentById(componentName, version);

  return [details, insert];
}

/** A `<small>` holding plain text, for the version line under a component's description. */
function smallText(text: string): HTMLElement {
  const small = document.createElement('small');
  small.textContent = text;
  return small;
}

function toggleError(errorId: string): void {
  document.getElementById(errorId)?.classList.toggle('is-hidden');
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

  const expanded = content.classList.toggle('is-hidden') === false;
  icon.textContent = expanded ? '▼' : '▶';
}

/**
 * Ask the extension for a component's versions, showing the card's loading state until they arrive.
 *
 * @param _projectId Unused. Kept so callers can pass a card's four identifying fields positionally.
 */
function loadComponentVersions(
  componentName: string,
  sourcePath: string,
  gitlabInstance: string,
  _projectId: string
): void {
  const componentKey = `${componentName}-${sourcePath}`;
  const loadingElement = document.getElementById(`loading-${componentKey}`);
  const loadButton = document.getElementById(`component-${componentKey}`)?.querySelector<HTMLElement>('.load-versions-btn');
  loadingElement?.classList.remove('is-hidden');
  loadButton?.classList.add('is-hidden');
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

  versions.forEach(v => {
    storeVersion(componentName, v, {
      version: v,
      sourcePath,
      gitlabInstance: message.gitlabInstance || 'gitlab.com',
    });
  });

  const componentCard = document.getElementById(`component-${componentKey}`);
  if (!componentCard) {
    return;
  }

  const projectId = componentCard.getAttribute('data-project-id') || '';
  const actionsDiv = document.getElementById(`actions-${componentKey}`);
  if (actionsDiv) {
    if (versions.length > 1) {
      // For monorepo sources the version values are full tags (e.g. <name>-1.1.0); the server sends a
      // versionLabels map (full tag → stripped {version}) so we display the short form while keeping the
      // full tag as the option value (the inserted ref).
      const labels = message.versionLabels || {};
      const select = document.createElement('select');
      select.className = 'version-dropdown';
      select.onchange = () => updateComponentVersion(componentName, select.value, projectId);
      select.oncontextmenu = event => showContextMenu(event, componentName, select.value, projectId);
      versions.forEach(v => {
        const option = document.createElement('option');
        option.value = v;
        option.textContent = labels[v] || v;
        if (v === defaultVersion) {
          option.selected = true;
        }
        select.appendChild(option);
      });
      actionsDiv.replaceChildren(select, ...actionButtons(componentName, defaultVersion));

      const descElement = document.getElementById(`desc-${componentName}-${projectId}`);
      if (descElement && !document.getElementById(`version-info-${componentName}-${projectId}`)) {
        const versionInfo = document.createElement('div');
        versionInfo.className = 'version-info';
        versionInfo.id = `version-info-${componentName}-${projectId}`;
        versionInfo.replaceChildren(smallText(`Default version: ${defaultVersion}`));
        descElement.parentNode?.insertBefore(versionInfo, descElement.nextSibling);
      }
    } else {
      const singleVersion = versions[0] || 'latest';
      const label = document.createElement('span');
      label.className = 'single-version';
      label.textContent = singleVersion;
      actionsDiv.replaceChildren(label, ...actionButtons(componentName, singleVersion));
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
  loadingElement?.classList.add('is-hidden');

  const actionsDiv = document.getElementById(`actions-${componentKey}`);
  if (actionsDiv) {
    const failure = document.createElement('span');
    failure.className = 'error-message';
    failure.textContent = 'Failed to load versions';

    const retry = document.createElement('button');
    retry.className = 'load-versions-btn';
    retry.textContent = 'Retry';
    retry.onclick = () => loadComponentVersions(
      message.componentName, message.sourcePath, message.gitlabInstance || 'gitlab.com', ''
    );

    actionsDiv.replaceChildren(failure, retry);
  }
}

/** Repoint a component's card, description and action buttons at the newly selected version. */
function updateComponentVersion(componentName: string, selectedVersion: string, projectId: string): void {
  const versionData = findVersion(componentName, selectedVersion);
  if (!versionData) {
    console.warn('Version data not found for', componentName, selectedVersion);

    // Try to fetch this version dynamically
    const componentCard = document.querySelector(
      `[data-component-name="${CSS.escape(componentName)}"][data-project-id="${CSS.escape(projectId)}"]`
    );
    if (componentCard) {
      const sourcePath = componentCard.getAttribute('data-source-path');
      const gitlabInstance = componentCard.getAttribute('data-gitlab-instance');

      if (sourcePath && gitlabInstance) {
        // Show loading state
        const versionInfoElement = document.getElementById(`version-info-${componentName}-${projectId}`);
        if (versionInfoElement) {
          versionInfoElement.replaceChildren(smallText(`Loading version ${selectedVersion}...`));
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


  const descElement = document.getElementById(`desc-${componentName}-${projectId}`);
  if (descElement) {
    descElement.innerHTML = renderInlineMarkdown(versionData.description || '');
  }

  const versionInfoElement = document.getElementById(`version-info-${componentName}-${projectId}`);
  if (versionInfoElement) {
    versionInfoElement.replaceChildren(smallText(`Selected version: ${selectedVersion}`));
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
  const versionData = findVersion(componentName, version);
  if (versionData) {
    // Send the raw component data; the server computes the template-file URL when it renders the details panel.
    const component = { ...versionData, name: componentName, version };
    vscode.postMessage({ command: 'viewComponentDetails', component });
  }
}

/** Insert a component at a given version into the active editor. */
function insertComponentById(componentName: string, version: string): void {
  const versionData = findVersion(componentName, version);
  if (versionData) {
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
        content.classList.remove('is-hidden');
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

/**
 * Open the version dropdown's context menu for a component.
 *
 * @param event The right-click on the dropdown. Its component card supplies the project path and instance.
 * @param componentName The component the dropdown belongs to.
 * @param version The version selected in the dropdown.
 * @param projectId The DOM id of the component's project group.
 */
function showContextMenu(event: MouseEvent, componentName: string, version: string, projectId: string): void {
  event.preventDefault();
  event.stopPropagation();

  const contextMenu = document.getElementById('contextMenu');
  const card = event.target instanceof Element ? event.target.closest('.component-card') : null;
  const sourcePath = card?.getAttribute('data-source-path');
  const gitlabInstance = card?.getAttribute('data-gitlab-instance');
  if (!contextMenu || !sourcePath || !gitlabInstance) {
    return;
  }

  contextMenuData = { componentName, version, projectId, sourcePath, gitlabInstance };
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
      sourcePath: contextMenuData.sourcePath,
      gitlabInstance: contextMenuData.gitlabInstance,
    });
  }
  hideContextMenu();
}

function alwaysUseLatest(): void {
  if (contextMenuData) {
    vscode.postMessage({
      command: 'setAlwaysUseLatest',
      componentName: contextMenuData.componentName,
      sourcePath: contextMenuData.sourcePath,
      gitlabInstance: contextMenuData.gitlabInstance,
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

  storeVersion(message.componentName, message.version, message.component);

  const projectId = findProjectIdForComponent(message.componentName);
  if (projectId) {
    updateComponentVersion(message.componentName, message.version, projectId);
  }
});

/** Find which project a component card belongs to, for messages that carry only a component name. */
function findProjectIdForComponent(componentName: string): string | null {
  const componentCard = document.querySelector(`[data-component-name="${CSS.escape(componentName)}"]`);
  return componentCard ? componentCard.getAttribute('data-project-id') : null;
}

/** The component card a control sits in, and the coordinates the card carries. */
interface CardContext {
  componentName: string;
  projectId: string;
  sourcePath: string;
  gitlabInstance: string;
  /** The version the card's actions apply to: what the dropdown shows, or the card's default without one. */
  version: string;
}

/**
 * Read the coordinates of the card a control belongs to.
 *
 * The version comes from the dropdown when the user has one to choose from, and otherwise from the card's
 * `data-version` — which carries the component's default, not merely its first tag.
 *
 * @param control An element inside a `.component-card`.
 * @returns       The card's context, or null when the control is not in a card.
 */
function cardContext(control: HTMLElement): CardContext | null {
  const card = control.closest<HTMLElement>('.component-card');
  if (!card) {
    return null;
  }

  const select = card.querySelector('select.version-dropdown');
  const chosen = select instanceof HTMLSelectElement ? select.value : '';
  return {
    componentName: card.dataset.componentName ?? '',
    projectId: card.dataset.projectId ?? '',
    sourcePath: card.dataset.sourcePath ?? '',
    gitlabInstance: card.dataset.gitlabInstance ?? '',
    version: chosen || card.dataset.version || '',
  };
}

/** The event each action answers to. A `<select>` emits `click` as well, so binding one action to several fires it
 * more than once per interaction. */
type ActionEvent = 'click' | 'change' | 'input';

/** Actions a control requests by naming one in `data-action`, dispatched from the document. */
const ACTIONS: Record<string, { on: ActionEvent; run: (control: HTMLElement) => void }> = {
  filterComponents: { on: 'input', run: () => filterComponents() },
  refreshComponents: { on: 'click', run: () => refreshComponents() },
  updateCache: { on: 'click', run: () => updateCache() },
  resetCache: { on: 'click', run: () => resetCache() },
  updateToken: { on: 'click', run: () => updateToken() },
  setAsDefaultVersion: { on: 'click', run: () => setAsDefaultVersion() },
  alwaysUseLatest: { on: 'click', run: () => alwaysUseLatest() },
  toggleError: { on: 'click', run: control => toggleError(control.dataset.target ?? '') },
  toggleSource: { on: 'click', run: control => toggleSource(control.dataset.target ?? '') },
  toggleProject: { on: 'click', run: control => toggleProject(control.dataset.target ?? '') },
  loadVersions: {
    on: 'click',
    run: control => {
      const card = cardContext(control);
      if (card) {
        loadComponentVersions(card.componentName, card.sourcePath, card.gitlabInstance, card.projectId);
      }
    },
  },
  selectVersion: {
    on: 'change',
    run: control => {
      const card = cardContext(control);
      if (card) {
        updateComponentVersion(card.componentName, card.version, card.projectId);
      }
    },
  },
  viewDetails: {
    on: 'click',
    run: control => {
      const card = cardContext(control);
      if (card) {
        viewDetailsById(card.componentName, card.version);
      }
    },
  },
  insertComponent: {
    on: 'click',
    run: control => {
      const card = cardContext(control);
      if (card) {
        insertComponentById(card.componentName, card.version);
      }
    },
  },
};

/**
 * Run the action a control names, when the event matches the one it answers to.
 *
 * Delegated from the document so controls the script rebuilds at runtime need no rebinding, and so the document
 * carries no event-handler attributes for its CSP to block.
 */
function dispatch(event: Event): void {
  if (!(event.target instanceof HTMLElement)) {
    return;
  }

  const control = event.target.closest<HTMLElement>('[data-action]');
  const action = control?.dataset.action;
  if (!control || !action) {
    return;
  }

  const handler = ACTIONS[action];
  if (handler?.on === event.type) {
    handler.run(control);
  }
}

for (const eventName of ['click', 'change', 'input'] as const) {
  document.addEventListener(eventName, dispatch);
}

document.addEventListener('contextmenu', event => {
  if (!(event.target instanceof HTMLElement)) {
    return;
  }

  const control = event.target.closest<HTMLElement>('select.version-dropdown');
  const card = control && cardContext(control);
  if (card) {
    showContextMenu(event, card.componentName, card.version, card.projectId);
  }
});

export {};
