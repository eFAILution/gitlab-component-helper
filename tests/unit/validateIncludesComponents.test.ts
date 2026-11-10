// @mocha
/**
 * Pins the component-include findings. Messages, codes, severities, ranges, and metadata are copied from
 * what `ValidationProvider` has always published.
 */

import * as assert from 'node:assert/strict';
import { NetworkError } from '../../src/errors';
import { validateIncludes, type ComponentLookupPort } from '../../src/core/validation/validateIncludes';
import type { UnresolvedReason } from '../../src/core/references';
import type { ComponentParameter } from '../../src/types/git-component';
import { resolverFor } from './support/fakeResolver';

const FILE = '/repo/.gitlab-ci.yml';
const UNAUTHORIZED = 401;

const DEPLOY_INPUTS: ComponentParameter[] = [
  { name: 'stage', description: 'Stage', required: false, type: 'string', default: 'test' },
  { name: 'env', description: 'Target environment', required: true, type: 'string' },
];

const TEXT = [
  'include:',
  '  - component: gitlab.com/group/proj/deploy@1.0.0',
  '    inputs:',
  '      stage: test',
  '      bogus: x',
  '  - component: $CI_SERVER_FQDN/group/proj/build@1.0.0',
  '  - component: gitlab.com/group/proj/missing@1.0.0',
  '  - component: gitlab.com/group/private/secret@1.0.0',
  '',
].join('\n');

const components: ComponentLookupPort = {
  findCached: async (url) =>
    url === 'https://gitlab.com/group/proj/deploy@1.0.0' ? { name: 'deploy', parameters: DEPLOY_INPUTS } : null,
  fetch: async (url) => {
    if (url.includes('/private/')) throw new NetworkError('HTTP 401', { statusCode: UNAUTHORIZED });
    return null;
  },
};

function validate(text: string, reason: UnresolvedReason = { kind: 'no-context' }) {
  return validateIncludes({
    text,
    file: FILE,
    resolveReference: resolverFor(reason),
    components,
    resolveLocalInclude: async () => ({ kind: 'skipped' }),
  });
}

suite('validateIncludes: component includes', () => {
  test('reports unknown and missing inputs, unresolved variables, and fetch and auth failures', async () => {
    assert.deepStrictEqual(await validate(TEXT), [
      {
        code: 'unknown-input',
        severity: 'warning',
        message: "Unknown input 'bogus' for component 'deploy'.",
        file: FILE,
        range: { line: 4, startCol: 6, endCol: 11 },
        metadata: {
          code: 'unknown-input',
          componentName: 'deploy',
          componentUrl: 'gitlab.com/group/proj/deploy@1.0.0',
          unknownInput: 'bogus',
          availableInputs: ['stage', 'env'],
          componentInputs: DEPLOY_INPUTS,
          currentInputOnly: true,
        },
      },
      {
        code: 'missing-required-input',
        severity: 'error',
        message: "Missing required input 'env' for component 'deploy'.",
        file: FILE,
        range: { line: 1, startCol: 0, endCol: 49 },
        metadata: {
          code: 'missing-required-input',
          componentName: 'deploy',
          componentUrl: 'gitlab.com/group/proj/deploy@1.0.0',
          missingInput: 'env',
          inputDescription: 'Target environment',
          inputType: 'string',
          inputDefault: undefined,
          providedInputs: ['stage', 'bogus'],
        },
      },
      {
        code: 'unresolved-variables',
        severity: 'information',
        message: "Component URL contains unresolved GitLab variables: '$CI_SERVER_FQDN/group/proj/build@1.0.0'. Configure component sources in settings to resolve these variables.",
        file: FILE,
        range: { line: 5, startCol: 0, endCol: 53 },
        metadata: {
          code: 'unresolved-variables',
          componentUrl: '$CI_SERVER_FQDN/group/proj/build@1.0.0',
          expandedUrl: '$CI_SERVER_FQDN/group/proj/build@1.0.0',
          includeInputs: {},
          isNonGitlabRepo: false,
        },
      },
      {
        code: 'component-fetch-failed',
        severity: 'warning',
        message: "Unable to fetch component 'gitlab.com/group/proj/missing@1.0.0'. Component may not exist, be inaccessible, or the URL may be incorrect.",
        file: FILE,
        range: { line: 6, startCol: 0, endCol: 50 },
        metadata: {
          code: 'component-fetch-failed',
          componentUrl: 'gitlab.com/group/proj/missing@1.0.0',
          expandedUrl: 'https://gitlab.com/group/proj/missing@1.0.0',
          includeInputs: {},
        },
      },
      {
        code: 'component-auth-failed',
        severity: 'warning',
        message: "GitLab token for 'gitlab.com/group/private/secret@1.0.0' is missing, invalid, or expired. Update it to validate this component.",
        file: FILE,
        range: { line: 7, startCol: 0, endCol: 52 },
        metadata: {
          code: 'component-auth-failed',
          componentUrl: 'gitlab.com/group/private/secret@1.0.0',
          expandedUrl: 'https://gitlab.com/group/private/secret@1.0.0',
          includeInputs: {},
        },
      },
    ]);
  });

  test('explains unresolved variables in a non-GitLab repository', async () => {
    const findings = await validate(TEXT, { kind: 'non-gitlab-repo', hostname: 'github.com', type: 'GitHub' });
    const unresolved = findings.find((finding) => finding.code === 'unresolved-variables');

    assert.equal(
      unresolved?.message,
      "Component URL contains unresolved GitLab variables: '$CI_SERVER_FQDN/group/proj/build@1.0.0'. This project is hosted on github.com, not GitLab. GitLab Component Helper requires a GitLab repository to resolve CI/CD variables like $CI_SERVER_FQDN and $CI_PROJECT_PATH.",
    );
    assert.equal(unresolved?.metadata && 'isNonGitlabRepo' in unresolved.metadata && unresolved.metadata.isNonGitlabRepo, true);
  });

  test('an incomplete expansion records the partly expanded URL', async () => {
    const findings = await validate(TEXT, { kind: 'incomplete', expandedUrl: 'https://gitlab.com/$X/build@1.0.0' });
    const unresolved = findings.find((finding) => finding.code === 'unresolved-variables');

    assert.equal(unresolved?.metadata && 'expandedUrl' in unresolved.metadata && unresolved.metadata.expandedUrl, 'https://gitlab.com/$X/build@1.0.0');
  });

  test('skips input checks when an input key looks like mid-edit typing', async () => {
    const text = ['include:', '  - component: gitlab.com/group/proj/deploy@1.0.0', '    inputs:', '      ab: x', ''].join('\n');

    assert.deepStrictEqual(await validate(text), []);
  });
});
