import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'eFAILution.gitlab-component-helper';

// __dirname is <repo>/out-test/suite at runtime; fixtures live under tests/fixtures.
const FIXTURE_DIR = path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'merge-key');
const FIXTURE = path.join(FIXTURE_DIR, '.gitlab-ci.yml');

async function ensureActive(): Promise<void> {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(ext);
  if (!ext.isActive) await ext.activate();
}

/** Wait until our own validation has run — the fixture's `bogus_input` guarantees one diagnostic to key off. */
async function waitForOurDiagnostics(uri: vscode.Uri, timeoutMs = 5000): Promise<vscode.Diagnostic[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ours = vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'gitlab-component-helper');
    if (ours.some((d) => d.code === 'unknown-input')) return ours;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'gitlab-component-helper');
}

function labels(list: vscode.CompletionList | undefined): string[] {
  return (list?.items ?? []).map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
}

// Regression for the YAML merge key. GitLab parses with Psych, where `<<: *anchor` merges the anchored mapping in;
// without `mergeTag` the parser leaves a literal `<<` key, so a `spec.inputs` entry inheriting its `default` through
// the merge reads as having no default — reported missing — and `<<` itself surfaces as an input. Drives VS Code's
// diagnostics and completion engine end-to-end, which is where the user actually sees the bug.
suite('Merge-key inputs in a local include', () => {
  suiteSetup(ensureActive);

  test('inputs inheriting a default through `<<:` are not reported missing', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
    await vscode.window.showTextDocument(doc);

    const ours = await waitForOurDiagnostics(doc.uri);
    const missing = ours.filter((d) => d.code === 'missing-required-input');
    assert.deepStrictEqual(
      missing.map((d) => d.message),
      [],
      `stage and region both carry a default through the merge key, so neither is required. Got: ${JSON.stringify(ours.map((d) => ({ code: d.code, msg: d.message })))}`
    );
  });

  test('the merge key itself is not offered as an input', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
    const editor = await vscode.window.showTextDocument(doc);

    // Open a fresh name slot under `job_name:` at that key's indent, then ask for completions at the caret.
    const lines = doc.getText().split('\n');
    const jobNameLine = lines.findIndex((l) => l.trim().startsWith('job_name:'));
    assert.ok(jobNameLine !== -1, 'fixture missing a job_name input line');
    const keyIndent = doc.lineAt(jobNameLine).firstNonWhitespaceCharacterIndex;
    const insertAt = new vscode.Position(jobNameLine, doc.lineAt(jobNameLine).text.length);
    await editor.edit((b) => b.insert(insertAt, `\n${' '.repeat(keyIndent)}`));

    const list = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      doc.uri,
      new vscode.Position(jobNameLine + 1, keyIndent)
    );
    const got = labels(list);

    assert.ok(!got.includes('<<'), `'<<' is a merge key, not an input. Got: ${JSON.stringify(got)}`);
    assert.ok(got.includes('stage'), `expected the merged-in 'stage' input. Got: ${JSON.stringify(got)}`);
    assert.ok(got.includes('region'), `expected the merged-in 'region' input. Got: ${JSON.stringify(got)}`);
  });
});
