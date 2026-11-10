/**
 * Attach and read the typed metadata validation findings carry on a `vscode.Diagnostic`.
 *
 * `vscode.Diagnostic` doesn't carry a typed payload field, so the validation provider attaches a
 * `metadata` object at runtime. This module declares:
 *
 * 1. A typed wrapper alias {@link DiagnosticWithMetadata} for diagnostics that carry metadata.
 * 2. A setter ({@link attachDiagnosticMetadata}) and a getter ({@link readDiagnosticMetadata}) so
 *    the write and read sites use a single, statically-checked API instead of
 *    `(diagnostic as any).metadata = …`.
 *
 * The getter returns a `DiagnosticMetadata` whose `code` literal matches the diagnostic, so callers
 * can narrow via `if (m?.code === 'unknown-input')` and access variant-specific fields directly. The metadata types
 * themselves live in `src/core/validation/metadata.ts` and are re-exported here.
 */

import type * as vscode from 'vscode';
import type { DiagnosticMetadata } from '../core/validation/metadata';

export type {
  UnresolvedVariablesMetadata,
  ComponentFetchFailedMetadata,
  ComponentAuthFailedMetadata,
  UnknownInputMetadata,
  MissingRequiredInputMetadata,
  OutdatedComponentVersionMetadata,
  DiagnosticMetadata,
} from '../core/validation/metadata';

/**
 * `vscode.Diagnostic` extended with the (optional) typed metadata payload. Used at write sites so
 * the producer commits to one of the {@link DiagnosticMetadata} variants.
 */
export type DiagnosticWithMetadata = vscode.Diagnostic & { metadata?: DiagnosticMetadata };

/**
 * Attach typed metadata to a diagnostic. Use this instead of mutating the diagnostic directly so
 * the shape stays committed to the discriminated union.
 *
 * @param diagnostic  The diagnostic being constructed.
 * @param metadata    The variant matching `diagnostic.code`. Pass the literal — TS verifies the
 *                    field set is complete for the chosen `code`.
 */
export function attachDiagnosticMetadata(
  diagnostic: vscode.Diagnostic,
  metadata: DiagnosticMetadata,
): void {
  (diagnostic as DiagnosticWithMetadata).metadata = metadata;
}

/**
 * Read previously-attached metadata off a diagnostic.
 *
 * @param diagnostic  Any diagnostic — typically one from `CodeActionContext.diagnostics`.
 * @returns           The attached metadata or `undefined` if none was set (or it doesn't carry a
 *                    `code` field — defensive check against foreign diagnostics in the collection).
 */
export function readDiagnosticMetadata(
  diagnostic: vscode.Diagnostic,
): DiagnosticMetadata | undefined {
  const metadata = (diagnostic as DiagnosticWithMetadata).metadata;
  return metadata && typeof metadata === 'object' && 'code' in metadata ? metadata : undefined;
}
