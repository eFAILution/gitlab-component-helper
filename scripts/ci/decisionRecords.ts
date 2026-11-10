/**
 * Decision records keyed to their GitHub issue (ADR-366): check, list and scaffold.
 *
 *   npx tsx scripts/ci/decisionRecords.ts check [--branch <head> --base <ref>]
 *   npx tsx scripts/ci/decisionRecords.ts list [--format table|yaml|json]
 *   npx tsx scripts/ci/decisionRecords.ts new --title "Short decision title" [--issue <n>]
 *
 * `list` is the index. It is built from both stores at read time and never committed, because a committed index is
 * one more file every PR would edit.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import * as yaml from 'js-yaml';
import { BRANCH_FORMAT, branchIssue, checkBranch, currentBranch, type Findings } from './decisionRecordsBranch';
import { loadLegacy, loadRecords, RECORDS_DIR, referenceErrors } from './decisionRecordsStore';

export interface CheckOptions {
  branch?: string;
  base?: string;
}

export interface IndexRow {
  id: string;
  title: string;
  status: string;
  date?: string;
  source: string;
  superseded_by?: string;
}

export interface Io {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  today?: Date;
}

const FORMATS = ['table', 'yaml', 'json'] as const;
type Format = (typeof FORMATS)[number];

const EXIT_OK = 0;
const EXIT_PROBLEMS = 1;
const EXIT_USAGE = 2;

const USAGE = [
  'usage: decisionRecords.ts check [--branch <head branch> --base <ref>]',
  '       decisionRecords.ts list [--format table|yaml|json]',
  '       decisionRecords.ts new --title "Short decision title" [--issue <n>]',
].join('\n');

/** Validate both stores, and with `branch`, the branch rule for the records the PR adds since `base`. */
export function runCheck(root: string, { branch, base }: CheckOptions): Findings {
  const legacy = loadLegacy(root);
  const records = loadRecords(root);
  const branchResult = branch ? checkBranch(root, branch, base) : { errors: [], warnings: [] };
  return {
    errors: [
      ...legacy.errors,
      ...records.errors,
      ...referenceErrors(legacy.entries, records.entries),
      ...branchResult.errors,
    ],
    warnings: branchResult.warnings,
  };
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Every decision from both stores: legacy keys in file order, then records by issue number. */
export function buildIndex(root: string): IndexRow[] {
  const entries = [...loadLegacy(root).entries, ...loadRecords(root).entries];
  const supersededBy = new Map(entries.flatMap(({ id, entry }) =>
    (Array.isArray(entry.supersedes) ? entry.supersedes : []).map((old): [unknown, string] => [old, id])));
  return entries.map(({ id, entry, source }) => {
    const successor = text(entry.superseded_by) || supersededBy.get(id);
    const date = text(entry.date);
    return {
      id,
      title: text(entry.title),
      status: text(entry.status),
      ...(date ? { date } : {}),
      source,
      ...(successor ? { superseded_by: successor } : {}),
    };
  });
}

const isoDate = (day: Date): string => [
  day.getFullYear(),
  String(day.getMonth() + 1).padStart(2, '0'),
  String(day.getDate()).padStart(2, '0'),
].join('-');

/** A new record file that passes `check`, with prompts in place of the real text. */
export function skeleton(issue: number, title: string, today: Date): string {
  return [
    `# Decision record for issue #${issue}. How to fill it in: AGENTS.md, "Issues, branches, and records".`,
    "version: '2.0'",
    'decisions:',
    `  ADR-${issue}:`,
    `    title: ${JSON.stringify(title)}`,
    `    date: '${isoDate(today)}'`,
    '    status: proposed',
    '    context: |-',
    `      Issue #${issue}. What problem made this decision necessary, with the facts that matter?`,
    '    decision: |-',
    '      What we decided, specific enough to build from.',
    '    rationale:',
    '      - Why this option.',
    '    alternatives_considered:',
    '      - name: Another option',
    '        rejected_because: Why not.',
    '    consequences:',
    '      positive:',
    '        - What gets better.',
    '      negative:',
    '        - What it costs.',
    '',
  ].join('\n');
}

function formatTable(rows: readonly IndexRow[]): string[] {
  const idWidth = Math.max(3, ...rows.map(({ id }) => id.length));
  const statusWidth = Math.max(6, ...rows.map(({ status }) => status.length));
  const line = (id: string, status: string, title: string): string =>
    `${id.padEnd(idWidth)}  ${status.padEnd(statusWidth)}  ${title}`.trimEnd();
  return [
    line('KEY', 'STATUS', 'TITLE'),
    ...rows.map((row) => line(row.id, row.status, row.title + (row.superseded_by ? ` (superseded by ${row.superseded_by})` : ''))),
  ];
}

function reporter(io: Io): (kind: 'error' | 'warning', message: string) => void {
  const inActions = io.env.GITHUB_ACTIONS === 'true';
  return (kind, message) => (inActions ? io.stdout(`::${kind}::${message}`) : io.stderr(`${kind}: ${message}`));
}

function commandCheck(io: Io, options: CheckOptions): number {
  if (options.base && !options.branch) {
    io.stderr('error: --base needs --branch (the PR head branch)');
    return EXIT_USAGE;
  }
  const report = reporter(io);
  const { errors, warnings } = runCheck(io.cwd, options);
  warnings.forEach((message) => report('warning', message));
  errors.forEach((message) => report('error', message));
  if (errors.length) return EXIT_PROBLEMS;
  io.stdout('Decision records OK');
  return EXIT_OK;
}

function commandList(io: Io, format: string | undefined): number {
  const chosen = (format ?? 'table') as Format;
  if (!FORMATS.includes(chosen)) {
    io.stderr(`error: --format must be one of ${FORMATS.join(', ')}`);
    return EXIT_USAGE;
  }
  const rows = buildIndex(io.cwd);
  const output = {
    json: () => [JSON.stringify(rows, null, 2)],
    yaml: () => [yaml.dump(rows).trimEnd()],
    table: () => formatTable(rows),
  }[chosen]();
  output.forEach((line) => io.stdout(line));
  const problems = runCheck(io.cwd, {}).errors.length;
  if (problems) io.stderr(`warning: ${problems} problem(s) in the records; run the check command to see them`);
  return EXIT_OK;
}

function issueFromBranch(root: string): number | undefined {
  try {
    return branchIssue(currentBranch(root));
  } catch {
    return undefined;
  }
}

function commandNew(io: Io, title: string | undefined, issueFlag: string | undefined): number {
  if (!title || title.trim().length < 3) {
    io.stderr('error: pass --title "Short decision title" (at least 3 characters)');
    return EXIT_USAGE;
  }
  if (issueFlag !== undefined && !/^[1-9]\d*$/.test(issueFlag)) {
    io.stderr('error: --issue takes the bare issue number, like --issue 366');
    return EXIT_USAGE;
  }
  const issue = issueFlag ? Number(issueFlag) : issueFromBranch(io.cwd);
  if (issue === undefined) {
    io.stderr(`error: no issue number; pass --issue <n> or work on a branch named ${BRANCH_FORMAT}`);
    return EXIT_PROBLEMS;
  }
  const relative = `${RECORDS_DIR}/ADR-${issue}.yaml`;
  mkdirSync(join(io.cwd, RECORDS_DIR), { recursive: true });
  try {
    // 'wx' fails when the file exists, so an existing record is never overwritten.
    writeFileSync(join(io.cwd, relative), skeleton(issue, title.trim(), io.today ?? new Date()), { flag: 'wx' });
  } catch (error) {
    const exists = (error as NodeJS.ErrnoException).code === 'EEXIST';
    io.stderr(exists ? `error: ${relative} already exists; edit it instead` : `error: could not write ${relative}`);
    return EXIT_PROBLEMS;
  }
  io.stdout(`Wrote ${relative}`);
  return EXIT_OK;
}

type Parsed = ReturnType<typeof parseCli>;

function parseCli(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      branch: { type: 'string' },
      base: { type: 'string' },
      format: { type: 'string' },
      title: { type: 'string' },
      issue: { type: 'string' },
    },
  });
}

function tryParse(argv: readonly string[], io: Io): Parsed | undefined {
  try {
    return parseCli(argv);
  } catch (error) {
    io.stderr(`error: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

export function main(argv: readonly string[], io: Io): number {
  const parsed = tryParse(argv, io);
  const [command, ...extra] = parsed?.positionals ?? [];
  if (!parsed || extra.length) {
    io.stderr(USAGE);
    return EXIT_USAGE;
  }
  const { values } = parsed;
  if (command === 'check') return commandCheck(io, { branch: values.branch, base: values.base });
  if (command === 'list') return commandList(io, values.format);
  if (command === 'new') return commandNew(io, values.title, values.issue);
  io.stderr(USAGE);
  return EXIT_USAGE;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  });
}
