/**
 * The component services the MCP tools use, over the same fetcher and version cache as the extension.
 */

import { getComponentService } from '../services/component/componentService';
import { getComponentCacheManager } from '../services/cache/componentCacheManager';
import { reconcileComponentSource } from '../services/cache/sourceReconciliation';
import { CONFIG_DEFAULTS } from '../core/config/defaults';
import { getRuntime } from '../core/runtime';
import { extractStatusCode, isAuthError } from '../errors';
import { ToolError } from './server';
import type { ComponentRef } from './tools/componentRef';
import type { ComponentServices, SpecComponent } from './tools/getComponentSpec';
import type { ComponentSource } from '../types/api';

// The fetcher answers a failed non-auth fetch with a placeholder component whose description embeds the raw error.
const FETCH_FAILURE_MARKER = 'Could not fetch detailed information';

/** Whether a fetched component is the fetcher's failure placeholder rather than a real spec. */
export function isFetchFailurePlaceholder(component: SpecComponent): boolean {
  return component.parameters.length === 0 && component.description.includes(FETCH_FAILURE_MARKER);
}

/**
 * A tool error for a failed GitLab request. Response bodies are never included: they are untrusted text.
 */
export function gitlabFailure(error: unknown, ref: Pick<ComponentRef, 'gitlabInstance' | 'url'>): ToolError {
  if (error instanceof ToolError) return error;
  if (isAuthError(error)) {
    return new ToolError(
      `GitLab at ${ref.gitlabInstance} refused the request for ${ref.url} (missing, invalid, or expired token). ` +
        'Add a token for this instance with the "GitLab CI: Add Component Project/Group" command in VS Code, or set GCH_TOKEN_<HOST>.'
    );
  }
  const status = extractStatusCode(error);
  return new ToolError(`Fetching ${ref.url} failed${status ? ` (HTTP ${status})` : ''}.`);
}

export function createComponentServices(): ComponentServices {
  return {
    fetchComponent: async (ref) => {
      let component: SpecComponent | null;
      try {
        component = await getComponentService().getComponentFromUrl(ref.url);
      } catch (error) {
        throw gitlabFailure(error, ref);
      }
      if (component && isFetchFailurePlaceholder(component)) {
        throw new ToolError(`Fetching ${ref.url} failed. Check the project path, component name, and version.`);
      }
      return component;
    },
    fetchVersions: async (ref) => {
      const sources = getRuntime().config.get<ComponentSource[]>('componentSources', CONFIG_DEFAULTS.componentSources);
      const lookup = reconcileComponentSource(
        {
          name: ref.name,
          description: '',
          parameters: [],
          source: `${ref.gitlabInstance}/${ref.sourcePath}`,
          sourcePath: ref.sourcePath,
          gitlabInstance: ref.gitlabInstance,
          version: ref.version,
          url: ref.baseUrl,
        },
        sources
      );
      return getComponentCacheManager({ eagerRefresh: false }).fetchComponentVersions(lookup);
    },
  };
}
