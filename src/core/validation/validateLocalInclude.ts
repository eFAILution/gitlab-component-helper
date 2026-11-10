/**
 * Validation of `include: - local:` entries, plus the unknown-input range logic it shares with component includes.
 */

import { Logger } from '../../utils/logger';
import { isUnsupportedLocalPath } from '../../providers/localIncludeParser';
import type { LocalInclude } from '../../utils/includeMatcher';
import type { ComponentParameter } from '../../types/git-component';
import { wholeLineRange, type FindingRange } from './findings';
import { findLineForComponent, findLineForInput } from './includeLines';
import type { ValidationPass } from './validateIncludes';

const logger = Logger.getInstance();

/**
 * Place an unknown-input finding: on the input's own line, covering only the input name when it can be found there,
 * else the whole line. Returns `null` (and records nothing) when the same input was already reported on that line.
 *
 * @param dedupScope The component URL or local path, so one input name can be reported once per include target.
 */
export function unknownInputRange(
  pass: ValidationPass,
  includeIndex: number,
  providedInput: string,
  dedupScope: string
): { range: FindingRange } | null {
  const line = findLineForInput(pass.input.text, pass.includes, includeIndex, providedInput);

  // Create a unique key to prevent duplicate diagnostics for the same input
  const key = `unknown-input-${line}-${providedInput}-${dedupScope}`;
  if (pass.findingKeys.has(key)) {
    logger.debug(`[ValidationProvider] Skipping duplicate diagnostic for input '${providedInput}' at line ${line}`, 'ValidationProvider');
    return null;
  }
  pass.findingKeys.add(key);

  // A precise range covers only the input name, not the entire line
  const lineText = pass.documentLines[line];
  const inputIndex = lineText.indexOf(`${providedInput}:`);
  if (inputIndex === -1) {
    // Fallback to entire line if we can't find the input
    return { range: wholeLineRange(pass.documentLines, line) };
  }
  return { range: { line, startCol: inputIndex, endCol: inputIndex + providedInput.length } };
}

/**
 * Validate a single `include: - local:` entry. Resolves the target file relative to the repository, parses its
 * `spec.inputs` block, and reports findings for unknown inputs, missing required inputs, and unresolvable file paths.
 * Returns silently when the resolved file has no `spec.inputs` (it's a plain include, not a parameterised template).
 * Never rejects — resolution or parse failures surface as warning findings, not exceptions.
 */
export async function validateLocalInclude(
  pass: ValidationPass,
  include: LocalInclude,
  includeIndex: number
): Promise<void> {
  const { input, includes, documentLines, findings } = pass;
  const localPath = include.local;
  logger.debug(`[ValidationProvider] Processing local include: ${localPath}`, 'ValidationProvider');

  if (isUnsupportedLocalPath(localPath)) {
    // Globs and `../` paths are intentionally not handled; skip without diagnostics.
    return;
  }

  const outcome = await input.resolveLocalInclude(localPath);
  if (outcome.kind === 'unreadable') {
    const line = findLineForComponent(input.text, includes, includeIndex);
    findings.push({
      code: 'local-include-not-found',
      severity: 'warning',
      message: `Unable to resolve local include '${localPath}'. File not found or unreadable.`,
      file: input.file,
      range: wholeLineRange(documentLines, line),
    });
    return;
  }

  // `skipped` (glob/`..`/no root) and `no-spec` (a valid plain include with no `spec:` block) both have no
  // inputs to validate — leave them alone rather than reporting a spurious not-found.
  if (outcome.kind !== 'component') {
    logger.debug(`[ValidationProvider] Local include not a parameterised template (${outcome.kind}), skipping: ${localPath}`, 'ValidationProvider');
    return;
  }
  const component = outcome.component;

  if (!component.parameters || component.parameters.length === 0) {
    logger.debug(`[ValidationProvider] Local include has no spec.inputs, skipping input validation: ${localPath}`, 'ValidationProvider');
    return;
  }

  const providedInputs: Record<string, unknown> = include.inputs || {};
  const componentInputs: ComponentParameter[] = component.parameters;

  for (const providedInput of Object.keys(providedInputs)) {
    if (componentInputs.some(p => p.name === providedInput)) {
      continue;
    }
    const placed = unknownInputRange(pass, includeIndex, providedInput, localPath);
    if (!placed) continue;

    findings.push({
      code: 'unknown-input',
      severity: 'warning',
      message: `Unknown input '${providedInput}' for local include '${component.name}'.`,
      file: input.file,
      range: placed.range,
      metadata: {
        componentName: component.name,
        componentUrl: localPath,
        unknownInput: providedInput,
        availableInputs: componentInputs.map(p => p.name),
        componentInputs,
        currentInputOnly: true,
      },
    });
  }

  for (const componentInput of componentInputs) {
    if (componentInput.required && !Object.prototype.hasOwnProperty.call(providedInputs, componentInput.name)) {
      const line = findLineForComponent(input.text, includes, includeIndex);
      findings.push({
        code: 'missing-required-input',
        severity: 'error',
        message: `Missing required input '${componentInput.name}' for local include '${component.name}'.`,
        file: input.file,
        range: wholeLineRange(documentLines, line),
        metadata: {
          componentName: component.name,
          componentUrl: localPath,
          missingInput: componentInput.name,
          inputDescription: componentInput.description,
          inputType: componentInput.type,
          inputDefault: componentInput.default,
          providedInputs: Object.keys(providedInputs),
        },
      });
    }
  }
}
