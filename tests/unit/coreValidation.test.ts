// @mocha
/**
 * Done check for the validation core: everything under `src/core` loads under plain Node (this suite runs without a
 * `vscode` module), and the core validator reproduces the extension's findings for the local-include and
 * enum-options fixtures through a filesystem workspace port and a fake component lookup.
 */

import * as assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { validateIncludes } from '../../src/core/validation/validateIncludes';
import { resolveLocalIncludeOutcome } from '../../src/core/localInclude';
import { fixtureWorkspace, readFixture } from './support/fixtureIncludes';

const CORE_DIR = resolve(__dirname, '../../src/core');
const requireModule = createRequire(__filename);

function listModules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return listModules(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

async function validateFixture(name: string) {
  const { file, text } = await readFixture(name);
  const lookups: string[] = [];
  const findings = await validateIncludes({
    text,
    file,
    resolveReference: async (reference) => ({ resolved: true, url: `https://${reference}` }),
    components: {
      findCached: async (url) => {
        lookups.push(url);
        return null;
      },
      fetch: async (url) => {
        lookups.push(url);
        return null;
      },
    },
    resolveLocalInclude: (localPath) => resolveLocalIncludeOutcome(localPath, file, fixtureWorkspace),
  });
  return { findings, lookups };
}

suite('validation core done check', () => {
  test('every src/core module loads without vscode', () => {
    const modules = listModules(CORE_DIR);
    assert.ok(modules.length > 0);
    for (const modulePath of modules) {
      assert.doesNotThrow(() => requireModule(modulePath), `${modulePath} should load under plain Node`);
    }
  });

  test('local-include fixture: the three findings the extension reports', async () => {
    const { findings, lookups } = await validateFixture('local-include');

    assert.deepStrictEqual(
      findings.map(({ code, severity, range, message }) => ({ code, severity, line: range.line, message })),
      [
        { code: 'unknown-input', severity: 'warning', line: 5, message: "Unknown input 'bogus_input' for local include 'nx-test.yml'." },
        { code: 'missing-required-input', severity: 'error', line: 1, message: "Missing required input 'runner_tag' for local include 'nx-test.yml'." },
        { code: 'local-include-not-found', severity: 'warning', line: 9, message: "Unable to resolve local include 'local-include/missing-template.yml'. File not found or unreadable." },
      ],
    );
    assert.deepStrictEqual(lookups, [], 'local includes never hit the component lookup');
  });

  test('enum-options fixture: no findings', async () => {
    const { findings, lookups } = await validateFixture('enum-options');

    assert.deepStrictEqual(findings, []);
    assert.deepStrictEqual(lookups, []);
  });
});
