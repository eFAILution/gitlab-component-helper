/**
 * Decides where the Component Browser's "Insert" places a new `- component:` entry: at the end of the file's top-level
 * `include:` list, or in a new `include:` block at the top of the file when there isn't one. No `vscode` types, so the
 * provider wraps the result into a `vscode.Range` and the unit suite can drive it directly.
 *
 * The `yaml` parser is used for its source ranges only. The edit itself is a text splice, so the rest of the user's
 * file keeps its formatting, quoting and comments exactly as written.
 */

import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  parseAllDocuments,
  Scalar,
  type Document,
  type Node,
  type Range,
} from 'yaml';

/** A 0-based line and character in the document. */
export interface TextPosition {
  line: number;
  character: number;
}

/** Replace `start`–`end` with `text`; a pure insert when the two positions are equal. */
export interface ComponentInsertion {
  start: TextPosition;
  end: TextPosition;
  text: string;
}

/** The indentation `generateComponentText` gives a list item; re-based onto the target list's own indentation. */
const SNIPPET_ITEM_INDENT = '  ';

/** Offsets in the source text, mapped to positions and line ends. */
class SourceText {
  readonly lines: string[];
  private readonly lineCounter: LineCounter;

  constructor(readonly text: string, lineCounter: LineCounter) {
    this.lines = text.split('\n').map(line => line.replace(/\r$/, ''));
    this.lineCounter = lineCounter;
  }

  /** 0-based line holding `offset`. */
  lineOf(offset: number): number {
    return this.lineCounter.linePos(offset).line - 1;
  }

  /** 0-based position of `offset`. */
  positionOf(offset: number): TextPosition {
    const { line, col } = this.lineCounter.linePos(offset);
    return { line: line - 1, character: col - 1 };
  }

  /** Position at the end of `line`, before any `\r`. */
  lineEnd(line: number): TextPosition {
    return { line, character: this.lines[line].length };
  }
}

/**
 * Plan the insertion of `snippet` (as built by `generateComponentText`) into the document `text`.
 *
 *  - Block `include:` list → appended after the list's last entry, re-indented to match the existing items.
 *  - Single `include:` entry (a scalar, flow sequence or flow mapping, or a block mapping) → rewritten as a block
 *    list of the existing entries followed by the new one.
 *  - No top-level `include:` → a new `include:` block after any leading comments, and in the pipeline document after
 *    a component template's `spec:` header.
 *  - Anything this can't rewrite without changing its meaning or layout → `null`, and the caller falls back to the
 *    cursor: YAML that doesn't parse, an alias, anchor or tag on the `include:` value, a block scalar, an entry that
 *    spans lines, or a template with no pipeline document.
 *
 * @param text    The full document text; LF or CRLF line endings.
 * @param snippet The `- component:` entry to add, with the two-space item indentation `generateComponentText` emits.
 * @returns       The range to replace and its replacement text, or `null` when the caller should use the cursor.
 */
export function planComponentInsertion(text: string, snippet: string): ComponentInsertion | null {
  const lineCounter = new LineCounter();
  const docs = parseAllDocuments(text, { lineCounter });
  if (!Array.isArray(docs) || docs.some(doc => doc.errors.length > 0)) {
    return null;
  }
  const source = new SourceText(text, lineCounter);

  const doc = pipelineDocument(docs);
  if (doc === null) {
    return null;
  }
  // An empty document parses to no contents, or to a null scalar when it follows a `---`.
  const contents = doc?.contents;
  if (contents === undefined || contents === null || (isScalar(contents) && contents.value === null)) {
    return appendNewInclude(source, snippet);
  }
  if (!isMap(contents)) {
    return null;
  }

  const include = contents.items.find(pair => isScalar(pair.key) && pair.key.value === 'include');
  if (!include || !isScalar(include.key) || !include.key.range) {
    return prependNewInclude(source, contents, snippet);
  }
  return planIncludeInsertion(source, include.key.range, include.value, snippet);
}

/**
 * The document the `include:` belongs in. A component template opens with a `spec:` header document and keeps its
 * pipeline in the next one; anything else is the first document.
 *
 * @param docs The parsed document stream.
 * @returns    The pipeline document; `undefined` for an empty or comment-only stream; `null` for a template with a
 *             `spec:` header but no `---` pipeline document to put the include in.
 */
function pipelineDocument(docs: Document.Parsed[]): Document.Parsed | undefined | null {
  const [first, second] = docs;
  const hasSpecHeader = isMap(first?.contents) && first.contents.has('spec');
  if (!hasSpecHeader) {
    return first;
  }
  return second ?? null;
}

/**
 * A new `include:` block before the document's first key, so leading comments stay on top.
 *
 * @param source   The document text.
 * @param contents The pipeline document's top-level mapping.
 * @param snippet  The `- component:` entry to add.
 * @returns        An insertion at the start of the first key's line, or `null` if that key doesn't start its line.
 */
function prependNewInclude(source: SourceText, contents: Node, snippet: string): ComponentInsertion | null {
  if (!contents.range) {
    return null;
  }
  const at = source.positionOf(contents.range[0]);
  if (at.character !== 0) {
    return null;
  }
  return { start: at, end: at, text: `include:\n${snippet}\n\n` };
}

