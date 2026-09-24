/**
 * Client script for the component details panel.
 *
 * Runs in the webview, not the extension host. Handlers are delegated from the document rather than bound with
 * `onclick`/`onchange` attributes, which the document's nonce-based CSP blocks, and visibility is carried by the
 * `is-hidden` class rather than `style.display` for the same reason.
 */

import { renderInlineMarkdown } from '../inlineMarkdown';

/**
 * State the document embeds for the panel's initial render.
 *
 * `loaded` says whether the server-rendered dropdown already holds the component's full version list; when it does
 * not, the script fetches them rather than leaving the panel showing a single version.
 */
interface DetailsBootstrap {
  loaded: boolean;
}

/** A component parameter as it arrives in a `componentDetailsUpdated` payload. */
interface ComponentParameter {
  name: string;
  description?: string;
  required?: boolean;
  type?: string;
  default?: unknown;
}

/** The component payload sent when the selected version changes. */
interface ComponentDetails {
  name: string;
  description?: string;
  summary?: string;
  usage?: string;
  notes?: string[];
  rawYaml?: string;
  source?: string;
  gitlabInstance?: string;
  documentationUrl?: string;
  url?: string;
  templateFileUrl?: string;
  parameters?: ComponentParameter[];
}

const vscode = acquireVsCodeApi();

/** How long to wait before auto-fetching versions, letting the initial render settle first. */
const AUTO_FETCH_DELAY_MS = 500;

let versionsLoaded = readBootstrap().loaded;

/**
 * Read the state the document embedded as JSON.
 *
 * @returns The embedded state, or an unloaded default when the block is missing or malformed — which leaves the
 *          auto-fetch to populate the dropdown rather than trusting a partial list.
 */
function readBootstrap(): DetailsBootstrap {
  const unloaded: DetailsBootstrap = { loaded: false };
  const element = document.getElementById('details-bootstrap');
  if (!element?.textContent) {
    return unloaded;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(element.textContent);
  } catch {
    return unloaded;
  }

  return isBootstrap(parsed) ? parsed : unloaded;
}

/** Narrow a parsed value to the bootstrap shape. */
function isBootstrap(value: unknown): value is DetailsBootstrap {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate: Partial<Record<keyof DetailsBootstrap, unknown>> = value;
  return typeof candidate.loaded === 'boolean';
}

/**
 * Look up an element by id, narrowing it to the expected subtype.
 *
 * @param id        Element id.
 * @param construct The DOM constructor the element must be an instance of.
 * @returns         The element, or null when it is absent or of another type.
 */
function elementById<T extends HTMLElement>(id: string, construct: new () => T): T | null {
  const element = document.getElementById(id);
  return element instanceof construct ? element : null;
}

/**
 * Show or hide an element.
 *
 * @param element Target, or null when the document does not carry it.
 * @param visible Whether it should be shown.
 */
function setVisible(element: HTMLElement | null, visible: boolean): void {
  element?.classList.toggle('is-hidden', !visible);
}

/**
 * Set an element's text, ignoring the call when the document does not carry it.
 *
 * @param id    Element id.
 * @param value Replacement text.
 */
