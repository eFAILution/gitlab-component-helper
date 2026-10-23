/**
 * The component services the MCP tools use, over the same fetcher and version cache as the extension.
 */

import { getComponentService } from '../services/component/componentService';
import { getComponentCacheManager } from '../services/cache/componentCacheManager';
import { reconcileComponentSource } from '../services/cache/sourceReconciliation';
import { CONFIG_DEFAULTS } from '../core/config/defaults';
import { getRuntime } from '../core/runtime';
import { classifyFetchFailure, extractStatusCode, fetchFailureHint, isAuthError, type FetchFailure } from '../errors';
import { ToolError } from './server';
import { hostNotAllowedMessage } from './adapters/network';
import type { ComponentRef } from './tools/componentRef';
import type { ComponentServices, SpecComponent } from './tools/getComponentSpec';
import type { ComponentSource } from '../types/api';

// The fetcher answers a failed non-auth fetch with a placeholder component whose description embeds the raw error.
const FETCH_FAILURE_MARKER = 'Could not fetch detailed information';

/** Whether a fetched component is the fetcher's failure placeholder rather than a real spec. */
export function isFetchFailurePlaceholder(component: SpecComponent): boolean {
  return component.parameters.length === 0 && component.description.includes(FETCH_FAILURE_MARKER);
}

const UNAUTHORIZED = 401;

/** GitLab refused the token (or there was none). Carries the 401 so `isAuthError` recognizes it. */
export class GitLabAuthToolError extends ToolError {
  readonly statusCode = UNAUTHORIZED;
}

/** A non-auth fetch failure, with why it failed so callers can report the cause. */
export class FetchFailureToolError extends ToolError {
  constructor(message: string, readonly failure: FetchFailure) {
    super(message);
  }
}

function fetchFailureError(failure: FetchFailure, ref: Pick<ComponentRef, 'gitlabInstance' | 'url'>): FetchFailureToolError {
  return new FetchFailureToolError(`Fetching ${ref.url} failed. ${fetchFailureHint(failure, ref.gitlabInstance)}`, failure);
}

/**
 * A tool error for a failed GitLab request. Response bodies are never included: they are untrusted text.
 */
export function gitlabFailure(error: unknown, ref: Pick<ComponentRef, 'gitlabInstance' | 'url'>): ToolError {
  if (error instanceof ToolError) return error;
  if (isAuthError(error)) {
    return new GitLabAuthToolError(
      `GitLab at ${ref.gitlabInstance} refused the request for ${ref.url} (missing, invalid, or expired token). ` +
        'Add a token for this instance with the "GitLab CI: Add Component Project/Group" command in VS Code, or set GCH_TOKEN_<HOST>.'
    );
  }
  const failure = classifyFetchFailure(error);
  if (failure.kind !== 'unknown') return fetchFailureError(failure, ref);
  const status = extractStatusCode(error);
  return new FetchFailureToolError(`Fetching ${ref.url} failed${status ? ` (HTTP ${status})` : ''}.`, failure);
}

/** Refuse, with a message saying how to allow it, a component on a host the server may not contact. */
export function assertHostAllowed(isHostAllowed: (host: string) => boolean, ref: Pick<ComponentRef, 'gitlabInstance'>): void {
  if (!isHostAllowed(ref.gitlabInstance)) {
    throw new ToolError(hostNotAllowedMessage(ref.gitlabInstance));
  }
}

export function createComponentServices(isHostAllowed: (host: string) => boolean): ComponentServices {
  return {
    fetchComponent: async (ref) => {
      assertHostAllowed(isHostAllowed, ref);
      let component: SpecComponent | null;
      try {
        component = await getComponentService().getComponentFromUrl(ref.url);
      } catch (error) {
        throw gitlabFailure(error, ref);
      }
      if (component && isFetchFailurePlaceholder(component)) {
        const failure = component.fetchFailure;
        if (failure && failure.kind !== 'unknown') throw fetchFailureError(failure, ref);
        throw new FetchFailureToolError(
          `Fetching ${ref.url} failed${failure?.code ? ` (${failure.code})` : ''}. Check the project path, component name, and version.`,
          failure ?? { kind: 'unknown' }
        );
      }
      return component;
    },
    fetchVersions: async (ref) => {
      assertHostAllowed(isHostAllowed, ref);
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
      try {
        return await getComponentCacheManager({ eagerRefresh: false }).fetchComponentVersions(lookup, { throwOnError: true });
      } catch (error) {
        throw gitlabFailure(error, { gitlabInstance: ref.gitlabInstance, url: ref.baseUrl });
      }
    },
  };
}
