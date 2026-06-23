/**
 * Pure helpers used by ComponentBrowserProvider's "edit existing component" flow. The provider passes a
 * `vscode.TextDocument` + `vscode.Position` in, and wraps each result into the matching vscode type — but the logic
 * itself is plain string and YAML work, so it lives here for unit-testability.
 */

import { parseYaml } from '../utils/yamlParser';

/**
 * The line range of a single `- component:` list item inside a `.gitlab-ci.yml` `include:` block. `endColumn` is
 * `Number.MAX_SAFE_INTEGER` when the caller should treat the range as "to end of `endLine`" — the provider clamps
 * it with `lines[endLine].length` when constructing the `vscode.Range`.
 */
export interface ComponentLineRange {
  /** First line of the `- component:` block (inclusive). */
  startLine: number;
  /** Last line of the `- component:` block (inclusive). Trailing blank lines are excluded. */
  endLine: number;
  /** Length of `lines[endLine]` — i.e. the column the range ends on. */
  endColumn: number;
}

/**
 * Locate the line range of the `- component:` list item that owns `componentName`, given a cursor `lineHint`.
 *
 * Search strategy:
 *  1. Scan up to 10 lines backwards from `lineHint` looking for a `component:` line that mentions `componentName`.
 *  2. If not found, scan up to 10 lines forwards from `lineHint`.
 *  3. Walk back to the list-item start (the line that begins with `- ` at the same or shallower indent).
 *  4. Walk forward to the end of the block (next sibling list item or anything at shallower indent), trimming
 *     trailing blank lines.
 *
 * @param text          The full document text.
 * @param lineHint      The 0-based line the cursor is on. Used as the centre of the search window.
 * @param componentName The component's short name as it appears in the URL (e.g. `target-component`).
 * @returns A `ComponentLineRange`, or `null` if no matching `component:` line is found in the search window.
 */
export function findComponentLineRange(
  text: string,
  lineHint: number,
  componentName: string,
): ComponentLineRange | null {
  const lines = text.split('\n');

  let componentLineIndex = -1;
  for (let i = lineHint; i >= Math.max(0, lineHint - 10); i--) {
    if (lines[i] && lines[i].includes('component:') && lines[i].includes(componentName)) {
      componentLineIndex = i;
      break;
    }
  }
  if (componentLineIndex === -1) {
    for (let i = lineHint; i < Math.min(lines.length, lineHint + 10); i++) {
      if (lines[i] && lines[i].includes('component:') && lines[i].includes(componentName)) {
        componentLineIndex = i;
        break;
      }
    }
  }
  if (componentLineIndex === -1) {
    return null;
  }

  const componentLine = lines[componentLineIndex];
  const indentMatch = componentLine.match(/^(\s*)/);
  const componentIndent = indentMatch ? indentMatch[1].length : 0;

  let startLine = componentLineIndex;
  for (let i = componentLineIndex; i >= 0; i--) {
    const line = lines[i];
    const lineIndentMatch = line.match(/^(\s*)/);
    const lineIndent = lineIndentMatch ? lineIndentMatch[1].length : 0;

    if (line.trim().startsWith('- ') && lineIndent <= componentIndent) {
      startLine = i;
      break;
    }
  }

  let endLine = componentLineIndex;
  for (let i = componentLineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    const lineIndentMatch = line.match(/^(\s*)/);
    const lineIndent = lineIndentMatch ? lineIndentMatch[1].length : 0;

    // Sibling list item at the same indent — stop at the line above it.
    if (line.trim() && lineIndent <= componentIndent && line.trim().startsWith('-')) {
      endLine = i - 1;
      break;
    }
    // Anything else at shallower indent — stop at the line above it.
    if (line.trim() && lineIndent < componentIndent) {
      endLine = i - 1;
      break;
    }

    endLine = i;
  }

  // Trim trailing blank lines from the inferred end.
  while (endLine > componentLineIndex && !lines[endLine].trim()) {
    endLine--;
  }

  return {
    startLine,
    endLine,
    endColumn: lines[endLine].length,
  };
}

/**
 * Parse a previously-emitted `- component:` block back into a YAML include node.
 *
 * The block is wrapped in `include:\n…` so it can be fed to the project's existing YAML parser; the first array
 * entry is returned, or the lone node when the parser produces a scalar include.
 *
 * @param componentText Raw text of the include item, exactly as captured by the provider via `document.getText(range)`.
 * @returns Parsed include entry (e.g. `{ component: '…', inputs: { … } }`), or `null` when the YAML can't be parsed.
 */
export function parseExistingComponentText(componentText: string): unknown {
  try {
    const wrappedYaml = `include:\n${componentText}`;
    const parsed = parseYaml(wrappedYaml, true) as { include?: unknown } | null;
    if (!parsed || parsed.include === undefined) return null;
    if (Array.isArray(parsed.include)) {
      return parsed.include[0] ?? null;
    }
    return parsed.include;
  } catch {
    return null;
  }
}
