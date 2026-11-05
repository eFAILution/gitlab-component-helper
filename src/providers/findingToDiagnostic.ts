import * as vscode from 'vscode';
import type { Finding, FindingMetadata, FindingSeverity } from '../core/validation/findings';

export const DIAGNOSTIC_SOURCE = 'gitlab-component-helper';

const SEVERITY: Record<FindingSeverity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
};

/**
 * Turn a core validation finding into the diagnostic the extension publishes. Metadata rides along on the
 * diagnostic for the code actions (see `validationMetadata.ts`); a finding without metadata gets none.
 */
export function findingToDiagnostic(finding: Finding): vscode.Diagnostic {
  const { line, startCol, endCol } = finding.range;
  const diagnostic: vscode.Diagnostic & { metadata?: FindingMetadata } = new vscode.Diagnostic(
    new vscode.Range(line, startCol, line, endCol),
    finding.message,
    SEVERITY[finding.severity]
  );
  diagnostic.code = finding.code;
  diagnostic.source = DIAGNOSTIC_SOURCE;
  if (finding.metadata) {
    diagnostic.metadata = finding.metadata;
  }
  return diagnostic;
}
