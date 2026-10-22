// @mocha
/**
 * The MCP validation tools over tests/fixtures and a temporary workspace, with fake component services in place of
 * GitLab: findings and their safe output shape, suggested edits, the host allowlist, and path guards.
 */

import * as assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpWorkspace } from '../../src/mcp/adapters/workspace';
import { createTools } from '../../src/mcp/tools';
import type { ToolContext } from '../../src/mcp/tools/context';
import type { ComponentServices } from '../../src/mcp/tools/getComponentSpec';
import { GitLabAuthToolError } from '../../src/mcp/services';
import { ToolError, type Tool } from '../../src/mcp/server';
import { FIXTURES_ROOT } from './support/fixtureIncludes';

const services: ComponentServices = {
  fetchComponent: async (ref) => {
    if (ref.sourcePath.includes('private')) throw new GitLabAuthToolError('refused');
    if (ref.name !== 'deploy') return null;
    return {
      name: 'deploy',
      description: 'Deploys',
      parameters: [
        { name: 'stage', description: 'The stage\u0007', required: false, type: 'string', default: 'deploy' },
        { name: 'environment', description: 'Where to deploy', required: true, type: 'string' },
      ],
    };
  },
  fetchVersions: async () => ['main', '1.0.0', '1.4.0'],
};

const noRepo = { remoteContext: async () => ({}), nonGitLabRemote: async () => null };

function toolsFor(roots: string[]): Record<string, Tool> {
  const context: ToolContext = {
    workspace: createMcpWorkspace(roots),
    repoContext: noRepo,
    isHostAllowed: (host) => host !== 'evil.example',
    services,
  };
  return Object.fromEntries(createTools(context).map((tool) => [tool.definition.name, tool]));
}

const CI_FILE = [
  'x: &a [secret-value]',
  'include:',
  '  - component: gitlab.com/group/proj/deploy@1.0.0',
  '    inputs:',
  '      stgae: build',
  '      bomb: *a',
  '  - component: evil.example/group/proj/deploy@1.0.0',
  '  - component: gitlab.com/group/private/deploy@1.0.0',
  '',
].join('\n');

