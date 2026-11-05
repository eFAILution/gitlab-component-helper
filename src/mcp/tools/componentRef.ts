/**
 * Turn a component reference from a tool argument into the URL the services fetch.
 */

import { containsGitLabVariables } from '../../utils/gitlabVariables';
import { parseComponentRef } from '../../core/validation/componentLookup';
import { ToolError } from '../server';

export interface ComponentRef {
  /** `https://host/group/project/name@version`. */
  url: string;
  /** The same without `@version`. */
  baseUrl: string;
  gitlabInstance: string;
  sourcePath: string;
  name: string;
  version: string;
}

/**
 * @param component `host/group/project/name[@version]`, with or without `https://`.
 * @param version   Overrides any `@version` in `component`.
 */
export function parseComponentArgument(component: string, version?: string): ComponentRef {
  const trimmed = component.trim();
  if (containsGitLabVariables(trimmed)) {
    throw new ToolError(
      'The component reference contains CI/CD variables. Pass the expanded reference (host/group/project/component@version), or call validate_ci_file on the file that uses it.'
    );
  }
  const withScheme = /^https:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^http:\/\//i, '')}`;
  const at = withScheme.indexOf('@');
  const baseUrl = at === -1 ? withScheme : withScheme.slice(0, at);
  const pinned = version?.trim() || (at === -1 ? undefined : withScheme.slice(at + 1));
  const identity = parseComponentRef(pinned ? `${baseUrl}@${pinned}` : baseUrl);
  if (!identity) {
    throw new ToolError('Not a component reference. Expected host/group/project/component@version, e.g. gitlab.com/components/opentofu/full-pipeline@2.0.0.');
  }
  return { url: `${baseUrl}@${identity.version}`, baseUrl, ...identity };
}