/**
 * A new `include:` block at the end of a file with no content to put it before: empty, comments only, or a template
 * whose pipeline document is still empty.
 *
 * @param source  The document text.
 * @param snippet The `- component:` entry to add.
 * @returns       An insertion at the end of the file, starting on a new line.
 */
function appendNewInclude(source: SourceText, snippet: string): ComponentInsertion {
  const block = `include:\n${snippet}`;
  const lastLine = source.lines.length - 1;
  const at = source.lineEnd(lastLine);
  return { start: at, end: at, text: source.lines[lastLine].trim() === '' ? `${block}\n` : `\n${block}` };
}

/**
 * Insert into the existing `include:` key, converting a single entry into a list where needed.
 *
 * @param source   The document text.
 * @param keyRange The `include` key's source range.
 * @param value    The key's value node, as parsed.
 * @param snippet  The `- component:` entry to add.
 * @returns        The range to replace and its replacement text, or `null` for a value that can't be rewritten.
 */
function planIncludeInsertion(
  source: SourceText,
  keyRange: Range,
  value: unknown,
  snippet: string,
): ComponentInsertion | null {
  if (!isNode(value) || isAlias(value) || value.anchor || value.tag || !value.range) {
    return null;
  }

  const valueEnd = source.lineEnd(source.lineOf(value.range[1] - 1));

  if (isSeq(value) && !value.flow) {
    const firstItem = value.items[0];
    if (!isNode(firstItem) || !firstItem.range) {
      return null;
    }
    const indent = /^\s*/.exec(source.lines[source.lineOf(firstItem.range[0])])?.[0] ?? '';
    return { start: valueEnd, end: valueEnd, text: `\n${reindent(snippet, indent)}` };
  }

  if (isMap(value) && !value.flow) {
    return convertBlockMapping(source, value.range, valueEnd, snippet);
  }

  // A null value (`include:`, `include: ~`, `include: null`) holds no entries; its text is dropped.
  const isNull = isScalar(value) && value.value === null;
  const entries = isSeq(value) ? value.items : isNull ? [] : [value];
  const items = entries.map(entry =>
    isNode(entry) && entry.range ? source.text.slice(entry.range[0], entry.range[1]) : null,
  );
  if (items.some(item => item === null || item.includes('\n')) || isBlockScalar(value)) {
    return null;
  }

  const colon = source.text.indexOf(':', keyRange[1]);
  const comment = source.lines[valueEnd.line].slice(source.positionOf(value.range[1]).character).trim();
  const list = items.map(item => `\n${SNIPPET_ITEM_INDENT}- ${item}`).join('');
  return {
    start: source.positionOf(colon + 1),
    end: valueEnd,
    text: `${comment ? ` ${comment}` : ''}${list}\n${snippet}`,
  };
}

/**
 * Turn a block mapping holding a single include entry into the first item of a list, at the mapping's own
 * indentation, and append the snippet after it.
 *
 * @param source   The document text.
 * @param range    The mapping's source range.
 * @param valueEnd End of the mapping's last line.
 * @param snippet  The `- component:` entry to add.
 * @returns        A replacement of the mapping's lines.
 */
function convertBlockMapping(
  source: SourceText,
  range: Range,
  valueEnd: TextPosition,
  snippet: string,
): ComponentInsertion {
  const firstLine = source.lineOf(range[0]);
  const indent = /^\s*/.exec(source.lines[firstLine])?.[0] ?? '';
  const asItem = source.lines
    .slice(firstLine, valueEnd.line + 1)
    .map((line, i) => (i === 0 ? `${indent}- ${line.slice(indent.length)}` : line.trim() === '' ? line : `  ${line}`))
    .join('\n');
  return {
    start: { line: firstLine, character: 0 },
    end: valueEnd,
    text: `${asItem}\n${reindent(snippet, indent)}`,
  };
}

/**
 * Re-base the snippet's two-space item indentation onto `indent`.
 *
 * @param snippet The `- component:` entry, indented as `generateComponentText` emits it.
 * @param indent  The leading whitespace of the target list's `- ` items.
 * @returns       The snippet with each line's leading two spaces replaced by `indent`.
 */
function reindent(snippet: string, indent: string): string {
  return snippet
    .split('\n')
    .map(line => (line.startsWith(SNIPPET_ITEM_INDENT) ? indent + line.slice(SNIPPET_ITEM_INDENT.length) : line))
    .join('\n');
}

/** Type-guard: a parsed value is a YAML node carrying source information, rather than a bare `Pair` or `null`. */
function isNode(value: unknown): value is Node {
  return isScalar(value) || isMap(value) || isSeq(value) || isAlias(value);
}

/** Whether `value` is a `|` or `>` block scalar, whose text lives on the lines below its key. */
function isBlockScalar(value: Node): boolean {
  return isScalar(value) && (value.type === Scalar.BLOCK_LITERAL || value.type === Scalar.BLOCK_FOLDED);
}
