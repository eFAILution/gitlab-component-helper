/**
 * Generates the YAML snippet inserted into a `.gitlab-ci.yml` when the Component Browser confirms an "Add" or "Edit"
 * action. Pure string transform — no `vscode` types — so the same routine that runs inside the provider also runs
 * inside the unit suite.
 */

import { containsGitLabVariables } from '../utils/gitlabVariables';

/**
 * Minimal parameter shape this routine reads. Wider than {@link ComponentParameter} (`default` allows
 * arbitrary JSON-encodable objects, not just `ParameterDefault`) and looser on requiredness so tests
 * can build partial fixtures. Description is intentionally absent — the generator never reads it.
 */
interface GeneratableParameter {
  name: string;
  type?: string;
  required?: boolean;
  /** Accepts anything `JSON.stringify` can encode — primitive or composite. */
  default?: unknown;
}

/**
 * Minimal component shape this routine reads. The component browser feeds in two flavours
 * interchangeably (a cached catalog component, or one freshly detected from the editor) — this shape
 * captures only the fields the generator actually consumes.
 */
interface GeneratableComponent {
  name: string;
  version?: string;
  sourcePath?: string;
  gitlabInstance?: string;
  originalUrl?: string;
  parameters?: GeneratableParameter[];
}

/**
 * Pre-existing component slot parsed out of a `.gitlab-ci.yml` `include:` entry — `inputs` is the previous
 * mapping the user had set, which we round-trip rather than overwrite during an edit. The provider passes
 * the result of `parseExistingComponentText` (typed `unknown`) directly in; the function narrows below.
 */
type ExistingComponent = { inputs?: Record<string, unknown> };

/**
 * Build the `  - component: <url>\n    inputs:\n      key: value # required/optional` snippet for an add or edit.
 *
 * URL strategy:
 *  - If `component.originalUrl` contains GitLab variables (e.g. `${CI_SERVER_FQDN}`), use it verbatim and either
 *    append `@version` or replace the existing trailing `@…` with the new version. This preserves user-written
 *    variable expressions on round-trip.
 *  - Otherwise rebuild the URL from `gitlabInstance`, `sourcePath`, `name`, and `version`.
 *
 * Inputs strategy:
 *  - With no `selectedInputs` and `includeInputs === false`, emit no `inputs:` section.
 *  - With `selectedInputs`, the resulting `inputs:` block contains exactly those names. Values come from
 *    `existingComponent.inputs` when present, otherwise from each parameter's `default`, otherwise from a
 *    type-and-required-aware placeholder (`"TODO: set value"`, `true`, `0`, `false`, `""`).
 *  - With `includeInputs === true` and no selection, every parameter is emitted with the same value-resolution rules.
 *
 * @param component         The component being inserted. Expects `name`, `version`, `sourcePath`, `gitlabInstance`,
 *                          optional `originalUrl`, and optional `parameters[]`.
 * @param includeInputs     Emit every parameter when no selection is supplied.
 * @param selectedInputs    Names of inputs to keep when editing — only these will appear in the `inputs:` block.
 * @param existingComponent Previous inputs to preserve verbatim during an edit; defaults are only used for newly
 *                          selected inputs that weren't already set.
 * @returns                 YAML snippet ready to splice into a `.gitlab-ci.yml` `include:` list.
 */
export function generateComponentText(
  component: GeneratableComponent,
  includeInputs: boolean,
  selectedInputs: string[] = [],
  existingComponent: ExistingComponent | null = null,
): string {
  const gitlabInstance = component.gitlabInstance || 'gitlab.com';

  let componentUrl: string;
  if (component.originalUrl && containsGitLabVariables(component.originalUrl)) {
    componentUrl = component.originalUrl;
    if (component.version && !component.originalUrl.includes('@')) {
      componentUrl += `@${component.version}`;
    } else if (component.version && component.originalUrl.includes('@')) {
      componentUrl = component.originalUrl.replace(/@[^@]*$/, `@${component.version}`);
    }
  } else {
    componentUrl = `https://${gitlabInstance}/${component.sourcePath}/${component.name}@${component.version}`;
  }

  let insertion = `  - component: ${componentUrl}`;

  if (!(includeInputs || (selectedInputs && selectedInputs.length > 0))) {
    return insertion;
  }

  insertion += '\n    inputs:';

  const finalInputs = new Map<string, unknown>();

  if (existingComponent && existingComponent.inputs) {
    for (const [key, value] of Object.entries(existingComponent.inputs)) {
      finalInputs.set(key, value);
    }
  }

  if (selectedInputs && selectedInputs.length > 0) {
    // Drop any existing inputs that the user didn't keep selected.
    const filteredInputs = new Map<string, unknown>();
    for (const inputName of selectedInputs) {
      if (finalInputs.has(inputName)) {
        filteredInputs.set(inputName, finalInputs.get(inputName));
      }
    }
    finalInputs.clear();
    for (const [key, value] of filteredInputs) {
      finalInputs.set(key, value);
    }

    // Fill in newly selected inputs that didn't already have a value.
    if (component.parameters) {
      for (const param of component.parameters) {
        if (selectedInputs.includes(param.name) && !finalInputs.has(param.name)) {
          finalInputs.set(param.name, formatDefaultForInsertion(param));
        }
      }
    }
  } else if (includeInputs && component.parameters) {
    for (const param of component.parameters) {
      if (!finalInputs.has(param.name)) {
        finalInputs.set(param.name, formatDefaultForInsertion(param));
      }
    }
  }

  for (const [inputName, inputValue] of finalInputs) {
    const param = component.parameters?.find(p => p.name === inputName);
    const comment = param?.required ? ' # required' : ' # optional';
    insertion += `\n      ${inputName}: ${inputValue}${comment}`;
  }

  return insertion;
}

/**
 * Resolve the value to emit for a parameter that doesn't have an existing override. Either formats the parameter's
 * declared `default` for YAML insertion (quoting strings, stringifying booleans/numbers, JSON-encoding objects) or
 * falls back to a type-and-required-aware placeholder when no default is declared.
 */
function formatDefaultForInsertion(param: GeneratableParameter): string {
  const declared = param.default;
  if (declared !== undefined) {
    if (typeof declared === 'string') {
      // String defaults are quoted regardless of whether they contain GitLab variables — both arms of the original
      // `if (containsGitLabVariables(declared))` branch produced the same `"…"` output.
      return `"${declared}"`;
    }
    if (typeof declared === 'boolean') {
      return declared.toString();
    }
    if (typeof declared === 'number') {
      return declared.toString();
    }
    return JSON.stringify(declared);
  }

  if (param.required) {
    switch (param.type) {
      case 'boolean':
        return 'true';
      case 'number':
        return '0';
      default:
        return '"TODO: set value"';
    }
  }
  switch (param.type) {
    case 'boolean':
      return 'false';
    case 'number':
      return '0';
    default:
      return '""';
  }
}
