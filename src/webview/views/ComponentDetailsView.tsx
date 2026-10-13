import type { ComponentParameter } from '../../types/git-component';
import { compileTagTemplate } from '../../services/component/tagScoping';
import { InlineMarkdown, JsonScript, Page, PageAssets } from './Page';

export interface ComponentDetailsViewProps extends PageAssets {
  name: string;
  description: string;
  summary?: string;
  usage?: string;
  notes: string[];
  rawYaml: string;
  source?: string;
  gitlabInstance?: string;
  version?: string;
  availableVersions: string[];
  tagPattern?: string;
  url?: string;
  parameters: ComponentParameter[];
  /**
   * Already validated as `http(s)`. Shown as text only: the anchors carry no URL, and clicking one has the extension
   * host open it, so a publisher-supplied URL never reaches an `href`.
   */
  safeDocUrl?: string;
  safeTemplateUrl?: string;
}

/**
 * The details panel for one component, opened from the Component Browser or a hover. Sections with no data render
 * hidden rather than absent, because the client script fills them in when the user switches version.
 *
 * @param props The component's fields, its validated URLs, and the page assets.
 * @returns     The page element, for `renderDocument`.
 */
export function ComponentDetailsView({
  name, description, summary, usage, notes, rawYaml, source, gitlabInstance, version, availableVersions, tagPattern,
  url, parameters, safeDocUrl, safeTemplateUrl, ...assets
}: ComponentDetailsViewProps) {
  const hasContext = Boolean(summary || usage || notes.length > 0);

  return (
    <Page title={`Component: ${name}`} {...assets}>
      <h1 id="componentName">{name}</h1>

      <InlineMarkdown class="description" id="componentDescription" text={description} />

      <div id="componentContext" class={`metadata ${hasContext ? '' : 'is-hidden'}`}>
        <div><strong>Context</strong></div>
        <div id="componentSummaryRow" class={summary ? '' : 'is-hidden'}>
          <strong>Summary:</strong> <span id="componentSummary">{summary || ''}</span>
        </div>
        <div id="componentUsageRow" class={usage ? '' : 'is-hidden'}>
          <strong>Usage:</strong> <span id="componentUsage">{usage || ''}</span>
        </div>
        <div id="componentNotesRow" class={notes.length > 0 ? '' : 'is-hidden'}>
          <strong>Notes:</strong>
          <ul id="componentNotes">
            {notes.map(note => <li>{note}</li>)}
          </ul>
        </div>
      </div>

      <div id="rawYamlSection" class={`metadata ${rawYaml ? '' : 'is-hidden'}`}>
        <div class="parameters-header raw-yaml-header">
          <h2>Raw YAML</h2>
          <button class="secondary" id="toggle-raw-yaml" data-action="toggleRawYaml">Show</button>
        </div>
        <pre id="raw-yaml-content" class="is-hidden">{rawYaml}</pre>
      </div>

      <div class="metadata">
        <div><strong>Source:</strong> <span id="componentSource">{source || ''}</span></div>
        <div>
          <strong>GitLab Instance:</strong> <span id="componentInstance">{gitlabInstance || 'gitlab.com'}</span>
        </div>
        <div class="version-control">
          <strong>Version:</strong>
          <select id="versionSelect" data-action="onVersionChange">
            <VersionOptions versions={availableVersions} selected={version} name={name} tagPattern={tagPattern} />
          </select>
          <span class="version-loading is-hidden" id="versionLoading">Loading version details...</span>
        </div>
        {safeDocUrl && (
          <div>
            <strong>Project URL:</strong>{' '}
            <a href="#" data-action="openDocumentation" id="componentDocUrl">{safeDocUrl}</a>
          </div>
        )}
        {url && (
          <div><strong>Component URL:</strong> <code id="componentUrl">{url}</code></div>
        )}
        {safeTemplateUrl && (
          <div>
            <strong>Template File:</strong>{' '}
            <a href="#" data-action="openTemplateFile" id="templateFileUrl">{safeTemplateUrl}</a>
          </div>
        )}
      </div>

      <div class="parameters-header">
        <h2>Parameters</h2>
        {parameters.length > 0 && (
          <div class="select-all-group">
            <input type="checkbox" id="selectAllInputs" data-action="toggleAllInputs" />
            <label for="selectAllInputs">Select All</label>
          </div>
        )}
      </div>
      <div id="parametersContainer">
        {parameters.length === 0 ? (
          <p>No parameters documented for this component.</p>
        ) : (
          <div class="parameters">
            {parameters.map(param => <Parameter param={param} />)}
          </div>
        )}
      </div>

      <div class="insert-options">
        <h3>Insert Options</h3>
        <div class="checkbox-group">
          <label>
            <input type="checkbox" id="includeInputs" />
            Include input parameters with default values
          </label>
        </div>
        <div class="button-group">
          <button data-action="insertComponent">Insert Component</button>{' '}
          <button class="secondary" data-action="refreshVersions">Refresh Versions</button>
        </div>
      </div>

      <JsonScript id="details-bootstrap" nonce={assets.nonce} data={{ loaded: availableVersions.length > 1 }} />
    </Page>
  );
}

interface VersionOptionsProps {
  versions: string[];
  selected?: string;
  name: string;
  tagPattern?: string;
}

/**
 * The version dropdown's options. For monorepo tags the label is the template's `{version}` capture; the value stays
 * the full tag.
 *
 * @param props.versions   Every available version.
 * @param props.selected   The version to pre-select.
 * @param props.name       The component name, which the tag template may reference.
 * @param props.tagPattern The source's tag template, present only for a monorepo.
 * @returns                A fragment of `<option>` elements.
 */
function VersionOptions({ versions, selected, name, tagPattern }: VersionOptionsProps) {
  const matcher = tagPattern ? compileTagTemplate(tagPattern, name) : null;
  return (
    <>
      {versions.map(version => (
        <option value={version} selected={version === selected}>{matcher?.extractVersion(version) ?? version}</option>
      ))}
    </>
  );
}

/**
 * One input parameter with its "Insert" checkbox. The client script rebuilds these rows with `createElement` on a
 * version switch, so the two must produce the same structure.
 *
 * @param props.param The parameter to render.
 * @returns           The `.parameter` element.
 */
function Parameter({ param }: { param: ComponentParameter }) {
  return (
    <div class="parameter">
      <div class="parameter-content">
        <div>
          <span class="parameter-name">{param.name}</span>{' '}
          <span class={param.required ? 'parameter-required' : 'parameter-optional'}>
            ({param.required ? 'required' : 'optional'})
          </span>
        </div>
        <div>{param.description || `Parameter: ${param.name}`}</div>
        <div><strong>Type:</strong> {param.type || 'string'}</div>
        {param.default !== undefined && (
          <div><strong>Default:</strong> <span class="parameter-default">{String(param.default)}</span></div>
        )}
      </div>
      <div class="parameter-checkbox">
        <input
          type="checkbox"
          id={`input-${param.name}`}
          class="input-checkbox"
          data-action="updateInputSelection"
          data-param-name={param.name}
        />
        <label for={`input-${param.name}`}>Insert</label>
      </div>
    </div>
  );
}
