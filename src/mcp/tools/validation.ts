/**
 * Run the core validator and version check over one file, with the MCP server's file access, repository lookup,
 * host allowlist, and component services.
 */

import { validateIncludes, type ComponentLookupPort } from '../../core/validation/validateIncludes';
import { checkComponentVersions } from '../../core/validation/versionFindings';
import { parseComponentRef } from '../../core/validation/componentLookup';
import { createReferenceResolver } from '../../core/referenceResolver';
import { resolveLocalIncludeOutcome } from '../../core/localInclude';
import type { Finding } from '../../core/validation/findings';
import { isAuthError } from '../../errors';
import { HostNotAllowedError, hostNotAllowedMessage } from '../adapters/network';
import type { ToolContext } from './context';
import type { SpecComponent } from './getComponentSpec';

export const CHECKS = ['inputs', 'versions', 'local-includes'] as const;
export type Check = (typeof CHECKS)[number];

export interface FileValidation {
  file: string;
  /** The document text, for locating include lines in the output. */
  text: string;
  findings: Finding[];
}

/** Which check a finding belongs to. Local-include input findings carry metadata without a `code`. */
export function checkOf(finding: Finding): Check {
  if (finding.code === 'outdated-component-version') return 'versions';
  if (finding.code === 'local-include-not-found') return 'local-includes';
  return finding.metadata && !('code' in finding.metadata) ? 'local-includes' : 'inputs';
}

export interface ValidationRunner {
  validateFile(file: string, checks: ReadonlySet<Check>): Promise<FileValidation | null>;
  /** Hosts a check wanted to contact but the allowlist refused. */
  blockedHosts(): string[];
}

export function createValidationRunner(context: ToolContext): ValidationRunner {
  const components = new Map<string, SpecComponent | null>();
  const blocked = new Set<string>();

  const refFor = (url: string) => {
    const identity = parseComponentRef(url);
    if (!identity) return null;
    const at = url.indexOf('@');
    return { ...identity, url: `${at === -1 ? url : url.slice(0, at)}@${identity.version}`, baseUrl: at === -1 ? url : url.slice(0, at) };
  };

  const lookup: ComponentLookupPort = {
    findCached: async (url) => components.get(url) ?? null,
    fetch: async (url) => {
      if (components.has(url)) return components.get(url) ?? null;
      const ref = refFor(url);
      if (!ref) return null;
      if (!context.isHostAllowed(ref.gitlabInstance)) {
        blocked.add(ref.gitlabInstance);
        throw new HostNotAllowedError(hostNotAllowedMessage(ref.gitlabInstance));
      }
      // Fetch failures other than auth resolve to null, so the finding says "could not fetch" instead of
      // reporting every input as unknown.
      const component = await context.services.fetchComponent(ref).catch((error: unknown) => {
        if (isAuthError(error)) throw error;
        return null;
      });
      components.set(url, component);
      return component;
    },
  };

  const fetchVersions = async (baseUrl: string) => {
    const ref = refFor(baseUrl);
    if (!ref) return undefined;
    if (!context.isHostAllowed(ref.gitlabInstance)) {
      blocked.add(ref.gitlabInstance);
      return undefined;
    }
    return context.services.fetchVersions(ref).catch(() => undefined);
  };

  return {
    blockedHosts: () => [...blocked],
    validateFile: async (file, checks) => {
      const text = await context.workspace.readText(file);
      if (text === null) return null;
      const resolveReference = createReferenceResolver(file, context.repoContext);
      const findings: Finding[] = [];
      if (checks.has('inputs') || checks.has('local-includes')) {
        const includeFindings = await validateIncludes({
          text,
          file,
          resolveReference,
          components: lookup,
          resolveLocalInclude: (localPath) => resolveLocalIncludeOutcome(localPath, file, context.workspace),
        });
        findings.push(...includeFindings.filter((finding) => checks.has(checkOf(finding))));
      }
      if (checks.has('versions')) {
        findings.push(...((await checkComponentVersions({ text, file, resolveReference, fetchVersions })) ?? []));
      }
      return { file, text, findings };
    },
  };
}
