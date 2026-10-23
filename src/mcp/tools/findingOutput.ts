/**
 * Shape core findings for agents. Messages are fixed text written by us; names, descriptions, and defaults that came
 * from YAML or a component spec go in cleaned, length-capped data fields. Provided input values never appear: they
 * can be YAML aliases that expand to huge trees.
 */

import { extractLocalIncludePath } from '../../providers/localIncludeParser';
import { splitDocumentLines, type Finding, type FindingMetadata } from '../../core/validation/findings';
import { cleanDefault, cleanName, cleanNames, cleanPath, cleanText, MAX_NAME_LENGTH } from './sanitize';

const MESSAGES: Record<string, string> = {
  'unknown-input': 'The include passes an input that the component (or local template) does not declare.',
  'missing-required-input': 'The include does not pass an input the component requires.',
  'unresolved-variables': 'The component reference uses CI/CD variables that cannot be expanded here, so it was not checked.',
  'component-fetch-failed': 'The component could not be fetched, so its inputs were not checked.',
  'component-auth-failed': 'GitLab refused the request (missing, invalid, or expired token), so the inputs were not checked.',
  'local-include-not-found': 'The local include file was not found or could not be read.',
  'outdated-component-version': 'A newer stable version of the component is available.',
};

// An unknown input this close to exactly one declared input is probably a typo of it.
const MAX_TYPO_DISTANCE = 2;

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length];
}

/** The one declared input an unknown input is a near miss of, if there is exactly one. */
export function likelyIntendedInput(unknown: string, available: readonly string[]): string | undefined {
  const close = available.filter((name) => name.toLowerCase() === unknown.toLowerCase() || editDistance(name, unknown) <= MAX_TYPO_DISTANCE);
  return close.length === 1 ? close[0] : undefined;
}

function reference(value: unknown): string {
  return cleanName(cleanText(value, MAX_NAME_LENGTH));
}

function details(metadata: FindingMetadata | undefined): Record<string, unknown> {
  if (!metadata) return {};
  if ('unknownInput' in metadata) {
    return {
      component: cleanName(metadata.componentName),
      reference: reference(metadata.componentUrl),
      input: cleanName(metadata.unknownInput),
      availableInputs: cleanNames(metadata.availableInputs),
    };
  }
  if ('missingInput' in metadata) {
    return {
      component: cleanName(metadata.componentName),
      reference: reference(metadata.componentUrl),
      input: cleanName(metadata.missingInput),
      inputType: cleanName(metadata.inputType),
      ...(metadata.inputDefault !== undefined ? { inputDefault: cleanDefault(metadata.inputDefault) } : {}),
      description: cleanText(metadata.inputDescription),
      providedInputs: cleanNames(metadata.providedInputs),
    };
  }
  if (metadata.code === 'outdated-component-version') {
    return {
      reference: reference(metadata.componentUrl),
      currentVersion: cleanName(metadata.currentVersion),
      latestVersion: cleanName(metadata.latestVersion),
    };
  }
  return {
    reference: reference(metadata.componentUrl),
    ...(metadata.expandedUrl ? { expandedUrl: reference(metadata.expandedUrl) } : {}),
    ...(metadata.code === 'unresolved-variables' ? { nonGitLabRepository: metadata.isNonGitlabRepo === true } : {}),
  };
}

function suggestedEdits(finding: Finding, extra: Record<string, unknown>): Array<Record<string, unknown>> {
  const edits = (finding.suggestedEdits ?? []).map((edit) => ({
    file: cleanPath(edit.file),
    range: edit.range,
    newText: cleanName(edit.newText),
    title: cleanName(edit.title),
  }));
  const input = extra.input as string | undefined;
  const available = extra.availableInputs as string[] | undefined;
  const { range } = finding;
  // Only when the range covers just the input name, so replacing it renames the key and nothing else.
  if (finding.code === 'unknown-input' && input && available && range.endCol - range.startCol === input.length) {
    const intended = likelyIntendedInput(input, available);
    if (intended) edits.push({ file: cleanPath(finding.file), range, newText: intended, title: `Rename input ${input} to ${intended}` });
  }
  return edits;
}

export function toOutputFinding(finding: Finding, text: string): Record<string, unknown> {
  const extra = details(finding.metadata);
  if (finding.code === 'local-include-not-found') {
    const localPath = extractLocalIncludePath(splitDocumentLines(text)[finding.range.line] ?? '');
    if (localPath) extra.reference = reference(localPath);
  }
  const edits = suggestedEdits(finding, extra);
  return {
    code: finding.code,
    severity: finding.severity,
    message: MESSAGES[finding.code] ?? 'See the code and details.',
    file: cleanPath(finding.file),
    range: finding.range,
    ...extra,
    ...(edits.length > 0 ? { suggestedEdits: edits } : {}),
  };
}
