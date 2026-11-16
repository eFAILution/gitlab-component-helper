/**
 * Names of CI/CD variables GitLab injects into a job's shell. ShellCheck can't see these, so it reports lowercase or
 * mixed-case ones as "referenced but not assigned" (SC2154). Pure — no `vscode` dependency.
 */

import { minimatch } from 'minimatch';
import { isMap, isSeq, type YAMLMap } from 'yaml';
import { extendsChain, getMap, getNode, stringKeyedEntries } from './ciYamlNodes';

/**
 * @param node - A `variables:` value node.
 * @returns The variable names it defines; values (plain or `{ value, description }`) are irrelevant.
 */
function variableNames(node: unknown): string[] {
  return isMap(node) ? stringKeyedEntries(node).map(entry => entry.key) : [];
}

/**
 * Collects the variables a job's shell sees from the file itself: global `variables:`, plus for a job its own
 * `variables:`, those inherited through same-file `extends:`, every `rules[].variables`, and `parallel:matrix`
 * keys.
 *
 * @param topLevel - The document's root mapping.
 * @param job - The job, or `undefined` for blocks outside any job (`default:`, legacy globals).
 * @returns Variable names known to be set when the job runs.
 */
export function collectKnownVariables(topLevel: YAMLMap, job: YAMLMap | undefined): Set<string> {
  const names = new Set(variableNames(getNode(topLevel, 'variables')));
  if (!job) return names;

  for (const node of extendsChain(topLevel, job)) {
    variableNames(getNode(node, 'variables')).forEach(name => names.add(name));

    const rules = getNode(node, 'rules');
    if (isSeq(rules)) {
      for (const rule of rules.items) {
        if (isMap(rule)) variableNames(getNode(rule, 'variables')).forEach(name => names.add(name));
      }
    }

    const parallel = getMap(node, 'parallel');
    const matrix = parallel ? getNode(parallel, 'matrix') : undefined;
    if (isSeq(matrix)) {
      for (const entry of matrix.items) {
        if (isMap(entry)) stringKeyedEntries(entry).forEach(({ key }) => names.add(key));
      }
    }
  }
  return names;
}

/**
 * @param name - Variable name ShellCheck reported.
 * @param known - Names collected from the file.
 * @param patterns - User-configured names or globs for variables set outside the file (project/group settings).
 * @returns `true` when the variable is known to GitLab, so the finding is a false positive.
 */
export function isKnownVariable(name: string, known: ReadonlySet<string>, patterns: readonly string[]): boolean {
  return known.has(name) || patterns.some(pattern => minimatch(name, pattern));
}