function setText(id: string, value: string): void {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

/**
 * Report progress or failure in the slot beside the version dropdown.
 *
 * @param message Text to show.
 * @param isError Whether to style it as a failure rather than progress.
 */
function setVersionStatus(message: string, isError: boolean): void {
  const status = document.getElementById('versionLoading');
  if (!status) {
    return;
  }

  status.textContent = message;
  status.classList.toggle('version-error', isError);
  setVisible(status, true);
}

/** Ask the extension to write the component into the active file, at the selected version and inputs. */
function insertComponent(): void {
  const select = elementById('versionSelect', HTMLSelectElement);
  const includeInputs = elementById('includeInputs', HTMLInputElement);

  const selectedInputs = [...document.querySelectorAll<HTMLElement>('.input-checkbox:checked')]
    .map(checkbox => checkbox.dataset.paramName)
    .filter((name): name is string => Boolean(name));

  vscode.postMessage({
    command: 'insertComponent',
    version: select?.value,
    includeInputs: includeInputs?.checked ?? false,
    selectedInputs,
  });
}

/** Match every input checkbox to the "select all" box, then reconcile the derived state. */
function toggleAllInputs(): void {
  const selectAll = elementById('selectAllInputs', HTMLInputElement);
  if (!selectAll) {
    return;
  }

  for (const checkbox of document.querySelectorAll<HTMLInputElement>('.input-checkbox')) {
    checkbox.checked = selectAll.checked;
  }
  updateInputSelection();
}

/** Reconcile the "select all" tri-state with the individual boxes, and opt into inputs once any is chosen. */
function updateInputSelection(): void {
  const all = document.querySelectorAll<HTMLInputElement>('.input-checkbox');
  const checked = document.querySelectorAll<HTMLInputElement>('.input-checkbox:checked');
  const selectAll = elementById('selectAllInputs', HTMLInputElement);
  const includeInputs = elementById('includeInputs', HTMLInputElement);

  if (selectAll) {
    selectAll.checked = checked.length > 0 && checked.length === all.length;
    selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
  }

  if (checked.length > 0 && includeInputs) {
    includeInputs.checked = true;
  }
}

/** Ask the extension for the selected version's details, which arrive as `componentDetailsUpdated`. */
function onVersionChange(): void {
  const select = elementById('versionSelect', HTMLSelectElement);
  setVersionStatus('Loading version details...', false);
  vscode.postMessage({ command: 'versionChanged', selectedVersion: select?.value });
}

/** Re-fetch the component's version list, disabling the dropdown until the reply arrives. */
function refreshVersions(): void {
  const select = elementById('versionSelect', HTMLSelectElement);
  setVersionStatus('Loading version details...', false);
  if (select) {
    select.disabled = true;
  }
  vscode.postMessage({ command: 'fetchVersions' });
}

/** Show or hide the component's raw YAML, flipping the trigger's label between Show and Hide. */
function toggleRawYaml(): void {
  const content = document.getElementById('raw-yaml-content');
  const toggle = document.getElementById('toggle-raw-yaml');
  if (!content || !toggle) {
    return;
  }

  const nowVisible = content.classList.toggle('is-hidden') === false;
  toggle.textContent = nowVisible ? 'Hide' : 'Show';
}

/**
 * Build the parameter list for a component.
 *
 * Constructed with `createElement` rather than an HTML string: `name` and `description` come from a component's
 * catalog entry and are not this extension's to trust.
 *
 * @param parameters The component's inputs; an empty list renders a placeholder instead.
 */
function renderParameters(parameters: ComponentParameter[]): void {
  const container = document.getElementById('parametersContainer');
  if (!container) {
    return;
  }

  container.replaceChildren();

  if (parameters.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = 'No parameters documented for this component.';
    container.append(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'parameters';

  for (const param of parameters) {
    const row = document.createElement('div');
    row.className = 'parameter';

    const content = document.createElement('div');
    content.className = 'parameter-content';

    const heading = document.createElement('div');
    const name = document.createElement('span');
    name.className = 'parameter-name';
    name.textContent = param.name;
    const requirement = document.createElement('span');
    requirement.className = param.required ? 'parameter-required' : 'parameter-optional';
    requirement.textContent = param.required ? '(required)' : '(optional)';
    heading.append(name, requirement);

    const description = document.createElement('div');
    description.textContent = param.description || `Parameter: ${param.name}`;

    const type = document.createElement('div');
    const typeLabel = document.createElement('strong');
    typeLabel.textContent = 'Type:';
    type.append(typeLabel, ` ${param.type || 'string'}`);

    content.append(heading, description, type);

    if (param.default !== undefined) {
      const defaultRow = document.createElement('div');
      const defaultLabel = document.createElement('strong');
      defaultLabel.textContent = 'Default:';
      const defaultValue = document.createElement('span');
      defaultValue.className = 'parameter-default';
      defaultValue.textContent = String(param.default);
      defaultRow.append(defaultLabel, ' ', defaultValue);
      content.append(defaultRow);
    }

    const checkboxCell = document.createElement('div');
    checkboxCell.className = 'parameter-checkbox';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `input-${param.name}`;
    checkbox.className = 'input-checkbox';
    checkbox.dataset.paramName = param.name;
    const label = document.createElement('label');
    label.htmlFor = checkbox.id;
    label.textContent = 'Insert';
    checkboxCell.append(checkbox, label);

    row.append(content, checkboxCell);
    list.append(row);
  }

  container.append(list);
}

/**
 * Repaint the whole panel for a newly selected version.
 *
 * @param component The version's details, as sent in a `componentDetailsUpdated` message. Rows whose field is
 *                  absent are hidden rather than left showing the previous version's value.
 */
function updateComponentDetails(component: ComponentDetails): void {
  setText('componentName', component.name);

  const descriptionEl = document.getElementById('componentDescription');
  if (descriptionEl) {
    descriptionEl.innerHTML = renderInlineMarkdown(component.description || '');
  }

  const summary = component.summary || '';
  const usage = component.usage || '';
  const notes = Array.isArray(component.notes) ? component.notes : [];

  setVisible(document.getElementById('componentContext'), Boolean(summary || usage || notes.length > 0));

  setVisible(document.getElementById('componentSummaryRow'), Boolean(summary));
  setText('componentSummary', summary);

  setVisible(document.getElementById('componentUsageRow'), Boolean(usage));
  setText('componentUsage', usage);

  setVisible(document.getElementById('componentNotesRow'), notes.length > 0);
  const notesEl = document.getElementById('componentNotes');
  if (notesEl) {
    notesEl.replaceChildren(...notes.map(note => {
      const item = document.createElement('li');
      item.textContent = note;
      return item;
    }));
  }

  const rawYaml = component.rawYaml || '';
  setVisible(document.getElementById('rawYamlSection'), rawYaml.length > 0);
  const rawContent = document.getElementById('raw-yaml-content');
  if (rawContent) {
    rawContent.textContent = rawYaml;
    setVisible(rawContent, false);
  }
  setText('toggle-raw-yaml', 'Show');

  if (component.source) {
    setText('componentSource', component.source);
  }
  if (component.gitlabInstance) {
    setText('componentInstance', component.gitlabInstance);
  }

  const docUrl = elementById('componentDocUrl', HTMLAnchorElement);
  if (docUrl && component.documentationUrl) {
    docUrl.href = component.documentationUrl;
    docUrl.textContent = component.documentationUrl;
  }

  if (component.url) {
    setText('componentUrl', component.url);
  }

  // The server precomputes templateFileUrl; its absence means no resolved templatePath, so the row is hidden.
  const templateFileUrl = elementById('templateFileUrl', HTMLAnchorElement);
  if (templateFileUrl) {
    if (component.templateFileUrl) {
      templateFileUrl.href = component.templateFileUrl;
      templateFileUrl.textContent = component.templateFileUrl;
    }
    setVisible(templateFileUrl, Boolean(component.templateFileUrl));
  }

  const parameters = component.parameters || [];
  renderParameters(parameters);

  setVisible(document.querySelector<HTMLElement>('.select-all-group'), parameters.length > 0);
  const selectAll = elementById('selectAllInputs', HTMLInputElement);
  if (selectAll) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
  }

  const includeInputs = document.getElementById('includeInputs');
  setVisible(includeInputs?.parentElement?.parentElement ?? null, parameters.length > 0);

  setVisible(document.getElementById('versionLoading'), false);
}

/**
 * Repopulate the version dropdown, keeping the full tag as each option's value.
 *
 * @param versions       Every version available for the component, in display order.
 * @param currentVersion The one to select.
 * @param versionLabels  Optional `tag → label` map for monorepo sources, whose tags embed the component name; a tag
 *                       with no entry shows as itself.
 */
function updateVersionDropdown(
  versions: string[],
  currentVersion: string,
  versionLabels?: Record<string, string>
): void {
  const select = elementById('versionSelect', HTMLSelectElement);
  if (!select) {
    return;
  }

  const labels = versionLabels || {};
  select.replaceChildren(...versions.map(version => {
    const option = document.createElement('option');
    option.value = version;
    // Monorepo sources send a stripped `{version}` label; other sources show the tag itself.
    option.textContent = labels[version] || version;
    option.selected = version === currentVersion;
    return option;
  }));

  const loading = document.getElementById('versionLoading');
  setVisible(loading, false);
  loading?.classList.remove('version-error');
  select.disabled = false;
  versionsLoaded = true;
}

/** Actions a control can request by naming one in `data-action`. */
const ACTIONS: Record<string, () => void> = {
  insertComponent,
  refreshVersions,
  toggleRawYaml,
  toggleAllInputs,
  updateInputSelection,
  onVersionChange,
};

for (const eventName of ['click', 'change'] as const) {
  document.addEventListener(eventName, event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    // Delegated so controls rebuilt by `renderParameters` need no rebinding.
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action) {
      ACTIONS[action]?.();
    }
  });
}

window.addEventListener('message', event => {
  const message = event.data;

  switch (message.command) {
    case 'versionsLoaded':
      updateVersionDropdown(message.versions, message.currentVersion, message.versionLabels);
      break;
    case 'versionsError': {
      setVersionStatus(`Could not load versions: ${message.error || 'unknown error'}`, true);
      const select = elementById('versionSelect', HTMLSelectElement);
      if (select) {
        select.disabled = false;
      }
      break;
    }
    case 'componentDetailsUpdated':
      updateComponentDetails(message.component);
      break;
    case 'versionChangeError':
      setVersionStatus(`Could not load that version: ${message.error || 'unknown error'}`, true);
      break;
  }
});

if (!versionsLoaded) {
  setTimeout(refreshVersions, AUTO_FETCH_DELAY_MS);
}

export {};
