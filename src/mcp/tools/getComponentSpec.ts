/**
 * `get_component_spec`: the inputs a component version declares, so an agent can write a correct `inputs:` block.
 */

import { getLatestStableSemver } from '../../utils/semver';
import { ToolError, type Tool } from '../server';
import type { JsonSchema } from '../protocol/types';
import type { ComponentParameter } from '../../types/git-component';
import { parseComponentArgument, type ComponentRef } from './componentRef';
import { cleanDefault, cleanList, cleanName, cleanNames, cleanText } from './sanitize';

export interface SpecComponent {
  name: string;
  description: string;
  parameters: ComponentParameter[];
  version?: string;
  source?: string;
  documentationUrl?: string;
}

export interface ComponentServices {
  /** Fetch the component at `ref.url`. Resolves `null` when GitLab has no such component. */
  fetchComponent(ref: ComponentRef): Promise<SpecComponent | null>;
  /** Every tag and branch for the component's project, scoped to the component when its source has a tag pattern. */
  fetchVersions(ref: ComponentRef): Promise<string[]>;
}

const INPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    component: {
      type: 'string',
      description: 'Component reference, e.g. gitlab.com/components/opentofu/full-pipeline@2.0.0. Without @version, the default branch is used.',
    },
    version: { type: 'string', description: 'Version to read; overrides any @version in component.' },
  },
  required: ['component'],
  additionalProperties: false,
};

const OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    component: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    version: { type: 'string' },
    source: { type: 'string' },
    documentationUrl: { type: 'string' },
    inputs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string' },
          required: { type: 'boolean' },
          description: { type: 'string' },
          options: { type: 'array' },
        },
        required: ['name', 'type', 'required', 'description'],
      },
    },
    availableVersions: { type: 'array', items: { type: 'string' } },
    latestStable: { type: 'string' },
  },
  required: ['component', 'name', 'version', 'inputs'],
};

/** A documentation link for output, only when it is an https URL. */
export function describeComponentLink(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).protocol === 'https:' ? cleanText(url) : undefined;
  } catch {
    return undefined;
  }
}

export function describeInput(parameter: ComponentParameter): Record<string, unknown> {
  const options = cleanList(parameter.options);
  return {
    name: cleanName(parameter.name),
    type: cleanName(parameter.type || 'string'),
    required: parameter.required,
    ...(parameter.default !== undefined ? { default: cleanDefault(parameter.default) } : {}),
    ...(options ? { options } : {}),
    description: cleanText(parameter.description),
  };
}

export function createGetComponentSpecTool(services: ComponentServices): Tool {
  return {
    definition: {
      name: 'get_component_spec',
      title: 'Get component spec',
      description:
        'Read the inputs a GitLab CI/CD component version declares: names, types, whether each is required, defaults, and allowed options. ' +
        'Call this for the exact version a file pins before adding, renaming, or removing inputs. Also returns the available versions and the latest stable one.',
      inputSchema: INPUT_SCHEMA,
      outputSchema: OUTPUT_SCHEMA,
      annotations: { title: 'Get component spec', readOnlyHint: true, openWorldHint: true },
    },
    run: async (args) => {
      const ref = parseComponentArgument(String(args.component), args.version as string | undefined);
      const component = await services.fetchComponent(ref);
      if (!component) {
        throw new ToolError(`No component found at ${ref.url}. Check the project path, component name, and version.`);
      }
      const versions = await services.fetchVersions(ref);
      const latestStable = getLatestStableSemver(versions);
      return {
        summary: `${component.parameters.length} inputs for ${cleanName(component.name)}@${ref.version}.`,
        data: {
          component: ref.url,
          name: cleanName(component.name),
          description: cleanText(component.description),
          version: ref.version,
          source: cleanName(component.source ?? `${ref.gitlabInstance}/${ref.sourcePath}`),
          ...(describeComponentLink(component.documentationUrl) ? { documentationUrl: describeComponentLink(component.documentationUrl) } : {}),
          inputs: component.parameters.map(describeInput),
          ...(versions.length > 0 ? { availableVersions: cleanNames(versions) } : {}),
          ...(latestStable ? { latestStable } : {}),
        },
      };
    },
  };
}