suite('MCP validation tools', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'gch-tools-')));
  const root = join(base, 'repo');
  mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(join(root, '.gitlab-ci.yml'), CI_FILE);
  writeFileSync(join(root, 'node_modules', 'pkg', '.gitlab-ci.yml'), 'include:\n  - local: nope.yml\n');
  const tools = toolsFor([root]);
  const file = join(root, '.gitlab-ci.yml');

  suiteTeardown(() => rmSync(base, { recursive: true, force: true }));

  test('validate_ci_file reports inputs, fetch and auth failures, blocked hosts, and versions with suggested edits', async () => {
    const { data } = await tools.validate_ci_file.run({});
    const findings = data.findings as Array<Record<string, unknown>>;

    assert.deepStrictEqual(findings.map((finding) => finding.code), [
      'unknown-input',
      'unknown-input',
      'missing-required-input',
      'component-fetch-failed',
      'component-auth-failed',
      'outdated-component-version',
      'outdated-component-version',
    ]);
    assert.deepStrictEqual(findings[0], {
      code: 'unknown-input',
      severity: 'warning',
      message: 'The include passes an input that the component (or local template) does not declare.',
      file,
      range: { line: 4, startCol: 6, endCol: 11 },
      component: 'deploy',
      reference: 'gitlab.com/group/proj/deploy@1.0.0',
      input: 'stgae',
      availableInputs: ['stage', 'environment'],
      suggestedEdits: [{ file, range: { line: 4, startCol: 6, endCol: 11 }, newText: 'stage', title: 'Rename input stgae to stage' }],
    });
    assert.equal(findings[1].suggestedEdits, undefined, 'no rename for an input with no near match');
    assert.equal(findings[2].description, 'Where to deploy');
    assert.deepStrictEqual(findings[5].suggestedEdits, [
      { file, range: { line: 2, startCol: 44, endCol: 49 }, newText: '1.4.0', title: 'Update to 1.4.0' },
    ]);
    assert.deepStrictEqual((data.summary as Record<string, unknown>).blockedHosts, ['evil.example']);
    assert.equal((data.summary as Record<string, unknown>).filesChecked, 1, 'node_modules is skipped');
  });

  test('provided input values never appear in the output', async () => {
    const { data } = await tools.validate_ci_file.run({ path: '.gitlab-ci.yml' });

    assert.doesNotMatch(JSON.stringify(data), /secret-value|includeInputs/);
  });

  test('checks limits which findings come back', async () => {
    const { data } = await tools.validate_ci_file.run({ path: '.gitlab-ci.yml', checks: ['versions'] });

    assert.ok((data.findings as Array<{ code: string }>).every((finding) => finding.code === 'outdated-component-version'));
  });

  test('check_component_versions returns only version findings', async () => {
    const { data } = await tools.check_component_versions.run({});

    assert.deepStrictEqual((data.findings as Array<{ code: string }>).map((finding) => finding.code), ['outdated-component-version', 'outdated-component-version']);
  });

  test('a path outside the roots and a missing path get the same tool error', async () => {
    const outside = await tools.validate_ci_file.run({ path: '../../etc/passwd' }).catch((error) => error);
    const missing = await tools.validate_ci_file.run({ path: 'missing.yml' }).catch((error) => error);

    assert.ok(outside instanceof ToolError && missing instanceof ToolError);
    assert.equal(outside.message.replace('../../etc/passwd', 'X'), missing.message.replace('missing.yml', 'X'));
  });

  test('list_component_usages lists includes with lines and input names only', async () => {
    const { data } = await tools.list_component_usages.run({});
    const [entry] = data.files as Array<{ file: string; usages: Array<Record<string, unknown>> }>;

    assert.equal(entry.file, file);
    assert.deepStrictEqual(entry.usages[0], {
      kind: 'component',
      reference: 'gitlab.com/group/proj/deploy@1.0.0',
      version: '1.0.0',
      url: 'https://gitlab.com/group/proj/deploy@1.0.0',
      line: 2,
      inputs: ['stgae', 'bomb'],
    });
  });

  test('list_component_versions returns versions and the latest stable one', async () => {
    const { data } = await tools.list_component_versions.run({ component: 'gitlab.com/group/proj/deploy' });

    assert.deepStrictEqual(data, { component: 'https://gitlab.com/group/proj/deploy', versions: ['main', '1.0.0', '1.4.0'], latestStable: '1.4.0' });
  });
});

suite('MCP validation tools over tests/fixtures', () => {
  const tools = toolsFor([FIXTURES_ROOT]);

  test('validate_ci_file on the local-include fixture', async () => {
    const { data } = await tools.validate_ci_file.run({ path: 'local-include/.gitlab-ci.yml' });
    const findings = data.findings as Array<Record<string, unknown>>;

    assert.deepStrictEqual(findings.map(({ code, range, input, reference }) => ({ code, line: (range as { line: number }).line, input, reference })), [
      { code: 'unknown-input', line: 5, input: 'bogus_input', reference: 'local-include/templates/nx-test.yml' },
      { code: 'missing-required-input', line: 1, input: 'runner_tag', reference: 'local-include/templates/nx-test.yml' },
      { code: 'local-include-not-found', line: 9, input: undefined, reference: 'local-include/missing-template.yml' },
    ]);
  });

  test('validate_ci_file over every fixture finds files under .gitlab-ci.yml names only', async () => {
    const { data } = await tools.validate_ci_file.run({ checks: ['local-includes'] });
    const summary = data.summary as Record<string, number>;

    assert.ok(summary.filesChecked >= 6, `checked ${summary.filesChecked}`);
    assert.ok(summary.findings > 0);
  });

  test('running every tool over the fixtures writes nothing to process.stdout', async () => {
    const original = process.stdout.write;
    const stray: unknown[] = [];
    process.stdout.write = ((chunk: unknown) => {
      stray.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      await tools.validate_ci_file.run({});
      await tools.list_component_usages.run({});
      await tools.get_component_spec.run({ component: 'gitlab.com/group/proj/deploy@1.0.0' });
    } finally {
      process.stdout.write = original;
    }
    assert.deepStrictEqual(stray, []);
  });
});
