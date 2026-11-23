/**
 * Resolve an `include: - local:` target and turn its text into the synthetic component the providers and validator
 * use. The host supplies file access through a {@link WorkspacePort}.
 */

import * as path from 'path';
import { Logger } from '../utils/logger';
import { countYamlAliases, MAX_YAML_ALIASES } from '../utils/yamlParser';
import { readSpecInputs } from '../parsers/specInputs';
import { buildLocalComponentUrl, isUnsupportedLocalPath } from '../providers/localIncludeParser';
import type { ComponentParameter } from '../types/git-component';

const logger = Logger.getInstance();

/** Largest local include target read from disk. Bigger files are treated as unreadable. */
export const MAX_LOCAL_INCLUDE_BYTES = 1024 * 1024;

/**
 * Whether `candidate` lies strictly inside `root`.
 *
 * @param pathApi `path.posix` or `path.win32`; defaults to the platform's.
 */
export function isInsideRoot(root: string, candidate: string, pathApi: typeof path.posix = path): boolean {
  const relative = pathApi.relative(root, candidate);
  return relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${pathApi.sep}`) &&
    !pathApi.isAbsolute(relative);
}

/**
 * File access for local includes. `F` is however the host names the including document. Paths are absolute
 * filesystem paths.
 */
export interface WorkspacePort<F = string> {
  /** The workspace roots. */
  roots(): string[];
  /** The directory `local:` paths in `forFile` resolve against (its repository root, as GitLab does), or `null`. */
  resolutionRoot(forFile: F): Promise<string | null>;
  /** The file's text, or `null` when it's missing or unreadable. */
  readText(absPath: string): Promise<string | null>;
}

/** The component a local include with a `spec:` block resolves to. */
export interface LocalIncludeComponent {
  name: string;
  description: string;
  parameters: ComponentParameter[];
  source: string;
  url: string;
  originalUrl: string;
  sourcePath: string;
}

/**
 * The outcome of resolving a `local:` include, discriminating the reasons resolution can fail to yield a component.
 *
 * `unreadable` and `no-spec` look identical to callers that only want the component, but they are opposites to the
 * validator: `unreadable` is a real problem (the included file is missing or can't be read) worth a diagnostic,
 * whereas `no-spec` is a legitimate plain include (hidden jobs, `.pre`/`.post`, cache config) with nothing to
 * validate and must stay silent. Collapsing both to `null` is what made valid non-parameterised includes report a
 * spurious "file not found" warning.
 */
export type LocalIncludeOutcome<C extends Pick<LocalIncludeComponent, 'name' | 'parameters'> = LocalIncludeComponent> =
  | { kind: 'component'; component: C }
  /** Path is a glob/`..`, or no resolution root is available — not something to diagnose. */
  | { kind: 'skipped' }
  /** The include target is missing or unreadable — the validator surfaces this as a diagnostic. */
  | { kind: 'unreadable' }
  /** The target was read and parsed but declares no `spec:` document — a valid plain include, nothing to validate. */
  | { kind: 'no-spec' };

/**
 * Parse a local include target that was read successfully: pick the first YAML document declaring `spec` and map its
 * `spec.inputs` onto `ComponentParameter[]`.
 *
 * @param localPath   The raw path string from the `include: - local:` entry.
 * @param text        The target file's text.
 * @param displayPath The resolved path, for log lines only.
 * @returns A `component` outcome, or `no-spec` when the file has no `spec:` document or isn't valid YAML.
 */
export function parseLocalIncludeText(
  localPath: string,
  text: string,
  displayPath: string
): LocalIncludeOutcome {
  const aliasCount = countYamlAliases(text);
  if (aliasCount > MAX_YAML_ALIASES) {
    logger.debug(`[LocalComponentResolver] ${displayPath} has ${aliasCount} YAML aliases, over the limit of ${MAX_YAML_ALIASES}; not parsing it`, 'LocalComponentResolver');
    return { kind: 'no-spec' };
  }
  const spec = readSpecInputs(text);
  if (spec.kind === 'invalid') {
    logger.debug(`[LocalComponentResolver] Failed to parse ${displayPath}: ${spec.reason}`, 'LocalComponentResolver');
    // The file exists and was read; it just isn't valid YAML. That's a plain include we can't extract inputs from,
    // not a missing file — treat it like a no-spec include rather than a false "not found".
    return { kind: 'no-spec' };
  }
  if (spec.kind === 'no-spec') {
    logger.debug(`[LocalComponentResolver] ${displayPath} has no spec document`, 'LocalComponentResolver');
    return { kind: 'no-spec' };
  }

  const parameters = spec.inputs ?? [];
  const displayName = path.basename(localPath);
  const url = buildLocalComponentUrl(localPath);

  return {
    kind: 'component',
    component: {
      name: displayName,
      description: `Local include: \`${localPath}\``,
      parameters,
      source: 'local',
      url,
      originalUrl: url,
      sourcePath: localPath,
    },
  };
}

/**
 * Resolve a `local:` path against the resolution root of the document that includes it. Leading slashes are
 * tolerated (GitLab itself accepts both `/templates/x.yml` and `templates/x.yml`) and stripped before joining.
 *
 * @returns The absolute path, or `null` if no resolution root is available or the path would leave it.
 */
export async function resolveLocalIncludePath<F>(
  localPath: string,
  forFile: F,
  workspace: WorkspacePort<F>
): Promise<string | null> {
  const root = await workspace.resolutionRoot(forFile);
  if (!root) {
    return null;
  }
  const relative = localPath.replace(/^\/+/, '');
  const absolutePath = path.join(root, ...relative.split('/'));
  if (!isInsideRoot(root, absolutePath)) {
    logger.debug(`[LocalComponentResolver] Local include escapes its root, skipping: ${localPath}`, 'LocalComponentResolver');
    return null;
  }
  return absolutePath;
}

/**
 * Resolve a local include path into a {@link LocalIncludeOutcome}: read the target through the workspace port, parse
 * every YAML document in it, pick the first one declaring `spec`, and map `spec.inputs` onto `ComponentParameter[]`.
 *
 * @returns The resolution outcome — a `component` on success, or one of `skipped`/`unreadable`/`no-spec`.
 */
export async function resolveLocalIncludeOutcome<F>(
  localPath: string,
  forFile: F,
  workspace: WorkspacePort<F>
): Promise<LocalIncludeOutcome> {
  if (isUnsupportedLocalPath(localPath)) {
    return { kind: 'skipped' };
  }

  const absolutePath = await resolveLocalIncludePath(localPath, forFile, workspace);
  if (!absolutePath) {
    logger.debug(`[LocalComponentResolver] No resolution root available for: ${localPath}`, 'LocalComponentResolver');
    return { kind: 'skipped' };
  }

  const text = await workspace.readText(absolutePath);
  if (text === null) {
    return { kind: 'unreadable' };
  }
  return parseLocalIncludeText(localPath, text, absolutePath);
}
