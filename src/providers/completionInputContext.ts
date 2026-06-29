/**
 * Pure helpers for the completion side of the component-input flow. Given the document text and a cursor line,
 * work out whether the cursor sits in an empty/partial parameter-name slot inside an `include:` entry's `inputs:`
 * block, and surface which include owns it plus the inputs already present (so the caller can offer only the
 * missing ones).
 */

import { parseYaml, isYamlNode } from '../utils/yamlParser';
import { findIncludeLine } from '../utils/includeMatcher';
import type { ComponentParameter } from '../types/git-component';

/**
 * The completion slot a YAML cursor position resolves to.
 */
export interface CompletionInputContext {
  /** URL or local path of the include that owns the surrounding `inputs:` block. */
  componentUrl: string;
  /** Which include flavour matched: `component` for remote URLs, `local` for in-repo includes. */
  includeKind: 'component' | 'local';
  /** Names of inputs already written under this include, so the caller can filter them out of the suggestions. */
  existingInputNames: string[];
}

interface ClosestInclude {
  componentUrl: string;
  includeKind: 'component' | 'local';
  componentLineIndex: number;
  /** Names of keys directly under this include's `inputs:` mapping. */
  existingInputNames: string[];
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Detect whether the `lineIndex` line in `text` is a parameter-name slot for an `include:` entry's inputs.
 *
 * @param text - The full YAML document text.
 * @param lineIndex - 0-based line index where the cursor sits.
 * @param column - 0-based cursor column. When given, the cursor must actually sit at the slot's indent column —
 *   typing the right indentation then moving the cursor left leaves the spaces in place but no longer offers
 *   completions. Omit to check the line's text alone (the cursor-agnostic form used by tests).
 * @returns A populated {@link CompletionInputContext} when the cursor is in a parameter-name slot inside the
 *   `inputs:` block of the closest preceding `component:`/`local:` include; `null` otherwise.
 */
export function findCompletionInputContextAtLine(
  text: string,
  lineIndex: number,
  column?: number
): CompletionInputContext | null {
  const lines = text.split('\n');
  if (lines[lineIndex] === undefined) return null;

  // A half-typed input name on the cursor line — `env` with no `:` yet — is a bare scalar where its sibling input
  // keys are mappings, which makes the whole document invalid YAML. That would parse to `null` and offer nothing
  // exactly while the user is typing the name. Blank the cursor line before parsing: it contributes nothing to the
  // existing-input set (it *is* the slot being typed), and the positional scans below read `lines`, not the parse.
  const parsed = parseInputDocument(text, lines, lineIndex);
  if (!isYamlNode(parsed) || !parsed.include) return null;

  const includes = Array.isArray(parsed.include) ? parsed.include : [parsed.include];

  const closest = findClosestInclude(includes, lines, lineIndex);
  if (!closest) return null;

  const section = findInputsSection(lines, closest.componentLineIndex, lineIndex);
  if (!section) return null;

  // Containment in the inputs block is already established above; here we only check the line looks like a
  // parameter-name slot. A name slot must line up at the same column as the existing input keys
  // (`section.childIndent`) — one column shallower is a sibling of `inputs:`, deeper is a value nested under
  // another input. When the block has no keys yet, fall back to "deeper than `inputs:`". It must also not be an
  // array-item line (`- value`, part of a parameter value) nor an already-complete `key: value`.
  const currentLine = lines[lineIndex];
  const currentLineText = currentLine.trim();
  const currentIndent = indentOf(currentLine);
  const indentMatches =
    section.childIndent !== null ? currentIndent === section.childIndent : currentIndent > section.inputsIndent;
  // When a cursor column is supplied, the cursor must sit at the slot's indent column or within the name being
  // typed after it — never left of the indent. Typing the right indentation then moving the cursor left leaves
  // the line's whitespace intact, so the indent check above still matches; but the cursor is no longer in the
  // name slot, so we must not offer completions there.
  const cursorAtSlot = column === undefined || column >= currentIndent;
  const isParameterContext =
    indentMatches &&
    cursorAtSlot &&
    !currentLineText.startsWith('- ') &&
    currentLineText !== '-' &&
    (!currentLineText.includes(':') || currentLineText.endsWith(':'));
  if (!isParameterContext) return null;

  return {
    componentUrl: closest.componentUrl,
    includeKind: closest.includeKind,
    existingInputNames: closest.existingInputNames,
  };
}

/**
 * Parse `text` as a YAML mapping, tolerating an in-progress input name on the cursor line.
 *
 * The document parses normally first. If that fails (or yields a non-mapping), and the cursor line looks like a
 * partially-typed name — leading whitespace then a bare token with no `:` — the line is blanked and the document
 * re-parsed. That token is the slot being typed; as a bare scalar beside its mapping siblings it makes the whole
 * document invalid, so blanking it lets the surrounding structure parse while the user types.
 *
 * @param text - The full YAML document text to parse.
 * @param lines - `text` split into lines, so the cursor line can be blanked without re-splitting.
 * @param lineIndex - 0-based index of the cursor line, the one blanked on the retry.
 * @returns the parsed value (from the original text where valid, otherwise the cursor-line-blanked retry), or the
 *   original parse result when the cursor line isn't an in-progress name.
 */
function parseInputDocument(text: string, lines: string[], lineIndex: number): unknown {
  const parsed = parseYaml(text, true);
  if (isYamlNode(parsed) && parsed.include) return parsed;

  const cursorLine = lines[lineIndex];
  const isInProgressName = /^\s*[^\s:#-][^:]*$/.test(cursorLine);
  if (!isInProgressName) return parsed;

  const blanked = [...lines];
  blanked[lineIndex] = '';
  return parseYaml(blanked.join('\n'), true);
}

/**
 * Find the include entry whose source line is the closest one above `lineIndex`, matching the parsed includes
 * back to their position in the text.
 *
 * `includes` is in document order, so duplicate entries that share an identical key+URL (the same component included
 * twice with different inputs) are disambiguated by occurrence ordinal: the Nth such entry anchors to the Nth
 * matching line.
 *
 * @param includes - The parsed `include:` entries, in document order; non-mapping entries and those without a
 *   string `component`/`local` are skipped.
 * @param lines - The full document split into lines, used to locate each include's source line.
 * @param lineIndex - 0-based cursor line; only includes whose source line sits strictly above it are considered.
 * @returns The closest matching include's URL/kind, its source line index, and the names of inputs already present
 *   under it; `null` when no include is declared above `lineIndex`.
 */
function findClosestInclude(includes: unknown[], lines: string[], lineIndex: number): ClosestInclude | null {
  let closest: ClosestInclude | null = null;
  let closestDistance = Infinity;

  // How many key+URL pairs identical to the current entry we have already passed in document order.
  const occurrenceSeen = new Map<string, number>();

  for (const include of includes) {
    if (!isYamlNode(include)) continue;

    const isLocal = typeof include.local === 'string' && typeof include.component !== 'string';
    const componentUrl =
      typeof include.component === 'string'
        ? include.component
        : typeof include.local === 'string'
          ? include.local
          : undefined;
    if (componentUrl === undefined) continue;

    const includeKey = isLocal ? 'local:' : 'component:';

    const occurrenceKey = `${includeKey}\n${componentUrl}`;
    const occurrence = (occurrenceSeen.get(occurrenceKey) ?? 0) + 1;
    occurrenceSeen.set(occurrenceKey, occurrence);

    const componentLineIndex = findIncludeLine(lines, includeKey, componentUrl, occurrence);
    if (componentLineIndex === -1 || componentLineIndex >= lineIndex) continue;

    const distance = lineIndex - componentLineIndex;
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = {
        componentUrl,
        includeKind: isLocal ? 'local' : 'component',
        componentLineIndex,
        existingInputNames: isYamlNode(include.inputs) ? Object.keys(include.inputs) : [],
      };
    }
  }

  return closest;
}

/**
 * Locate the `inputs:` block of the include declared at `componentLineIndex` and report whether `lineIndex` sits
 * inside it.
 *
 * The include entry's own indentation anchors the section boundary: a list item (`- `) or mapping key at that
 * indent or shallower starts the next include/job, whereas anything more deeply indented (e.g. an array value
 * under an input) still belongs to this component's inputs. The `inputs:` key itself is recognised before the
 * boundary test, so the mapping form (where `inputs:` sits at the same indent as the include's `component:` key)
 * isn't mistaken for the section end.
 *
 * @returns when `lineIndex` is inside the block: the `inputs:` line's indentation, and `childIndent` — the
 *   indentation of the first parameter key under it (the column input names line up at), or `null` when the block
 *   has no keys yet. `null` (the whole result) when the cursor isn't inside an inputs block.
 */
function findInputsSection(
  lines: string[],
  componentLineIndex: number,
  lineIndex: number
): { inputsIndent: number; childIndent: number | null } | null {
  const componentIndent = indentOf(lines[componentLineIndex]);

  let inputsSectionStart = -1;
  let inputsIndent = -1;
  let inputsSectionEnd = -1;
  let childIndent: number | null = null;

  for (let i = componentLineIndex + 1; i < lines.length; i++) {
    const trimmedLine = lines[i].trim();
    if (trimmedLine === '') continue;

    // Recognise the `inputs:` header first: in the mapping form it sits at the same indent as the include's
    // `component:`/`local:` key, so the boundary test below would otherwise treat it as the section end.
    if (trimmedLine === 'inputs:') {
      inputsSectionStart = i;
      inputsIndent = indentOf(lines[i]);
      continue;
    }

    if (indentOf(lines[i]) <= componentIndent && (trimmedLine.startsWith('- ') || trimmedLine.includes(':'))) {
      inputsSectionEnd = i;
      break;
    }

    // The first key directly under `inputs:` (not an array item, deeper than `inputs:` itself) fixes the column
    // that input names line up at. Lines nested deeper than this belong to a parameter's value, not a name slot.
    if (
      inputsSectionStart !== -1 &&
      childIndent === null &&
      indentOf(lines[i]) > inputsIndent &&
      !trimmedLine.startsWith('- ') &&
      trimmedLine.includes(':')
    ) {
      childIndent = indentOf(lines[i]);
    }
  }

  if (inputsSectionStart === -1) return null;
  if (inputsSectionEnd === -1) inputsSectionEnd = lines.length;

  if (lineIndex > inputsSectionStart && lineIndex < inputsSectionEnd) {
    return { inputsIndent, childIndent };
  }
  return null;
}

/**
 * Wrap a string in double quotes, escaping backslashes and inner quotes so the result is a valid YAML scalar.
 *
 * @param value - The raw string value to wrap.
 * @returns The value as a double-quoted YAML scalar with backslashes and inner quotes escaped.
 */
function asDoubleQuoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Quote a string for insertion as a YAML value, but only when a bare scalar wouldn't round-trip to the same string.
 *
 * Rather than hand-encode YAML's plain-scalar rules, we ask the parser: render `value` bare and check it parses back
 * to exactly `value`. Plain values (the common case for GitLab enum/default values — `aws`, `production`, `1.2.3`)
 * round-trip and stay bare; anything YAML reinterprets bare — `true`/`null`, numbers, leading indicators, embedded
 * `: ` or ` #`, surrounding whitespace — fails the check and is double-quoted instead.
 *
 * @param value - The raw string value to render as YAML.
 * @param flow - When true the value sits inside a flow collection (`[a, b]`), where `,`, `[`, `]`, `{`, `}` are
 *   significant anywhere in the scalar; those always force quoting since the bare-scalar probe below is block-context.
 * @returns The value bare when a bare scalar round-trips, otherwise a double-quoted (escaped) form.
 */
function quoteYamlIfUnsafe(value: string, flow = false): string {
  if (flow && /[,[\]{}]/.test(value)) {
    return asDoubleQuoted(value);
  }
  try {
    const parsed = parseYaml(`probe: ${value}`, true);
    if (isYamlNode(parsed) && parsed.probe === value) {
      return value;
    }
  } catch {
    // Bare form isn't even valid YAML — fall through to quoting.
  }
  return asDoubleQuoted(value);
}

/**
 * Build the value portion of the snippet inserted after `param.name: ` when an input is accepted from completion.
 *
 * Returns a TextMate snippet body (with `${1...}` tab-stops) the caller wraps in a `vscode.SnippetString`.
 *
 * Values are inserted bare where a bare YAML scalar round-trips to the same string — GitLab CI parses a bare scalar
 * by the input's declared type, so a string input is a bare scalar, not a quoted one. Strings that bare YAML would
 * reinterpret (indicators, embedded `: `/` #`, type-like tokens, etc.) are double-quoted; see {@link quoteYamlIfUnsafe}.
 * Precedence: an explicit `default` is rendered as the YAML it represents; otherwise an `options:` enum becomes a
 * choice; otherwise a type-appropriate placeholder.
 *
 * @param param - The input parameter spec (type, optional default, optional `options` enum, requiredness).
 * @returns The snippet body to insert after `param.name: ` — a rendered value, a `${1|...|}` choice, or a `${1:...}` placeholder.
 */
export function buildInputInsertValue(param: ComponentParameter): string {
  if (param.default !== undefined) {
    // Render the default as the YAML the input expects: arrays as flow sequences (`[a, b]`),
    // strings bare-or-quoted by round-trip safety, everything else as its bare scalar form.
    if (Array.isArray(param.default)) {
      return `[${param.default.map((v) => (typeof v === 'string' ? quoteYamlIfUnsafe(v, true) : String(v))).join(', ')}]`;
    }
    return typeof param.default === 'string' ? quoteYamlIfUnsafe(param.default) : String(param.default);
  }

  if (param.options && param.options.length > 0) {
    // Offer the allowed values (`options:`) as a choice. Entries stay unquoted so a number/boolean
    // option isn't turned into a string; string entries are quoted only when bare YAML would
    // reinterpret them.
    const optionValues = param.options
      .map((val) => (typeof val === 'string' ? quoteYamlIfUnsafe(val) : String(val)))
      .join(',');
    return `\${1|${optionValues}|}`;
  }

  switch (param.type) {
    case 'boolean':
      return param.required ? '${1|true,false|}' : '${1|false,true|}';
    case 'number':
      return '${1:0}';
    case 'integer':
      return param.required ? '${1:1}' : '${1:0}';
    case 'array':
      return '${1:[]}';
    case 'object':
      return '${1:{}}';
    default:
      return param.required ? '${1:TODO set value}' : '${1:}';
  }
}
