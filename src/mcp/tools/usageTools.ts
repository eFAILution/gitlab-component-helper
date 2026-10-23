/**
 * `list_component_usages` and `list_component_versions`.
 */

import { findDocumentWith, parseYamlDocuments, countYamlAliases, MAX_YAML_ALIASES } from '../../utils/yamlParser';
import { includeKeyAndUrl, isIncludeEntry, isLocalInclude, type IncludeEntry } from '../../utils/includeMatcher';
import { findLineForComponent } from '../../core/validation/includeLines';
import { createReferenceResolver } from '../../core/referenceResolver';
import { getLatestStableSemver } from '../../utils/semver';
import { ToolError, type Tool } from '../server';
import { collectCiFiles, MAX_CI_FILES } from './ciFiles';
import { parseComponentArgument } from './componentRef';
import type { ToolContext } from './context';
import { cleanName, cleanNames, cleanPath } from './sanitize';

const MAX_USAGES = 2000;

function parseIncludes(text: string): IncludeEntry[] {
  if (countYamlAliases(text) > MAX_YAML_ALIASES) return [];
  const document = findDocumentWith(parseYamlDocuments(text, true), 'include');
  if (!document) return [];
  const raw: unknown[] = Array.isArray(document.include) ? document.include : [document.include];
  return raw.filter(isIncludeEntry);
}

async function usagesOf(context: ToolContext, file: string): Promise<Array<Record<string, unknown>> | null> {
  const text = await context.workspace.readText(file);
  if (text === null) return null;
  const includes = parseIncludes(text);
  const resolve = createReferenceResolver(file, context.repoContext);
  return Promise.all(includes.map(async (include, index) => {
    const line = findLineForComponent(text, includes, index);
    const inputs = cleanNames(Object.keys(include.inputs ?? {}));
    if (isLocalInclude(include)) {
      return { kind: 'local', reference: cleanName(include.local), line, inputs };
    }
    const reference = includeKeyAndUrl(include).url;
    const resolved = await resolve(reference);
    const at = reference.lastIndexOf('@');
    return {
      kind: 'component',
      reference: cleanName(reference),
      ...(at === -1 ? {} : { version: cleanName(reference.slice(at + 1)) }),
      ...(resolved.resolved ? { url: cleanName(resolved.url) } : { unresolved: resolved.reason.kind }),
      line,
      inputs,
    };
  }));
}

export function createListComponentUsagesTool(context: ToolContext): Tool {
  return {
    definition: {
      name: 'list_component_usages',
      title: 'List component usages',
      description:
        'List every component and local include in GitLab CI files, with the line, the pinned version, and the input names passed. ' +
        'Use it to get an overview of which components a repository uses before validating or upgrading them.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: `A CI file or directory under the workspace roots. Omit to list every CI file (up to ${MAX_CI_FILES}).` },
        },
        additionalProperties: false,
      },
      annotations: { title: 'List component usages', readOnlyHint: true, openWorldHint: false },
    },
    run: async (args) => {
      const { files, truncated } = await collectCiFiles(context.workspace, args.path as string | undefined);
      const results: Array<Record<string, unknown>> = [];
      let total = 0;
      for (const file of files) {
        const usages = await usagesOf(context, file);
        if (!usages || usages.length === 0) continue;
        const kept = usages.slice(0, Math.max(0, MAX_USAGES - total));
        total += kept.length;
        if (kept.length > 0) results.push({ file: cleanPath(file), usages: kept });
      }
      return {
        summary: `${total} include(s) in ${results.length} file(s).`,
        data: { files: results, ...(truncated ? { filesTruncatedAt: MAX_CI_FILES } : {}), ...(total >= MAX_USAGES ? { usagesTruncatedAt: MAX_USAGES } : {}) },
      };
    },
  };
}

export function createListComponentVersionsTool(context: ToolContext): Tool {
  return {
    definition: {
      name: 'list_component_versions',
      title: 'List component versions',
      description: 'List the tags and branches available for a component, and its latest stable semantic version.',
      inputSchema: {
        type: 'object',
        properties: { component: { type: 'string', description: 'Component reference, e.g. gitlab.com/components/opentofu/full-pipeline' } },
        required: ['component'],
        additionalProperties: false,
      },
      annotations: { title: 'List component versions', readOnlyHint: true, openWorldHint: true },
    },
    run: async (args) => {
      const ref = parseComponentArgument(String(args.component));
      const versions = await context.services.fetchVersions(ref);
      if (versions.length === 0) throw new ToolError(`No versions found for ${ref.baseUrl}.`);
      const latestStable = getLatestStableSemver(versions);
      return {
        summary: `${versions.length} version(s)${latestStable ? `; latest stable ${latestStable}` : ''}.`,
        data: { component: ref.baseUrl, versions: cleanNames(versions), ...(latestStable ? { latestStable } : {}) },
      };
    },
  };
}
