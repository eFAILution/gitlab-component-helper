/**
 * Typed metadata for validation findings: a discriminated union that pairs each finding `code` with its metadata
 * shape, so producers and consumers agree on the contract. The extension attaches it to `vscode.Diagnostic`s (see
 * `src/providers/validationMetadata.ts`); the MCP server returns it as JSON.
 */

import type { ComponentParameter, ParameterDefault } from '../../types/git-component';

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

/** Metadata attached to `code: 'component-auth-failed'` diagnostics (401/403 — token expired/invalid). */
export interface ComponentAuthFailedMetadata extends ComponentRefBase {
  code: 'component-auth-failed';
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
  | ComponentAuthFailedMetadata
  | UnknownInputMetadata
  | MissingRequiredInputMetadata
  | OutdatedComponentVersionMetadata;
