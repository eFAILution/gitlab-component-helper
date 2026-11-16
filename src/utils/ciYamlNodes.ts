/**
 * Helpers over `yaml` (eemeli) document nodes for locating GitLab CI jobs and their keywords. Pure — no `vscode`
 * dependency — so the script extractor and its unit tests share one definition of "what counts as a job".
 */

import { isMap, isScalar, isSeq, type YAMLMap } from 'yaml';

/** Keys whose values are shell, run by the job's shell. */
export const SCRIPT_KEYWORDS = ['before_script', 'script', 'after_script'] as const;

/**
 * Top-level keys that are global keywords rather than job names. `before_script`/`after_script` are the deprecated
 * globals and handled separately; `default` holds job-like keywords but is not itself a job.
 */
export const NON_JOB_TOP_LEVEL_KEYWORDS: ReadonlySet<string> = new Set([
  'spec',
  'include',
  'stages',
  'variables',
  'workflow',
  'image',
  'services',
  'cache',
  'default',
  'before_script',
  'after_script',
]);

/**
 * @param map - Mapping node to read from.
 * @param key - Plain string key.
 * @returns The value node stored under `key`, or `undefined` when absent.
 */
export function getNode(map: YAMLMap, key: string): unknown {
  return map.get(key, true);
}

/**
 * @param map - Mapping node to read from.
 * @param key - Plain string key.
 * @returns The value under `key` when it is itself a mapping.
 */
export function getMap(map: YAMLMap, key: string): YAMLMap | undefined {
  const node = getNode(map, key);
  return isMap(node) ? node : undefined;
}

/**
 * @param map - Mapping node to iterate.
 * @returns Each entry whose key is a string scalar, paired with its key text.
 */
export function stringKeyedEntries(map: YAMLMap): Array<{ key: string; value: unknown }> {
  const entries: Array<{ key: string; value: unknown }> = [];
  for (const pair of map.items) {
    if (isScalar(pair.key) && typeof pair.key.value === 'string') {
      entries.push({ key: pair.key.value, value: pair.value });
    }
  }
  return entries;
}

/**
 * Jobs are the top-level mapping entries that are not global keywords. Hidden (`.name`) and interpolated
 * (`$[[ inputs.job_name ]]`) names count, since both carry job keywords.
 *
 * @param topLevel - A document's root mapping.
 * @returns Name and mapping node for every job in the document.
 */
export function jobEntries(topLevel: YAMLMap): Array<{ name: string; job: YAMLMap }> {
  return stringKeyedEntries(topLevel).flatMap(({ key, value }) =>
    !NON_JOB_TOP_LEVEL_KEYWORDS.has(key) && isMap(value) ? [{ name: key, job: value }] : []);
}

/**
 * @param job - A job mapping.
 * @returns Names listed under the job's `extends:`, in source order.
 */
function extendsNames(job: YAMLMap): string[] {
  const node = getNode(job, 'extends');
  if (isScalar(node) && typeof node.value === 'string') return [node.value];
  if (isSeq(node)) {
    return node.items.flatMap(item => isScalar(item) && typeof item.value === 'string' ? [item.value] : []);
  }
  return [];
}

/**
 * Orders a job and everything it inherits through same-file `extends:` from highest to lowest precedence. A later
 * `extends` entry overrides an earlier one, and the job's own keys override both. Templates defined in other files
 * are not visible here and are skipped.
 *
 * @param topLevel - The document's root mapping, where templates are looked up.
 * @param job - The job to resolve.
 * @returns The job first, then its templates; each template appears once even across cycles or diamonds.
 */
export function extendsChain(topLevel: YAMLMap, job: YAMLMap): YAMLMap[] {
  const chain: YAMLMap[] = [];
  /** Appends `node`, then the templates it extends, latest-listed first, skipping any already visited. */
  const visit = (node: YAMLMap): void => {
    if (chain.includes(node)) return;
    chain.push(node);
    for (const name of extendsNames(node).reverse()) {
      const template = getMap(topLevel, name);
      if (template) visit(template);
    }
  };
  visit(job);
  return chain;
}

/**
 * Whether `default:`'s `before_script` reaches this job, per its `inherit:default` setting.
 *
 * @param job - The job mapping.
 * @returns `false` when `inherit:default` is `false` or a list without `before_script`.
 */
export function inheritsDefaultBeforeScript(job: YAMLMap): boolean {
  const inherit = getMap(job, 'inherit');
  if (!inherit) return true;
  const node = getNode(inherit, 'default');
  if (isScalar(node) && node.value === false) return false;
  if (isSeq(node)) return node.items.some(item => isScalar(item) && item.value === 'before_script');
  return true;
}
