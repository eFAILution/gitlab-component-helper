/**
 * Pure helpers for the completion side of the component-input flow. Given the document text and a cursor line,
 * work out whether the cursor sits in an empty/partial parameter-name slot inside an `include:` entry's `inputs:`
 * block, and surface which include owns it plus the inputs already present (so the caller can offer only the
 * missing ones).
 */

import { parseYaml, isYamlNode } from '../utils/yamlParser';
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
 * @returns A populated {@link CompletionInputContext} when the cursor is in a parameter-name slot inside the
 *   `inputs:` block of the closest preceding `component:`/`local:` include; `null` otherwise.
 */
export function findCompletionInputContextAtLine(text: string, lineIndex: number): CompletionInputContext | null {
  const parsed = parseYaml(text);
  if (!isYamlNode(parsed) || !parsed.include) return null;

  const includes = Array.isArray(parsed.include) ? parsed.include : [parsed.include];
  const lines = text.split('\n');
  if (lines[lineIndex] === undefined) return null;

  const closest = findClosestInclude(includes, lines, lineIndex);
  if (!closest) return null;

  const section = findInputsSection(lines, closest.componentLineIndex, lineIndex);
  if (!section) return null;

  // Containment in the inputs block is already established above; here we only check the line looks like a
  // parameter-name slot: indented deeper than the `inputs:` key (i.e. a child of it, not a sibling) and not
  // already a complete `key: value`.
  const currentLine = lines[lineIndex];
  const currentLineText = currentLine.trim();
  const isParameterContext =
    indentOf(currentLine) > section.inputsIndent && (!currentLineText.includes(':') || currentLineText.endsWith(':'));
  if (!isParameterContext) return null;

  return {
    componentUrl: closest.componentUrl,
    includeKind: closest.includeKind,
    existingInputNames: closest.existingInputNames,
  };
}

/**
 * Find the include entry whose source line is the closest one above `lineIndex`, matching the parsed includes
 * back to their position in the text.
 */
function findClosestInclude(includes: unknown[], lines: string[], lineIndex: number): ClosestInclude | null {
  let closest: ClosestInclude | null = null;
  let closestDistance = Infinity;

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

    let componentLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(includeKey) && lines[i].includes(componentUrl)) {
        componentLineIndex = i;
        break;
      }
    }
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
 * @returns the `inputs:` line's indentation when `lineIndex` is inside the block, so the caller can decide what
 *   counts as a parameter-name slot relative to it; `null` when the cursor isn't inside an inputs block.
 */
function findInputsSection(lines: string[], componentLineIndex: number, lineIndex: number): { inputsIndent: number } | null {
  const componentIndent = indentOf(lines[componentLineIndex]);

  let inputsSectionStart = -1;
  let inputsIndent = -1;
  let inputsSectionEnd = -1;

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
  }

  if (inputsSectionStart === -1) return null;
  if (inputsSectionEnd === -1) inputsSectionEnd = lines.length;

  if (lineIndex > inputsSectionStart && lineIndex < inputsSectionEnd) {
    return { inputsIndent };
  }
  return null;
}

/**
 * Build the value portion of the snippet inserted after `param.name: ` when an input is accepted from completion.
 *
 * Returns a TextMate snippet body (with `${1...}` tab-stops) the caller wraps in a `vscode.SnippetString`.
 *
 * Values are inserted unquoted: GitLab CI parses a bare YAML scalar by the input's declared type, so a string
 * input is a bare scalar, not a quoted one. The exception is a string ending in a colon — bare, YAML would read it
 * as a nested mapping, so those are wrapped in double quotes. Precedence: an explicit `default` is rendered as the
 * YAML it represents; otherwise an `options:` enum becomes a choice; otherwise a type-appropriate placeholder.
 */
export function buildInputInsertValue(param: ComponentParameter): string {
  // A bare YAML scalar ending in a colon parses as a nested mapping, so those strings are quoted.
  const quoteIfColon = (value: string): string => (value.endsWith(':') ? `"${value}"` : value);

  if (param.default !== undefined) {
    // Render the default as the YAML the input expects: arrays as flow sequences (`[a, b]`),
    // strings bare (quoted only when they end in a colon), everything else as its bare scalar form.
    if (Array.isArray(param.default)) {
      return `[${param.default.map((v) => String(v)).join(', ')}]`;
    }
    return typeof param.default === 'string' ? quoteIfColon(param.default) : String(param.default);
  }

  if (param.options && param.options.length > 0) {
    // Offer the allowed values (`options:`) as a choice. Entries stay unquoted so a number/boolean
    // option isn't turned into a string; string entries are quoted only when a trailing colon would
    // otherwise break the YAML.
    const optionValues = param.options
      .map((val) => (typeof val === 'string' ? quoteIfColon(val) : String(val)))
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
