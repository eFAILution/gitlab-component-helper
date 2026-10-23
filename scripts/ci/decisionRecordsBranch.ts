/**
 * The branch rule for decision records (ADR-366): a record a PR adds must carry the issue number in the PR's branch
 * name, `<type>/<issue>-<description>`.
 */

import { execFileSync } from 'node:child_process';
import { posix } from 'node:path';
import { DOCS_POINTER, RECORDS_DIR, RECORDS_README } from './decisionRecordsStore';

/** `chore/366-issue-keyed-workflow`: the issue number comes right after the type prefix. */
export const BRANCH_ISSUE = /^[A-Za-z0-9._-]+\/([1-9]\d*)(?:-|$)/;
export const BRANCH_FORMAT = '<type>/<issue>-<description>';

export interface Findings {
  errors: string[];
  warnings: string[];
}

export function branchIssue(branch: string | undefined): number | undefined {
  const match = BRANCH_ISSUE.exec(branch ?? '');
  return match ? Number(match[1]) : undefined;
}

function git(root: string, args: readonly string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The branch checked out in `root`. */
export const currentBranch = (root: string): string => git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();

/** Paths under `.ai/decisions/` that HEAD adds or renames in, compared with `base`. Throws when `base` is unknown. */
export function addedRecordPaths(root: string, base: string): string[] {
  const output = git(root, ['diff', '--name-only', '--diff-filter=AR', base, 'HEAD', '--', RECORDS_DIR]);
  return output.split('\n').map((line) => line.trim()).filter(Boolean);
}

const isRecordPath = (path: string): boolean =>
  posix.dirname(path) === RECORDS_DIR && posix.basename(path) !== RECORDS_README;

/** Errors and warnings for the record files a PR on `branch` adds. */
export function branchFindings(added: readonly string[], branch: string): Findings {
  const issue = branchIssue(branch);
  const records = added.filter(isRecordPath);
  if (issue === undefined && records.length === 0) {
    return {
      errors: [],
      warnings: [`branch '${branch}' has no issue number; name branches ${BRANCH_FORMAT} (${DOCS_POINTER}). `
        + 'Fine for Dependabot and forks'],
    };
  }
  if (issue === undefined) {
    return {
      errors: records.map((path) => `${path}: a PR that adds a decision record needs a branch named ${BRANCH_FORMAT} `
        + `(got '${branch}'); push a new branch and open a new PR (${DOCS_POINTER})`),
      warnings: [],
    };
  }
  const expected = `${RECORDS_DIR}/ADR-${issue}.yaml`;
  return {
    errors: records
      .filter((path) => path !== expected)
      .map((path) => `${path}: this branch is for issue #${issue}, so its record must be ${expected}; git mv it `
        + `and set its key to ADR-${issue}, or move it to that issue's own PR`),
    warnings: [],
  };
}

/** Branch findings for a PR: diff against `base` (when given) and apply the rule. */
export function checkBranch(root: string, branch: string, base: string | undefined): Findings {
  if (!base) return branchFindings([], branch);
  try {
    return branchFindings(addedRecordPaths(root, base), branch);
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return {
      errors: [`could not diff against base '${base}' (${detail}); fetch it first, for example `
        + '`git fetch origin beta`, and pass a ref that exists'],
      warnings: [],
    };
  }
}
