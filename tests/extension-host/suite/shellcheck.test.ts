import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'eFAILution.gitlab-component-helper';

// __dirname is <repo>/out-test/suite at runtime; fixtures live under tests/fixtures.
const FIXTURE = path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'shellcheck', '.gitlab-ci.yml');
const QUICKFIX_FIXTURE = path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'shellcheck-quickfix', '.gitlab-ci.yml');

function shellcheckInstalled(): boolean {
  try {
    execFileSync('shellcheck', ['--version']);
    return true;
  } catch {
    return false;
  }
}

async function waitForDiagnostics(
  uri: vscode.Uri,
  predicate: (diags: vscode.Diagnostic[]) => boolean,
  timeoutMs = 10000
): Promise<vscode.Diagnostic[]> {
  const start = Date.now();
  let diags = vscode.languages.getDiagnostics(uri);
  while (Date.now() - start < timeoutMs) {
    diags = vscode.languages.getDiagnostics(uri);
    if (predicate(diags)) return diags;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return diags;
}

const shellcheck = (diags: vscode.Diagnostic[]) => diags.filter((d) => d.source === 'shellcheck');

const codeOf = (d: vscode.Diagnostic) => (typeof d.code === 'object' ? d.code.value : d.code);

suite('ShellCheck diagnostics', function () {
  suiteSetup(async function () {
    if (!shellcheckInstalled()) this.skip();
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    if (!ext.isActive) await ext.activate();
    await vscode.workspace.getConfiguration('gitlabComponentHelper.shellcheck')
      .update('severity', 'info', vscode.ConfigurationTarget.Global);
  });

  suiteTeardown(async () => {
    await vscode.workspace.getConfiguration('gitlabComponentHelper.shellcheck')
      .update('severity', undefined, vscode.ConfigurationTarget.Global);
  });

  test('reports findings on the script line and skips variables defined in the file', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
    await vscode.window.showTextDocument(doc);

    const diags = shellcheck(await waitForDiagnostics(doc.uri, (d) => shellcheck(d).some((x) => codeOf(x) === 'SC2086')));
    const summary = JSON.stringify(diags.map((d) => ({ code: codeOf(d), line: d.range.start.line, msg: d.message })));

    const unquoted = diags.find((d) => codeOf(d) === 'SC2086');
    assert.ok(unquoted, `expected SC2086. Got: ${summary}`);
    assert.strictEqual(doc.getText(unquoted.range), '$unquoted_value');

    assert.ok(diags.some((d) => codeOf(d) === 'SC2154' && /unquoted_value/.test(d.message)), summary);
    assert.ok(!diags.some((d) => /known_var/.test(d.message)), `known_var comes from variables:. Got: ${summary}`);
  });

  test('ignores constant comparisons of inputs and offers disable fixes where they reach ShellCheck', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(QUICKFIX_FIXTURE));
    await vscode.window.showTextDocument(doc);
    const onVariable = (name: string) => (d: vscode.Diagnostic) => codeOf(d) === 'SC2086' && doc.getText(d.range) === name;

    try {
      const diags = shellcheck(await waitForDiagnostics(doc.uri, (d) => shellcheck(d).filter((x) => codeOf(x) === 'SC2086').length === 2));
      const summary = JSON.stringify(diags.map((d) => ({ code: codeOf(d), line: d.range.start.line })));
      assert.ok(!diags.some((d) => codeOf(d) === 'SC2050'), `the $[[ ]] comparison is deliberate. Got: ${summary}`);

      // The command drops each action's diagnostics, so match on the code in the title.
      const actionsFor = async (diagnostic: vscode.Diagnostic) => (await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider', doc.uri, diagnostic.range, vscode.CodeActionKind.QuickFix.value,
      )).filter((a) => a.title.includes('SC2086'));

      const plain = diags.find(onVariable('$plain_value'));
      assert.ok(plain, summary);
      assert.deepStrictEqual((await actionsFor(plain)).map((a) => a.title), ['Ignore SC2086 in workspace settings']);

      const block = diags.find(onVariable('$block_value'));
      assert.ok(block, summary);
      const disable = (await actionsFor(block)).find((a) => a.title === 'Disable SC2086 for this command');
      assert.ok(disable?.edit, 'expected a disable action for the | block finding');
      assert.ok(await vscode.workspace.applyEdit(disable.edit));
      assert.strictEqual(doc.lineAt(block.range.start.line).text, '      # shellcheck disable=SC2086');

      const after = shellcheck(await waitForDiagnostics(doc.uri, (d) => !shellcheck(d).some(onVariable('$block_value'))));
      assert.ok(!after.some(onVariable('$block_value')), 'the directive reaches ShellCheck');
      assert.ok(after.some(onVariable('$plain_value')), 'other findings stay');
    } finally {
      await vscode.commands.executeCommand('workbench.action.files.revert');
    }
  });
});
