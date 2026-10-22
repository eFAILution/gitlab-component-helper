// @mocha
/**
 * MCP stability fixes: version lookups that fail are reported (and memoized), the explicit version tool runs even
 * when the setting is off, deterministic and bounded directory walks, documented edit coordinates, the transport's
 * oversized-line log, and the VS Code launch plan.
 */

import * as assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpWorkspace } from '../../src/mcp/adapters/workspace';
import { createTools } from '../../src/mcp/tools';
import { collectCiFiles } from '../../src/mcp/tools/ciFiles';
import { ToolError, type Tool } from '../../src/mcp/server';
import type { ComponentServices } from '../../src/mcp/tools/getComponentSpec';
import { createStreamTransport, MAX_LINE_BYTES } from '../../src/mcp/transport/stdio';
import { definitionVersion, serverLaunchPlan } from '../../src/mcp/launchConfig';
import { installFakeRuntime, restoreRuntime } from './support/fakeRuntime';

const noRepo = { remoteContext: async () => ({}), nonGitLabRemote: async () => null };

function toolsWith(root: string, services: ComponentServices): Record<string, Tool> {
  const context = { workspace: createMcpWorkspace([root]), repoContext: noRepo, isHostAllowed: () => true, services };
  return Object.fromEntries(createTools(context).map((tool) => [tool.definition.name, tool]));
}

const spec = { name: 'deploy', description: 'd', parameters: [] };

suite('MCP version lookups', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gch-stab-')));
  writeFileSync(join(root, '.gitlab-ci.yml'), [
    'include:',
    '  - component: gitlab.com/group/ok/deploy@1.0.0',
    '  - component: gitlab.com/group/ok/deploy@1.0.0',
    '  - component: gitlab.com/group/down/deploy@1.0.0',
    '  - component: gitlab.com/group/down/deploy@1.0.0',
    '',
  ].join('\n'));
  suiteTeardown(() => rmSync(root, { recursive: true, force: true }));
  teardown(restoreRuntime);

  function servicesCounting(calls: string[]): ComponentServices {
    return {
      fetchComponent: async () => spec,
      fetchVersions: async (ref) => {
        calls.push(ref.baseUrl);
        if (ref.sourcePath.includes('down')) throw new ToolError('Fetching versions failed (HTTP 503).');
        return ['1.0.0', '2.0.0'];
      },
    };
  }

  test('failed lookups are reported in the summary and each base is fetched once', async () => {
    const calls: string[] = [];
    const { data, summary } = await toolsWith(root, servicesCounting(calls)).validate_ci_file.run({ checks: ['versions'] });

    assert.deepStrictEqual(calls.sort(), ['https://gitlab.com/group/down/deploy', 'https://gitlab.com/group/ok/deploy']);
    assert.deepStrictEqual((data.summary as Record<string, unknown>).versionLookupFailed, ['https://gitlab.com/group/down/deploy']);
    assert.match(String(summary), /could not be checked/);
  });

  test('check_component_versions runs even when versionCheck.enabled is off; validate_ci_file says it is off', async () => {
    installFakeRuntime({ 'versionCheck.enabled': false });
    const tools = toolsWith(root, servicesCounting([]));

    const explicit = await tools.check_component_versions.run({});
    assert.ok((explicit.data.findings as unknown[]).length > 0);

    const validate = await tools.validate_ci_file.run({});
    assert.equal((validate.data.summary as Record<string, unknown>).versionCheckDisabled, true);
    assert.equal((validate.data.findings as Array<{ code: string }>).some((finding) => finding.code === 'outdated-component-version'), false);
  });

  test('get_component_spec still returns the inputs when only the versions fail', async () => {
    const services: ComponentServices = {
      fetchComponent: async () => spec,
      fetchVersions: async () => {
        throw new ToolError('Fetching versions failed (HTTP 503).');
      },
    };
    const { data } = await toolsWith(root, services).get_component_spec.run({ component: 'gitlab.com/group/ok/deploy@1.0.0' });

    assert.deepStrictEqual(data.availableVersions, []);
    assert.match(String(data.versionsNote), /could not be listed/);
  });

  test('list_component_versions surfaces the failure as a tool error', async () => {
    await assert.rejects(toolsWith(root, servicesCounting([])).list_component_versions.run({ component: 'gitlab.com/group/down/deploy' }), ToolError);
  });
});

suite('MCP directory walk', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gch-walk-')));
  for (const dir of ['b', 'a', '.venv/x', 'dist', 'vendor/y', '.terraform', 'coverage', 'target', 'build', 'out', '.next', 'venv']) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, '.gitlab-ci.yml'), 'include: []\n');
  }
  suiteTeardown(() => rmSync(root, { recursive: true, force: true }));

  test('skips build, vendor, and environment directories, in a sorted order', async () => {
    const { files } = await collectCiFiles(createMcpWorkspace([root]));
    assert.deepStrictEqual(files, [join(root, 'a', '.gitlab-ci.yml'), join(root, 'b', '.gitlab-ci.yml')]);
  });

  test('stops after a capped number of directories', async () => {
    const { files, truncated } = await collectCiFiles(createMcpWorkspace([root]), undefined, { maxDirectories: 2 });
    assert.equal(truncated, true);
    assert.deepStrictEqual(files, [join(root, 'a', '.gitlab-ci.yml')]);
  });
});

suite('MCP tool contracts', () => {
  test('validate_ci_file and check_component_versions document edit coordinates and type them in the schema', () => {
    const tools = toolsWith(tmpdir(), { fetchComponent: async () => null, fetchVersions: async () => [] });
    for (const name of ['validate_ci_file', 'check_component_versions']) {
      const { description, outputSchema } = tools[name].definition;
      assert.match(description, /0-based line; startCol\/endCol are 0-based UTF-16 offsets; replace that range with newText/, name);
      const finding = outputSchema?.properties?.findings?.items;
      assert.deepStrictEqual(finding?.properties?.range?.required, ['line', 'startCol', 'endCol'], name);
      assert.deepStrictEqual(finding?.properties?.suggestedEdits?.items?.required, ['file', 'range', 'newText', 'title'], name);
    }
  });

  test('an oversized line is logged to stderr before the transport closes', async () => {
    const fake = installFakeRuntime();
    const input = new PassThrough();
    const transport = createStreamTransport(input, new PassThrough());
    const closed = new Promise<void>((resolve) => transport.onClose(resolve));
    input.write('x'.repeat(MAX_LINE_BYTES + 1));
    await closed;

    assert.ok(fake.lines.some((line) => /longer than/.test(line)), fake.lines.join('\n'));
    restoreRuntime();
  });
});

suite('MCP launch plan', () => {
  test('no workspace folder means no server; otherwise cwd is the first folder', () => {
    assert.equal(serverLaunchPlan([], true), null);
    assert.equal(serverLaunchPlan(['/a'], false), null);
    assert.deepStrictEqual(serverLaunchPlan(['/a', '/b'], true), { cwd: '/a', roots: ['/a', '/b'] });
  });

  test('the definition version carries a token revision so VS Code restarts the server', () => {
    assert.equal(definitionVersion('0.21.5', 0), '0.21.5+0');
    assert.equal(definitionVersion('0.21.5', 3), '0.21.5+3');
  });
});
