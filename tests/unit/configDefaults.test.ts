// @mocha
/**
 * `CONFIG_DEFAULTS` is what hosts without VS Code (unit tests, the MCP server) use for settings. It must match
 * package.json `contributes.configuration` exactly, or the two hosts would behave differently out of the box.
 */

import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DEFAULTS, CONFIG_SECTION } from '../../src/core/config/defaults';

interface ContributedSetting {
  default?: unknown;
}

function readContributedDefaults(): Record<string, unknown> {
  const manifest = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
  const properties: Record<string, ContributedSetting> = manifest.contributes.configuration.properties;
  const prefix = `${CONFIG_SECTION}.`;
  return Object.fromEntries(
    Object.entries(properties).map(([name, setting]) => [name.slice(prefix.length), setting.default]),
  );
}

suite('CONFIG_DEFAULTS', () => {
  test('covers exactly the settings package.json contributes', () => {
    assert.deepStrictEqual(Object.keys(CONFIG_DEFAULTS).sort(), Object.keys(readContributedDefaults()).sort());
  });

  test('every default equals the package.json default', () => {
    const contributed = readContributedDefaults();
    for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
      assert.deepStrictEqual(value, contributed[key], `default for ${key}`);
    }
  });
});
