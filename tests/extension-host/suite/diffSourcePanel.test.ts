import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'eFAILution.gitlab-component-helper';

// __dirname is <repo>/out-test/suite at runtime; fixtures live under tests/fixtures.
// Reuse the local-include fixture: it reliably produces gitlab-component-helper diagnostics.
const FIXTURE_DIR = path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'local-include');
const FIXTURE = path.join(FIXTURE_DIR, '.gitlab-ci.yml');

async function ensureActive(): Promise<void> {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(ext);
  if (!ext.isActive) await ext.activate();
}

/** Poll until `predicate` holds over the current diagnostics, or the timeout elapses. Returns the last snapshot. */
async function waitForDiagnostics(
  uri: vscode.Uri,
  predicate: (diags: vscode.Diagnostic[]) => boolean,
  timeoutMs = 5000
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

const ours = (diags: vscode.Diagnostic[]) => diags.filter((d) => d.source === 'gitlab-component-helper');

// In a diff view the source (left) panel is a read-only document under a VCS scheme that shares the working-tree
// file's fsPath. Validating it made the squiggles appear on both panels; only the `file`-scheme copy should carry
// diagnostics now.
suite('Diff source panel diagnostics', () => {
  suiteSetup(ensureActive);

  test('the working-tree (file) document still carries diagnostics', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
    await vscode.window.showTextDocument(doc, { preview: false });

    const diags = await waitForDiagnostics(doc.uri, (d) => ours(d).length > 0);
    assert.ok(
      ours(diags).length > 0,
      `file-scheme document should carry diagnostics. Got: ${JSON.stringify(ours(diags).map((d) => ({ code: d.code, msg: d.message })))}`
    );
  });

  test('does not produce diagnostics for a non-file (diff source) document', async () => {
    const fixtureText = (
      await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE))
    ).getText();

    // Mirror how a diff source panel opens: same fsPath, a VCS-style scheme, read-only content.
    const provider: vscode.TextDocumentContentProvider = { provideTextDocumentContent: () => fixtureText };
    const registration = vscode.workspace.registerTextDocumentContentProvider('gitlab-test', provider);
    try {
      const sourceUri = vscode.Uri.file(FIXTURE).with({ scheme: 'gitlab-test' });
      const sourceDoc = await vscode.workspace.openTextDocument(sourceUri);
      await vscode.window.showTextDocument(sourceDoc, { preview: false });

      // Give validation a window to run (and incorrectly emit) before asserting it stayed silent.
      const diags = await waitForDiagnostics(sourceUri, (d) => ours(d).length > 0, 2000);
      assert.strictEqual(
        ours(diags).length,
        0,
        `diff source panel should carry no diagnostics. Got: ${JSON.stringify(ours(diags).map((d) => ({ code: d.code, msg: d.message })))}`
      );
    } finally {
      registration.dispose();
    }
  });
});
