/**
 * Host-neutral validation results. The extension maps each {@link Finding} onto a `vscode.Diagnostic`; the MCP server
 * returns them as JSON. Messages, codes, ranges, and metadata are exactly what the extension has always shown.
 */

import type { DiagnosticMetadata, MissingRequiredInputMetadata, UnknownInputMetadata } from '../../providers/validationMetadata';

export type FindingSeverity = 'error' | 'warning' | 'information';

/** A single-line span, 0-based, matching a `vscode.Range` on `line` from `startCol` to `endCol`. */
export interface FindingRange {
  line: number;
  startCol: number;
  endCol: number;
}

/** A text replacement that fixes a finding, in the form the host's own edit UI can apply. */
export interface SuggestedEdit {
  file: string;
  range: FindingRange;
  newText: string;
  title: string;
}

/**
 * Metadata on local-include input findings. It deliberately has no `code`: the extension never offered quick fixes
 * for local includes, and its code-action lookup only matches metadata that carries one.
 */
export type LocalIncludeInputMetadata = Omit<UnknownInputMetadata, 'code'> | Omit<MissingRequiredInputMetadata, 'code'>;

export type FindingMetadata = DiagnosticMetadata | LocalIncludeInputMetadata;

export interface Finding {
  code: string;
  severity: FindingSeverity;
  message: string;
  file: string;
  range: FindingRange;
  metadata?: FindingMetadata;
  suggestedEdits?: SuggestedEdit[];
}

/**
 * The document's lines as VS Code numbers them (`\r\n`, `\r`, and `\n` all end a line), without line terminators.
 * Ranges built from these match `document.lineAt(line).text` and `document.lineCount`.
 */
export function splitDocumentLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/** A range covering the whole of `line`, like `new vscode.Range(line, 0, line, document.lineAt(line).text.length)`. */
export function wholeLineRange(documentLines: readonly string[], line: number): FindingRange {
  return { line, startCol: 0, endCol: documentLines[line].length };
}
