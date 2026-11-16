/**
 * Extracts the shell in GitLab CI `before_script` / `script` / `after_script` blocks as lint units for ShellCheck,
 * with a source offset for every character so findings land on the right YAML column whatever the scalar style.
 * Pure — no `vscode` dependency.
 */

import { isAlias, isMap, isScalar, isSeq, parseAllDocuments, Scalar, type YAMLMap } from 'yaml';
import {
  extendsChain,
  getMap,
  getNode,
  inheritsDefaultBeforeScript,
  jobEntries,
} from './ciYamlNodes';
import { collectKnownVariables } from './scriptVariables';

/** A run of lint-unit content, `[start, end)`, including its trailing separator. */
export interface ScriptSegment {
  start: number;
  end: number;
  /** `false` for an inherited `before_script`, linted for context but reported where it is defined. */
  reportable: boolean;
}

/** A range of lint-unit content, `[start, end)`. */
export interface ContentRange {
  start: number;
  end: number;
}

/** One shell session's worth of script, as ShellCheck will see it. */
export interface LintUnit {
  /** Shell text with component interpolation masked; lines are joined with `\n`. */
  content: string;
  /** Source offset in the YAML text for each character of `content`. */
  offsets: number[];
  /** One per block, in order; says which content is reported. */
  segments: ScriptSegment[];
  /** Where each `$[[ ... ]]` was masked. */
  interpolations: ContentRange[];
  /** Content from literal `|` block scalars, where each line is its own source line. */
  literalBlocks: ContentRange[];
  /** Variables GitLab sets for this job, from the file. */
  knownVariables: ReadonlySet<string>;
  /** A lone `before_script`: jobs' `script` continues in the same shell, so its assignments may be used there. */
  continuesInScript: boolean;
}

/** One scalar's parsed value, aligned with the source. */
interface Piece {
  text: string;
  /** Source offset for each character of `text`. */
  offsets: number[];
  /** From a literal `|` block scalar. */
  literal: boolean;
}

/** The pieces of one script keyword's value, such as a job's `before_script`. */
interface Block {
  pieces: Piece[];
  /** `false` for an inherited `before_script`. */
  reportable: boolean;
}

/** A `$[[ ... ]]` component interpolation. */
const INTERPOLATION = /\$\[\[.*?\]\]/g;

/**
 * Replaces each `$[[ ... ]]` component interpolation with an inert word of the same length, so ShellCheck doesn't
 * misread it as `$[` arithmetic and columns stay aligned with the source.
 *
 * @param text - Shell content.
 * @returns `text` with every interpolation replaced by underscores.
 */
export function maskComponentInterpolation(text: string): string {
  return text.replace(INTERPOLATION, match => '_'.repeat(match.length));
}

/**
 * Length of a double-quoted escape sequence starting at the backslash.
 *
 * @param marker - The character after the backslash.
 * @returns Source characters the escape occupies.
 */
function escapeLength(marker: string): number {
  if (marker === 'x') return 4;
  if (marker === 'u') return 6;
  if (marker === 'U') return 10;
  return 2;
}

/**
 * Maps each character of a scalar's parsed value back to its source offset by walking value and source together.
 * Source characters the parser consumed (indentation, folded line breaks, quotes, escape markers) are skipped;
 * value characters with no source counterpart map to the nearest source position.
 *
 * @param source - Full YAML text.
 * @param scalar - A string-valued scalar node with a source range.
 * @returns The value with per-character offsets, or `undefined` for non-string or rangeless scalars.
 */
function alignScalar(source: string, scalar: Scalar): Piece | undefined {
  if (!scalar.range) return undefined;
  const value = scalar.value;
  const text = typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean'
    ? String(value) : undefined;
  if (text === undefined) return undefined;

  const [rangeStart, rangeEnd] = scalar.range;
  const isBlock = scalar.type === Scalar.BLOCK_LITERAL || scalar.type === Scalar.BLOCK_FOLDED;
  const isQuoted = scalar.type === Scalar.QUOTE_DOUBLE || scalar.type === Scalar.QUOTE_SINGLE;
  const isDouble = scalar.type === Scalar.QUOTE_DOUBLE;

  let pos = rangeStart;
  let end = rangeEnd;
  if (isBlock) {
    const headerEnd = source.indexOf('\n', rangeStart);
    pos = headerEnd === -1 ? rangeEnd : headerEnd + 1;
  } else if (isQuoted) {
    pos = rangeStart + 1;
    end = rangeEnd - 1;
  }
  const last = Math.max(rangeStart, end - 1);

  // UTF-16 units, matching how both `text` and `source` index.
  const offsets: number[] = [];
  for (let i = 0; i < text.length; i++) offsets.push(alignChar(text[i]));
  return { text, offsets, literal: scalar.type === Scalar.BLOCK_LITERAL };

  /**
   * Advances through the source to `char`, skipping what the parser consumed.
   *
   * @param char - Next character of the parsed value.
   * @returns Its source offset, or the nearest position when it has no source counterpart.
   */
  function alignChar(char: string): number {
    while (pos < end) {
      const current = source[pos];
      if (current === char) return pos++;
      if (isDouble && current === '\\') {
        const marker = source[pos + 1];
        if (marker === '\n' || marker === '\r') {
          pos += 2;
          continue;
        }
        const at = pos;
        pos += escapeLength(marker);
        return at;
      }
      if (current === ' ' || current === '\t' || current === '\n' || current === '\r' || current === "'") {
        pos++;
        continue;
      }
      break;
    }
    return Math.min(pos, last);
  }
}

