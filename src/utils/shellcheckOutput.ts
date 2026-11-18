/**
 * Builds ShellCheck arguments, parses its `json1` output, and maps findings from lint-unit coordinates back to YAML
 * source offsets. Pure — no `vscode` dependency and no process spawning.
 */

import type { ContentRange, LintUnit } from './shellScriptExtractor';
import { isKnownVariable } from './scriptVariables';

/** Dialects ShellCheck's `--shell` accepts; matches the `shellcheck.shell` setting's enum. */
export const SHELLCHECK_SHELLS = ['sh', 'bash', 'dash', 'ksh', 'busybox'] as const;
/** One of {@link SHELLCHECK_SHELLS}. */
export type ShellcheckShell = typeof SHELLCHECK_SHELLS[number];

/** ShellCheck severities, most severe first; matches the `shellcheck.severity` setting's enum. */
export const SHELLCHECK_LEVELS = ['error', 'warning', 'info', 'style'] as const;
/** One of {@link SHELLCHECK_LEVELS}. */
export type ShellcheckLevel = typeof SHELLCHECK_LEVELS[number];

/** How to run ShellCheck, from the `shellcheck.*` settings. */
export interface ShellcheckOptions {
  shell: ShellcheckShell;
  /** Minimum level reported. */
  severity: ShellcheckLevel;
  /** Codes to suppress, as `SC2086` or `2086`; anything else is dropped. */
  exclude: readonly string[];
}

/** One finding as ShellCheck's `json1` format reports it; lines and columns are 1-based, tabs count as one. */
export interface ShellcheckComment {
  line: number;
  endLine: number;
  column: number;
  endColumn: number;
  level: ShellcheckLevel;
  /** The number only: `2086` for SC2086. */
  code: number;
  message: string;
}

/** A finding positioned in the YAML source by offset, `[start, end)`. */
export interface SourceFinding {
  start: number;
  end: number;
  level: ShellcheckLevel;
  /** The number only: `2086` for SC2086. */
  code: number;
  message: string;
  /**
   * Source offset of the first character of the line that starts the flagged command, where a
   * `# shellcheck disable=` line can go. Only set inside a literal `|` block: in any other scalar style an inserted
   * line would be a YAML comment or be folded into the command.
   */
  directiveOffset?: number;
}

/** A change to the YAML that disables a code for one command. */
export type DisableDirectiveEdit =
  | { kind: 'insert'; text: string }
  | { kind: 'replacePrevious'; text: string };

/**
 * @param value - Candidate string.
 * @returns `true` when `value` is one of ShellCheck's shell dialects.
 */
export function isShellcheckShell(value: unknown): value is ShellcheckShell {
  return SHELLCHECK_SHELLS.some(shell => shell === value);
}

/**
 * @param value - Candidate string.
 * @returns `true` when `value` is one of ShellCheck's severity levels.
 */
export function isShellcheckLevel(value: unknown): value is ShellcheckLevel {
  return SHELLCHECK_LEVELS.some(level => level === value);
}

/**
 * @param options - Dialect, minimum severity and excluded codes.
 * @returns Arguments for reading a script from stdin and writing `json1`.
 */
export function buildShellcheckArgs(options: ShellcheckOptions): string[] {
  const exclude = options.exclude
    .map(code => code.trim().toUpperCase())
    .filter(code => /^(SC)?\d{4}$/.test(code));
  return [
    '--format=json1',
    `--shell=${options.shell}`,
    `--severity=${options.severity}`,
    ...(exclude.length > 0 ? [`--exclude=${exclude.join(',')}`] : []),
    '-',
  ];
}

/**
 * @param value - Parsed JSON.
 * @returns `true` when `value` is a non-null object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * @param value - One entry of ShellCheck's `comments` array.
 * @returns `true` when it has every field a finding needs, with the right types.
 */
function isShellcheckComment(value: unknown): value is ShellcheckComment {
  return isRecord(value)
    && typeof value.line === 'number'
    && typeof value.endLine === 'number'
    && typeof value.column === 'number'
    && typeof value.endColumn === 'number'
    && isShellcheckLevel(value.level)
    && typeof value.code === 'number'
    && typeof value.message === 'string';
}

/**
 * @param stdout - ShellCheck's `json1` output.
 * @returns The well-formed comments; malformed output or entries yield nothing rather than throwing.
 */
export function parseShellcheckJson(stdout: string): ShellcheckComment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.comments)) return [];
  return parsed.comments.filter(isShellcheckComment);
}

/** SC2154's message; group 1 is the variable name. */
const UNASSIGNED_VARIABLE = /^([A-Za-z_][A-Za-z0-9_]*) is referenced but not assigned\b/;

/**
 * Codes ShellCheck raises when an operand is a fixed string. A masked `$[[ inputs.x ]]` is one, but GitLab fills it
 * in per pipeline, so comparing or testing it is deliberate.
 */
const CONSTANT_EXPRESSION_CODES: ReadonlySet<number> = new Set([
  2050, // This expression is constant.
  2078, // This expression is constant (bare `[ "..." ]`).
  2157, // Argument to -z/-n is always false/true due to literal strings.
  2194, // This word is constant (`case` subject).
]);

/**
 * @param content - Lint-unit content.
 * @returns Index of the first character of each line.
 */
function lineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/**
 * Drops findings that are false in a GitLab job:
 * - SC2154 for variables GitLab injects;
 * - SC2034 ("appears unused") in a lone `before_script`, whose assignments are used by the jobs' `script` in the
 *   same shell;
 * - constant-expression findings on a line holding a `$[[ ... ]]` interpolation.
 *
 * @param unit - The lint unit the findings came from.
 * @param comments - Parsed ShellCheck findings.
 * @param patterns - User-configured names or globs for variables set outside the file.
 * @returns `comments` without GitLab false positives.
 */
