/**
 * "Newer component version available" findings. Host-neutral: the caller supplies reference resolution and the
 * version lookup; settings come from the runtime config port.
 */

import { CONFIG_DEFAULTS } from '../config/defaults';
import { getRuntime } from '../runtime';
import {
  collectSemverComponentBases,
  findOutdatedComponentRefs,
  type OutdatedComponentRef,
} from '../../providers/componentVersionCheck';
import type { ReferenceResolver } from '../references';
import type { Finding, FindingRange, FindingSeverity } from './findings';

export interface VersionCheckInput {
  text: string;
  file: string;
  /** One resolver per document pass, so the expansion context is looked up at most once. */
  resolveReference: ReferenceResolver;
  /** The available refs (tags + branches) for a component base URL, or `undefined` when they can't be had. */
  fetchVersions(baseUrl: string): Promise<readonly string[] | undefined>;
}

/** The `versionCheck.*` settings. */
export function readVersionCheckSettings(): { enabled: boolean; severity: FindingSeverity } {
  const { config } = getRuntime();
  const severity = config.get<string>('versionCheck.severity', CONFIG_DEFAULTS['versionCheck.severity']);
  return {
    enabled: config.get<boolean>('versionCheck.enabled', CONFIG_DEFAULTS['versionCheck.enabled']),
    severity: severity === 'information' ? 'information' : 'warning',
  };
}

/**
 * Resolve the outdated component refs in a document: collect each clean-semver component's project, fetch its
 * available versions once (deduped), then run the pure detection pass.
 *
 * Component URLs that use GitLab variables (e.g. `$CI_SERVER_FQDN/group/comp@1.2.3`) are expanded the same way input
 * validation expands them before their versions are fetched. The version map is keyed by the *raw* base URL (as
 * written in the document), because the pure finder matches against the document text and places ranges there; only
 * the lookup uses the expanded URL.
 *
 * @returns The outdated refs with their precise document locations; empty when nothing is behind.
 */
export async function computeOutdatedRefs(input: VersionCheckInput): Promise<OutdatedComponentRef[]> {
  const bases = collectSemverComponentBases(input.text);
  if (bases.length === 0) {
    return [];
  }

  const versionsByBase = new Map<string, readonly string[] | undefined>();
  await Promise.all(
    bases.map(async rawBase => {
      const resolved = await input.resolveReference(rawBase);
      if (!resolved.resolved) {
        return; // can't resolve the variables for this file — leave the component unchecked
      }
      versionsByBase.set(rawBase, await input.fetchVersions(resolved.url));
    }),
  );

  return findOutdatedComponentRefs(input.text, baseUrl => versionsByBase.get(baseUrl));
}

/** The range of the pinned version ref, which the update replaces. */
export function outdatedRefRange(ref: OutdatedComponentRef): FindingRange {
  return { line: ref.line, startCol: ref.refStart, endCol: ref.refEnd };
}

export function outdatedRefToFinding(ref: OutdatedComponentRef, file: string, severity: FindingSeverity): Finding {
  const range = outdatedRefRange(ref);
  return {
    code: 'outdated-component-version',
    severity,
    message: `A newer version of '${ref.componentName}' is available: ${ref.latestVersion} (current: ${ref.currentVersion}).`,
    file,
    range,
    metadata: {
      code: 'outdated-component-version',
      componentUrl: ref.componentUrl,
      currentVersion: ref.currentVersion,
      latestVersion: ref.latestVersion,
    },
    suggestedEdits: [{ file, range, newText: ref.latestVersion, title: `Update to ${ref.latestVersion}` }],
  };
}

/**
 * Check a document's semver-pinned components for newer stable releases.
 *
 * @returns The findings, or `undefined` when `versionCheck.enabled` is off (the host clears any it showed before).
 */
export async function checkComponentVersions(input: VersionCheckInput): Promise<Finding[] | undefined> {
  const { enabled, severity } = readVersionCheckSettings();
  if (!enabled) {
    return undefined;
  }
  const refs = await computeOutdatedRefs(input);
  return refs.map(ref => outdatedRefToFinding(ref, input.file, severity));
}
