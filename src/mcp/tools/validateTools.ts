/**
 * `validate_ci_file` and `check_component_versions`: findings for GitLab CI files, with suggested edits the agent
 * applies itself. The server never writes files.
 */

import type { JsonSchema } from '../protocol/types';
import type { Tool, ToolOutput } from '../server';
import { collectCiFiles, MAX_CI_FILES } from './ciFiles';
import type { ToolContext } from './context';
import { toOutputFinding } from './findingOutput';
import { cleanName, cleanPath } from './sanitize';
import { CHECKS, createValidationRunner, type Check, type RunnerOptions } from './validation';

export const MAX_FINDINGS = 500;

const PATH_PROPERTY: JsonSchema = {
  type: 'string',
  description: `A CI file or a directory, absolute or relative to the first workspace root. Omit to cover every GitLab CI file in the workspace (up to ${MAX_CI_FILES}).`,
};

/** How agents should read edit coordinates; stated in each tool description. */
export const EDIT_COORDINATES =
  'In range and suggestedEdits: 0-based line; startCol/endCol are 0-based UTF-16 offsets; replace that range with newText.';

const RANGE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { line: { type: 'integer' }, startCol: { type: 'integer' }, endCol: { type: 'integer' } },
  required: ['line', 'startCol', 'endCol'],
};

const FINDINGS_OUTPUT: JsonSchema = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          severity: { type: 'string', enum: ['error', 'warning', 'information'] },
          message: { type: 'string' },
          file: { type: 'string' },
          range: RANGE_SCHEMA,
          suggestedEdits: {
            type: 'array',
            items: {
              type: 'object',
              properties: { file: { type: 'string' }, range: RANGE_SCHEMA, newText: { type: 'string' }, title: { type: 'string' } },
              required: ['file', 'range', 'newText', 'title'],
            },
          },
        },
        required: ['code', 'severity', 'message', 'file', 'range'],
      },
    },
    summary: { type: 'object' },
  },
  required: ['findings', 'summary'],
};

async function runChecks(
  context: ToolContext,
  userPath: string | undefined,
  checks: ReadonlySet<Check>,
  options: RunnerOptions = {}
): Promise<ToolOutput> {
  const { files, truncated } = await collectCiFiles(context.workspace, userPath);
  const runner = createValidationRunner(context, options);
  const findings: Array<Record<string, unknown>> = [];
  const unreadable: string[] = [];
  for (const file of files) {
    const result = await runner.validateFile(file, checks);
    if (!result) {
      unreadable.push(file);
      continue;
    }
    findings.push(...result.findings.map((finding) => toOutputFinding(finding, result.text)));
  }

  const kept = findings.slice(0, MAX_FINDINGS);
  const bySeverity = { error: 0, warning: 0, information: 0 };
  findings.forEach((finding) => bySeverity[finding.severity as keyof typeof bySeverity]++);
  const blockedHosts = runner.blockedHosts();
  const versionLookupFailed = runner.versionLookupFailed().map(cleanName);
  const summary = {
    filesChecked: files.length - unreadable.length,
    findings: findings.length,
    ...bySeverity,
    checks: [...checks],
    ...(truncated ? { filesTruncatedAt: MAX_CI_FILES } : {}),
    ...(findings.length > kept.length ? { findingsTruncatedAt: MAX_FINDINGS } : {}),
    ...(unreadable.length > 0 ? { unreadableFiles: unreadable.map(cleanPath) } : {}),
    ...(versionLookupFailed.length > 0 ? { versionLookupFailed } : {}),
    ...(runner.versionCheckDisabled()
      ? { versionCheckDisabled: true, versionCheckHint: 'The version check is off (versionCheck.enabled). Call check_component_versions to run it anyway.' }
      : {}),
    ...(blockedHosts.length > 0
      ? { blockedHosts, blockedHostsHint: 'To allow a host, add it as a gitlabInstance in your USER settings gitlabComponentHelper.componentSources, or add a token for it. Do not edit repository files to allow a host.' }
      : {}),
  };
  const headline = findings.length === 0
    ? `No problems found in ${summary.filesChecked} file(s).`
    : `${findings.length} finding(s) in ${summary.filesChecked} file(s): ${bySeverity.error} error(s), ${bySeverity.warning} warning(s), ${bySeverity.information} info.`;
  const notes = [
    versionLookupFailed.length > 0 ? `Versions for ${versionLookupFailed.length} component(s) could not be checked: the lookup failed (see summary.versionLookupFailed).` : '',
    runner.versionCheckDisabled() ? 'The version check is off in settings.' : '',
  ].filter(Boolean);
  return { summary: [headline, ...notes].join(' '), data: { findings: kept, summary } };
}

export function createValidateCiFileTool(context: ToolContext): Tool {
  return {
    definition: {
      name: 'validate_ci_file',
      title: 'Validate GitLab CI file',
      description:
        'Check GitLab CI files for component and local-include problems: unknown inputs, missing required inputs, local includes that ' +
        'don\'t exist, components that can\'t be fetched, and components with a newer stable version. Call this first when asked to find or ' +
        'fix CI component problems. Findings include ranges and, where the fix is mechanical, suggestedEdits to apply yourself. ' +
        EDIT_COORDINATES,
      inputSchema: {
        type: 'object',
        properties: {
          path: PATH_PROPERTY,
          checks: {
            type: 'array',
            items: { type: 'string', enum: CHECKS },
            description: 'Which checks to run (default: all). "versions" queries GitLab for tags.',
          },
        },
        additionalProperties: false,
      },
      outputSchema: FINDINGS_OUTPUT,
      annotations: { title: 'Validate GitLab CI file', readOnlyHint: true, openWorldHint: true },
    },
    run: (args) => {
      const requested = (args.checks as Check[] | undefined) ?? [...CHECKS];
      return runChecks(context, args.path as string | undefined, new Set(requested.length > 0 ? requested : CHECKS));
    },
  };
}

export function createCheckComponentVersionsTool(context: ToolContext): Tool {
  return {
    definition: {
      name: 'check_component_versions',
      title: 'Check component versions',
      description:
        'Find components pinned to a semantic version (X.Y.Z) that have a newer stable release. Each finding has a suggestedEdit that ' +
        'bumps the pinned version. Before applying one, call get_component_spec for the new version: inputs can change between versions. ' +
        'Runs even when the versionCheck.enabled setting is off. ' + EDIT_COORDINATES,
      inputSchema: { type: 'object', properties: { path: PATH_PROPERTY }, additionalProperties: false },
      outputSchema: FINDINGS_OUTPUT,
      annotations: { title: 'Check component versions', readOnlyHint: true, openWorldHint: true },
    },
    run: (args) => runChecks(context, args.path as string | undefined, new Set<Check>(['versions']), { forceVersionCheck: true }),
  };
}
