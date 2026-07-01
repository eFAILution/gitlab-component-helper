/**
 * Pure helpers for resolving the component-input context at a YAML cursor position — given the document text and a
 * line index, work out which `include: - component:` (or `- local:`) entry the line belongs to and which input
 * parameter it names.
 */

import { parseYaml, isYamlNode } from '../utils/yamlParser';
import { findIncludeLine } from '../utils/includeMatcher';

/**
 * The component-input slot a YAML cursor position resolves to.
 */
export interface InputContext {
  /** Name of the input parameter on the resolved line, e.g. `environment` for `environment: "dev"`. */
  inputName: string;
  /** URL or local path of the include that owns the surrounding `inputs:` block. */
  componentUrl: string;
  /** Which include flavour matched: `component` for remote URLs, `local` for in-repo includes. */
  includeKind: 'component' | 'local';
}

interface IncludeCandidate {
  /** The string the YAML side carries — a URL for `component:`, a path for `local:`. */
  value: string;
  /** Which key in the include node — used to locate the source line. */
  key: 'component' | 'local';
}

/**
 * Detect whether the `lineIndex` line in `text` is an input parameter for an `include:` entry.
 *
 * @param text - The full YAML document text.
 * @param lineIndex - 0-based line index where the cursor sits.
 * @returns A populated {@link InputContext} when the line is a properly-indented child of an `inputs:` block under
 *   the closest preceding `component:` or `local:` include; `null` otherwise.
 */
export function findInputContextAtLine(text: string, lineIndex: number): InputContext | null {
  const lines = text.split('\n');
  const currentLine = lines[lineIndex];
  if (currentLine === undefined) return null;

  // Current line must look like an indented `key: value` (or `key:`) entry.
  const inputMatch = currentLine.match(/^(\s+)([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
  if (!inputMatch) return null;
  const inputIndent = inputMatch[1].length;
  const inputName = inputMatch[2];

  // Need a parsed `include:` array to know which includes are in scope; if YAML doesn't parse, bail.
  // Silent: hover runs against the live, often mid-edit document, where a parse failure is expected and handled.
  const parsed = parseYaml(text, true);
  if (!isYamlNode(parsed) || !parsed.include) return null;
  const includes = Array.isArray(parsed.include) ? parsed.include : [parsed.include];

  // Each include is either a remote `component:` URL or a `local:` path — both behave the same here.
  const candidates: IncludeCandidate[] = [];
  for (const include of includes) {
    if (!isYamlNode(include)) continue;
    if (typeof include.component === 'string') {
      candidates.push({ value: include.component, key: 'component' });
    } else if (typeof include.local === 'string') {
      candidates.push({ value: include.local, key: 'local' });
    }
  }
  if (candidates.length === 0) return null;

  // Find the closest include line above the cursor that matches one of the parsed candidates. `candidates` is in
  // document order, so duplicate entries sharing an identical key+URL (the same component included twice with
  // different inputs) are disambiguated by occurrence ordinal.
  let closestIncludeLine = -1;
  let closestCandidate: IncludeCandidate | null = null;
  const occurrenceSeen = new Map<string, number>();
  for (const candidate of candidates) {
    const lineKey = `${candidate.key}:`;
    const occurrenceKey = `${lineKey}\n${candidate.value}`;
    const occurrence = (occurrenceSeen.get(occurrenceKey) ?? 0) + 1;
    occurrenceSeen.set(occurrenceKey, occurrence);

    const matchLine = findIncludeLine(lines, lineKey, candidate.value, occurrence);
    if (matchLine !== -1 && matchLine < lineIndex && matchLine > closestIncludeLine) {
      closestIncludeLine = matchLine;
      closestCandidate = candidate;
    }
  }
  if (closestIncludeLine === -1 || closestCandidate === null) return null;

  // Between the include line and the cursor, there must be an `inputs:` line at strictly lower indent than the
  // current line — guards against e.g. `variables:` blocks at the same level.
  let inputsLineIndent = -1;
  for (let i = closestIncludeLine + 1; i < lineIndex; i++) {
    if (lines[i].trim() === 'inputs:') {
      const m = lines[i].match(/^(\s*)/);
      inputsLineIndent = m ? m[1].length : 0;
      break;
    }
  }
  if (inputsLineIndent === -1) return null;
  if (inputIndent <= inputsLineIndent) return null;

  return {
    inputName,
    componentUrl: closestCandidate.value,
    includeKind: closestCandidate.key,
  };
}
