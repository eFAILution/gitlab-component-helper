/**
 * What the validation tools need from the server: file access, the repository lookup, the host allowlist, and the
 * component services.
 */

import type { RepoContextPort } from '../../core/referenceResolver';
import type { McpWorkspace } from '../adapters/workspace';
import type { ComponentServices } from './getComponentSpec';

export interface ToolContext {
  workspace: McpWorkspace;
  repoContext: RepoContextPort<string>;
  isHostAllowed(host: string): boolean;
  services: ComponentServices;
}