/**
 * Flattens a script value into scalar pieces, as GitLab flattens nested sequences. `!reference` tags and aliases
 * are skipped: the referenced script is linted where it is defined.
 *
 * @param source - Full YAML text.
 * @param node - The value of a script keyword.
 * @returns Pieces in execution order.
 */
function scriptPieces(source: string, node: unknown): Piece[] {
  if (isAlias(node)) return [];
  if (isScalar(node)) {
    const piece = alignScalar(source, node);
    return piece ? [piece] : [];
  }
  if (isSeq(node) && node.tag !== '!reference') {
    return node.items.flatMap(item => scriptPieces(source, item));
  }
  return [];
}

/**
 * Joins blocks into one lint unit, `\n`-separated, recording which content ranges are reportable.
 *
 * @param blocks - Blocks in execution order.
 * @param knownVariables - Variables GitLab sets for the job.
 * @param continuesInScript - Whether the unit is a lone `before_script`.
 * @returns The unit, or `undefined` when there is no shell to lint.
 */
function buildUnit(
  blocks: Block[],
  knownVariables: ReadonlySet<string>,
  continuesInScript = false,
): LintUnit | undefined {
  let content = '';
  const offsets: number[] = [];
  const segments: ScriptSegment[] = [];
  const literalBlocks: ContentRange[] = [];

  for (const block of blocks) {
    const start = content.length;
    for (const piece of block.pieces) {
      if (piece.literal) literalBlocks.push({ start: content.length, end: content.length + piece.text.length });
      content += piece.text + '\n';
      const separatorOffset = piece.offsets.length > 0 ? piece.offsets[piece.offsets.length - 1] + 1 : 0;
      offsets.push(...piece.offsets, separatorOffset);
    }
    if (content.length > start) segments.push({ start, end: content.length, reportable: block.reportable });
  }

  if (content.trim() === '' || !segments.some(segment => segment.reportable)) return undefined;
  const interpolations = Array.from(content.matchAll(INTERPOLATION), match => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  return {
    content: maskComponentInterpolation(content),
    offsets,
    segments,
    interpolations,
    literalBlocks,
    knownVariables,
    continuesInScript,
  };
}

/**
 * The `before_script` a job without its own runs: the nearest same-file `extends` template's, else `default:`'s
 * (unless `inherit:default` excludes it), else the legacy global.
 *
 * @param topLevel - The document's root mapping.
 * @param job - A job with no `before_script` of its own.
 * @param fallback - `default:`'s `before_script`, or the legacy global when there is none.
 * @returns The inherited value node, or `undefined`.
 */
function inheritedBeforeScript(topLevel: YAMLMap, job: YAMLMap, fallback: unknown): unknown {
  for (const template of extendsChain(topLevel, job).slice(1)) {
    const node = getNode(template, 'before_script');
    if (node !== undefined) return node;
  }
  return inheritsDefaultBeforeScript(job) ? fallback : undefined;
}

/**
 * Lint units for one document's root mapping, following GitLab's shell boundaries: a job's effective
 * `before_script` and its `script` share one shell; `after_script` runs in its own.
 *
 * @param source - Full YAML text.
 * @param topLevel - The document's root mapping.
 * @returns Units for legacy globals, `default:`, and every job.
 */
function documentUnits(source: string, topLevel: YAMLMap): LintUnit[] {
  const units: LintUnit[] = [];
  const globals = collectKnownVariables(topLevel, undefined);
  /** Keeps `unit` unless there was no shell to lint. */
  const push = (unit: LintUnit | undefined): void => {
    if (unit) units.push(unit);
  };
  /** A block defined here, so its findings are reported. */
  const own = (node: unknown): Block => ({ pieces: scriptPieces(source, node), reportable: true });

  const globalBefore = getNode(topLevel, 'before_script');
  push(buildUnit([own(globalBefore)], globals, true));
  push(buildUnit([own(getNode(topLevel, 'after_script'))], globals));

  const defaults = getMap(topLevel, 'default');
  const defaultBefore = defaults ? getNode(defaults, 'before_script') : undefined;
  if (defaults) {
    push(buildUnit([own(defaultBefore)], globals, true));
    push(buildUnit([own(getNode(defaults, 'after_script'))], globals));
  }

  for (const { job } of jobEntries(topLevel)) {
    const known = collectKnownVariables(topLevel, job);
    const ownBefore = getNode(job, 'before_script');
    const script = getNode(job, 'script');

    const before: Block = ownBefore !== undefined
      ? own(ownBefore)
      : {
        pieces: scriptPieces(source, inheritedBeforeScript(topLevel, job, defaultBefore ?? globalBefore)),
        reportable: false,
      };

    push(script !== undefined ? buildUnit([before, own(script)], known) : buildUnit([before], known, true));
    push(buildUnit([own(getNode(job, 'after_script'))], known));
  }
  return units;
}

/**
 * Extracts every lintable shell block from GitLab CI YAML. Only job-level script keywords count, so a
 * `spec.inputs.script` input or an `include[].inputs.script` value is never treated as shell. Documents that fail
 * to parse are skipped rather than linted from a guessed structure. Merge keys are enabled, as GitLab supports them,
 * so a job with several `<<: *anchor` entries isn't a duplicate-key error.
 *
 * @param source - Full YAML text; component templates may hold a `spec:` document before `---`.
 * @returns Lint units in document order.
 */
export function extractLintUnits(source: string): LintUnit[] {
  return parseAllDocuments(source, { merge: true }).flatMap(doc =>
    doc.errors.length === 0 && isMap(doc.contents) ? documentUnits(source, doc.contents) : []);
}
