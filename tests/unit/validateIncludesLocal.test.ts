// @mocha
/**
 * Pins the local-include findings the validator produces for the extension-host fixtures. Messages, codes,
 * severities, ranges, and metadata are copied from what `ValidationProvider` has always published, so these tests
 * fail if the lift into `src/core/validation` changes any of them.
 */

import * as assert from 'node:assert/strict';
import { validateIncludes } from '../../src/core/validation/validateIncludes';
import type { Finding } from '../../src/core/validation/findings';
import { localParam, readFixture, resolveFixtureLocalInclude } from './support/fixtureIncludes';

const noComponents = {
  findCached: async () => null,
  fetch: async () => {
    throw new Error('component lookup not expected for local includes');
  },
};

async function validateFixture(name: string, transform: (text: string) => string = (t) => t): Promise<Finding[]> {
  const { file, text } = await readFixture(name);
  return validateIncludes({
    text: transform(text),
    file,
    resolveReference: async () => {
      throw new Error('reference resolution not expected for local includes');
    },
    components: noComponents,
    resolveLocalInclude: resolveFixtureLocalInclude,
  });
}

const NX_TEST_INPUTS = [
  localParam('job_name', 'The name of the CI job', 'string'),
  localParam('runner_tag', 'The runner tag the job should target (no default — required)', 'string'),
  localParam('job_type', 'The type of the job to test', 'string', 'affected'),
  localParam('git_depth', 'The git fetch depth (0 for full clone)', 'number', 1),
];

const DEPLOY_INPUTS = [
  localParam('job_name', 'The name of the CI job', 'string'),
  localParam('cluster', 'The target cluster (no default — required)', 'string'),
  localParam('region', 'The deployment region', 'string', 'eu-west-1'),
];

suite('validateIncludes: local includes over tests/fixtures', () => {
  test('local-include: unknown input, missing required input, and a missing file', async () => {
    const { file } = await readFixture('local-include');
    const localPath = 'local-include/templates/nx-test.yml';

    assert.deepStrictEqual(await validateFixture('local-include'), [
      {
        code: 'unknown-input',
        severity: 'warning',
        message: "Unknown input 'bogus_input' for local include 'nx-test.yml'.",
        file,
        range: { line: 5, startCol: 6, endCol: 17 },
        metadata: {
          componentName: 'nx-test.yml',
          componentUrl: localPath,
          unknownInput: 'bogus_input',
          availableInputs: ['job_name', 'runner_tag', 'job_type', 'git_depth'],
          componentInputs: NX_TEST_INPUTS,
          currentInputOnly: true,
        },
      },
      {
        code: 'missing-required-input',
        severity: 'error',
        message: "Missing required input 'runner_tag' for local include 'nx-test.yml'.",
        file,
        range: { line: 1, startCol: 0, endCol: 48 },
        metadata: {
          componentName: 'nx-test.yml',
          componentUrl: localPath,
          missingInput: 'runner_tag',
          inputDescription: 'The runner tag the job should target (no default — required)',
          inputType: 'string',
          inputDefault: undefined,
          providedInputs: ['job_name', 'job_type', 'bogus_input'],
        },
      },
      {
        code: 'local-include-not-found',
        severity: 'warning',
        message: "Unable to resolve local include 'local-include/missing-template.yml'. File not found or unreadable.",
        file,
        range: { line: 9, startCol: 0, endCol: 47 },
      },
    ]);
  });

  test('local-include with CRLF line endings: same lines, columns exclude the \\r', async () => {
    const lf = await validateFixture('local-include');
    const crlf = await validateFixture('local-include', (text) => text.replace(/\n/g, '\r\n'));

    assert.deepStrictEqual(crlf, lf);
  });

  test('duplicate-include: findings anchor to the second include of the same template', async () => {
    const findings = await validateFixture('duplicate-include');

    assert.deepStrictEqual(
      findings.map(({ code, severity, message, range }) => ({ code, severity, message, range })),
      [
        {
          code: 'unknown-input',
          severity: 'warning',
          message: "Unknown input 'target_cluster' for local include 'deploy.yml'.",
          range: { line: 12, startCol: 6, endCol: 20 },
        },
        {
          code: 'missing-required-input',
          severity: 'error',
          message: "Missing required input 'cluster' for local include 'deploy.yml'.",
          range: { line: 9, startCol: 0, endCol: 51 },
        },
      ],
    );
    assert.deepStrictEqual(findings[0].metadata, {
      componentName: 'deploy.yml',
      componentUrl: 'duplicate-include/templates/deploy.yml',
      unknownInput: 'target_cluster',
      availableInputs: ['job_name', 'cluster', 'region'],
      componentInputs: DEPLOY_INPUTS,
      currentInputOnly: true,
    });
  });

  test('flow-inputs: a flow-style unknown input anchors to the include line, not the job below', async () => {
    const findings = await validateFixture('flow-inputs');

    assert.deepStrictEqual(
      findings.map(({ code, message, range }) => ({ code, message, range })),
      [{
        code: 'unknown-input',
        message: "Unknown input 'bad_input' for local include 'deploy.yml'.",
        range: { line: 3, startCol: 0, endCol: 45 },
      }],
    );
  });

  test('merge-key: inputs merged through `<<` carry their defaults, so only the unknown input is reported', async () => {
    const findings = await validateFixture('merge-key');

    assert.deepStrictEqual(
      findings.map(({ code, message, range }) => ({ code, message, range })),
      [{
        code: 'unknown-input',
        message: "Unknown input 'bogus_input' for local include 'deploy.yml'.",
        range: { line: 6, startCol: 6, endCol: 17 },
      }],
    );
    assert.deepStrictEqual(
      findings[0].metadata && 'availableInputs' in findings[0].metadata && findings[0].metadata.availableInputs,
      ['stage', 'region', 'job_name'],
    );
  });

  test('revalidate-on-edit: every input known and provided, so no findings', async () => {
    assert.deepStrictEqual(await validateFixture('revalidate-on-edit'), []);
  });

  test('enum-options: an input given with an empty value still counts as provided', async () => {
    assert.deepStrictEqual(await validateFixture('enum-options'), []);
  });

  test('a document without include gets no findings', async () => {
    const findings = await validateIncludes({
      text: 'stages:\n  - build\n',
      file: '/repo/.gitlab-ci.yml',
      resolveReference: async () => ({ resolved: false, reason: { kind: 'no-context' } }),
      components: noComponents,
      resolveLocalInclude: resolveFixtureLocalInclude,
    });
    assert.deepStrictEqual(findings, []);
  });
});
