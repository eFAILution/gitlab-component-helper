/**
 * Turn the text of an `include: - local:` target into the synthetic component the providers and validator use.
 * Reading the file is the host's job; this module only parses.
 */

import * as path from 'path';
import * as yaml from 'js-yaml';
import { Logger } from '../utils/logger';
import { isYamlNode, GITLAB_CI_SCHEMA } from '../utils/yamlParser';
import { isParameterDefault } from '../parsers/parameterDefaultShape';
import { buildLocalComponentUrl } from '../providers/localIncludeParser';
import type { ComponentParameter } from '../types/git-component';

const logger = Logger.getInstance();

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
 * Convert a parsed `spec.inputs` block into the `ComponentParameter[]` shape the rest of the providers consume.
 *
 * Mirrors GitLab's own input contract: a parameter is treated as required when no `default` is supplied. Missing or
 * non-string `description` / `type` fields collapse to safe defaults rather than throwing — the resolver never wants
 * to fail on a malformed-but-readable template since that just produces user-visible spurious diagnostics.
 *
 * @param specInputs  The raw `spec.inputs` object from a parsed YAML document; may be `undefined`, `null`, or any value.
 * @returns           A normalised array of input definitions, or `[]` when `specInputs` isn't an object.
 */
function parseInputs(specInputs: unknown): ComponentParameter[] {
  if (!isYamlNode(specInputs)) {
    return [];
  }
  return Object.entries(specInputs).map(([name, raw]) => {
    const definition: Record<string, unknown> = isYamlNode(raw) ? raw : {};
    const rawDefault = definition.default;
    const rawOptions = definition.options;
    return {
      name,
      description: typeof definition.description === 'string' ? definition.description : '',
      required: rawDefault === undefined,
      type: typeof definition.type === 'string' ? definition.type : 'string',
      default: isParameterDefault(rawDefault) ? rawDefault : undefined,
      options: isOptionsList(rawOptions) ? rawOptions : undefined,
    };
  });
}

/**
 * Narrow an unknown value to the primitive array accepted by `inputs.*.options`.
 *
 * @param value - The raw `options` value from a parsed input definition; may be any value.
 * @returns `true` when `value` is an array of only string/number/boolean entries, narrowing it for the caller.
 */
function isOptionsList(value: unknown): value is Array<string | number | boolean> {
  return (
    Array.isArray(value) &&
    value.every(v => {
      const t = typeof v;
      return t === 'string' || t === 'number' || t === 'boolean';
    })
  );
}

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
  let docs: unknown[];
  try {
    docs = yaml.loadAll(text, { schema: GITLAB_CI_SCHEMA });
  } catch (err) {
    logger.debug(`[LocalComponentResolver] Failed to parse ${displayPath}: ${err}`, 'LocalComponentResolver');
    // The file exists and was read; it just isn't valid YAML. That's a plain include we can't extract inputs from,
    // not a missing file — treat it like a no-spec include rather than a false "not found".
    return { kind: 'no-spec' };
  }
  const specDoc = docs.find(
    (d): d is { spec?: { inputs?: unknown } } => !!d && typeof d === 'object' && 'spec' in d
  );
  if (!specDoc) {
    logger.debug(`[LocalComponentResolver] ${displayPath} has no spec document`, 'LocalComponentResolver');
    return { kind: 'no-spec' };
  }

  const specInputs = specDoc.spec && specDoc.spec.inputs;
  const parameters = parseInputs(specInputs);
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
