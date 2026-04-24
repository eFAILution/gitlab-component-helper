import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'eFAILution.gitlab-component-helper';

const EXPECTED_COMMANDS = [
  'gitlab-component-helper.browseComponents',
  'gitlab-component-helper.refreshComponents',
  'gitlab-component-helper.updateCache',
  'gitlab-component-helper.resetCache',
  'gitlab-component-helper.showCacheStatus',
  'gitlab-component-helper.debugCache',
  'gitlab-component-helper.testProviders',
  'gitlabComponentHelper.addProjectToken',
  'gitlab-component-helper.showPerformanceStats',
];

suite('Activation', () => {
  test('extension is present', () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} not found`);
  });

  test('extension activates', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    if (!ext.isActive) {
      await ext.activate();
    }
    assert.strictEqual(ext.isActive, true);
  });

  test('all declared commands are registered', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    if (!ext.isActive) await ext.activate();

    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = EXPECTED_COMMANDS.filter((c) => !registered.has(c));
    assert.deepStrictEqual(missing, [], `missing commands: ${missing.join(', ')}`);
  });
});