export function filterGitLabFalsePositives(
  unit: LintUnit,
  comments: readonly ShellcheckComment[],
  patterns: readonly string[],
): ShellcheckComment[] {
  const starts = lineStarts(unit.content);
  /** Whether any line the finding spans held a masked `$[[ ... ]]`. */
  const hasInterpolation = (comment: ShellcheckComment): boolean => {
    const from = starts[comment.line - 1];
    if (from === undefined) return false;
    const to = starts[comment.endLine] ?? unit.content.length;
    return unit.interpolations.some(range => range.start < to && range.end > from);
  };

  return comments.filter(comment => {
    if (comment.code === 2034) return !unit.continuesInScript;
    if (CONSTANT_EXPRESSION_CODES.has(comment.code)) return !hasInterpolation(comment);
    if (comment.code !== 2154) return true;
    const name = UNASSIGNED_VARIABLE.exec(comment.message)?.[1];
    return name === undefined || !isKnownVariable(name, unit.knownVariables, patterns);
  });
}

/**
 * @param starts - Line start indices.
 * @param line - 1-based line.
 * @param column - 1-based column.
 * @returns The content index, or `undefined` when the line does not exist.
 */
function contentIndex(starts: number[], line: number, column: number): number | undefined {
  const start = starts[line - 1];
  return start === undefined ? undefined : start + Math.max(column - 1, 0);
}

/**
 * The content index where a disable directive for a finding on `line` can go: the start of that line, moved up past
 * lines it continues with a trailing backslash, since a comment line would break the continuation.
 *
 * @param unit - The lint unit.
 * @param starts - Its line starts.
 * @param line - 1-based line of the finding.
 * @param block - The literal block holding the finding.
 * @returns Content index of the first non-blank character of the command's first line.
 */
function directiveIndex(unit: LintUnit, starts: number[], line: number, block: ContentRange): number {
  let index = line - 1;
  while (index > 0 && starts[index - 1] >= block.start) {
    const previous = unit.content.slice(starts[index - 1], starts[index] - 1);
    if (!/\\[ \t]*$/.test(previous)) break;
    index--;
  }
  const lineStart = starts[index];
  const firstNonBlank = unit.content.slice(lineStart).search(/[^ \t]/);
  return firstNonBlank === -1 ? lineStart : lineStart + firstNonBlank;
}

/**
 * Positions ShellCheck findings in the YAML source. Findings in an inherited `before_script` are dropped, since they
 * are reported where that block is defined; a range spilling past its segment is clipped to it.
 *
 * @param unit - The lint unit ShellCheck was run on.
 * @param comments - Findings for that unit.
 * @returns Findings with source offsets.
 */
export function mapToSource(unit: LintUnit, comments: readonly ShellcheckComment[]): SourceFinding[] {
  const starts = lineStarts(unit.content);
  const lastIndex = unit.offsets.length - 1;
  if (lastIndex < 0) return [];

  return comments.flatMap(comment => {
    const rawStart = contentIndex(starts, comment.line, comment.column);
    if (rawStart === undefined) return [];
    const startIndex = Math.min(rawStart, lastIndex);
    const segment = unit.segments.find(s => startIndex >= s.start && startIndex < s.end);
    if (!segment?.reportable) return [];

    const rawEnd = contentIndex(starts, comment.endLine, comment.endColumn) ?? unit.content.length;
    const endIndex = Math.min(Math.max(rawEnd, startIndex), segment.end);
    const start = unit.offsets[startIndex];
    const end = endIndex > startIndex ? Math.max(unit.offsets[endIndex - 1] + 1, start) : start;

    const finding: SourceFinding = { start, end, level: comment.level, code: comment.code, message: comment.message };
    const block = unit.literalBlocks.find(b => startIndex >= b.start && startIndex < b.end);
    if (block) finding.directiveOffset = unit.offsets[directiveIndex(unit, starts, comment.line, block)];
    return [finding];
  });
}

/** A `# shellcheck disable=` line on its own; group 1 is the indent, group 2 the comma-separated codes. */
const DISABLE_DIRECTIVE = /^([ \t]*)#[ \t]*shellcheck[ \t]+disable=([A-Za-z0-9,]+)[ \t]*$/;

/**
 * Works out the edit that disables `code` for the command on `targetLine`: append it to a `# shellcheck disable=`
 * line directly above at the same indent, or insert a new one.
 *
 * @param targetLine - Text of the command's first line.
 * @param previousLine - Text of the line above, if any.
 * @param code - ShellCheck code number.
 * @returns The edit, or `undefined` when the line above already disables `code`.
 */
export function disableDirectiveEdit(
  targetLine: string,
  previousLine: string | undefined,
  code: number,
): DisableDirectiveEdit | undefined {
  const indent = /^[ \t]*/.exec(targetLine)?.[0] ?? '';
  const name = `SC${code}`;
  const existing = previousLine === undefined ? null : DISABLE_DIRECTIVE.exec(previousLine);
  if (existing && existing[1] === indent) {
    const codes = existing[2].split(',').map(c => c.trim().toUpperCase());
    if (codes.includes(name) || codes.includes(String(code))) return undefined;
    return { kind: 'replacePrevious', text: `${indent}# shellcheck disable=${existing[2]},${name}` };
  }
  return { kind: 'insert', text: `${indent}# shellcheck disable=${name}` };
}
