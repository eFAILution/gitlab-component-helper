/**
 * Typed diagnostic metadata for the validation provider.
 *
 * `vscode.Diagnostic` doesn't carry a typed payload field, so the validation provider attaches a
 * `metadata` object at runtime. This module declares:
 *
 * 1. A discriminated union {@link DiagnosticMetadata} that pairs each `diagnostic.code` value with
 *    its known metadata shape — so producers and consumers agree on the contract.
 * 2. A typed wrapper alias {@link DiagnosticWithMetadata} for diagnostics that carry metadata.
 * 3. A setter ({@link attachDiagnosticMetadata}) and a getter ({@link readDiagnosticMetadata}) so
 *    the write and read sites use a single, statically-checked API instead of
 *    `(diagnostic as any).metadata = …`.
 *
 * The getter returns a `DiagnosticMetadata` whose `code` literal matches the diagnostic, so callers
 * can narrow via `if (m?.code === 'unknown-input')` and access variant-specific fields directly.
 */

import type * as vscode from 'vscode';
import type { ComponentParameter, ParameterDefault } from '../types/git-component';

/** Shared fields for diagnostics that point at a component reference. */
interface ComponentRefBase {
  /** Original component URL as it appears in the document (may contain `${…}` variables). */
  componentUrl: string;
  /** URL after GitLab variable expansion (when expansion was attempted). */
  expandedUrl?: string;
  /** `inputs:` object provided alongside the include in the source YAML. */
  includeInputs: Record<string, unknown>;
}

/** Metadata attached to `code: 'unresolved-variables'` diagnostics. */
export interface UnresolvedVariablesMetadata extends ComponentRefBase {
  code: 'unresolved-variables';
  /** True when the active workspace is not a GitLab repo and variable expansion can't proceed. */
  isNonGitlabRepo?: boolean;
}

/** Metadata attached to `code: 'component-fetch-failed'` diagnostics. */
export interface ComponentFetchFailedMetadata extends ComponentRefBase {
  code: 'component-fetch-failed';
}

/** Metadata attached to `code: 'unknown-input'` diagnostics (input name not in the component's spec). */
export interface UnknownInputMetadata {
  code: 'unknown-input';
  componentName: string;
  componentUrl: string;
  /** The provided input that isn't recognised. */
  unknownInput: string;
  /** Names of every valid input the component declares — used for QuickPick suggestions. */
  availableInputs: string[];
  /** Full input declarations from the component spec — used for description/type/default rendering. */
  componentInputs: ComponentParameter[];
  /** Marks this as a single-input diagnostic so the code action only replaces this one input. */
  currentInputOnly: boolean;
}

/** Metadata attached to `code: 'missing-required-input'` diagnostics. */
export interface MissingRequiredInputMetadata {
  code: 'missing-required-input';
  componentName: string;
  componentUrl: string;
  /** Name of the required input that the document is missing. */
  missingInput: string;
  /** Description from the component spec, surfaced in QuickFix labels. */
  inputDescription: string;
  /** Declared input type (`string`, `boolean`, etc.). */
  inputType: string;
  /** Default value declared by the component, if any. */
  inputDefault?: ParameterDefault;
  /** Names of inputs the document already provides — context for the "add missing inputs" action. */
  providedInputs: string[];
}

/** Metadata attached to `code: 'outdated-component-version'` diagnostics (a newer stable semver is available). */
export interface OutdatedComponentVersionMetadata {
  code: 'outdated-component-version';
  /** Full component URL as it appears in the document, including the `@version` suffix. */
  componentUrl: string;
  /** The semver ref currently pinned in the document. */
  currentVersion: string;
  /** The latest stable semver available — the quick-fix replaces the ref with this. */
  latestVersion: string;
}

/** All diagnostic metadata variants the validation provider attaches. */
export type DiagnosticMetadata =
  | UnresolvedVariablesMetadata
  | ComponentFetchFailedMetadata
  | UnknownInputMetadata
  | MissingRequiredInputMetadata
  | OutdatedComponentVersionMetadata;

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
