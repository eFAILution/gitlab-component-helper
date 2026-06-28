import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'eFAILution.gitlab-component-helper';

// __dirname is <repo>/out-test/suite at runtime; fixtures live under tests/fixtures.
const FIXTURE_DIR = path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'revalidate-on-edit');
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

// The edited input sits >5 lines below the include line in the fixture. A proximity-gated change detector skipped
// re-validation for such edits, so the diagnostics went stale. Validation now runs on every edit to a CI file.
suite('Re-validation on edit', () => {
  suiteSetup(ensureActive);

  test('renaming a valid input to an unknown one updates diagnostics', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
    const editor = await vscode.window.showTextDocument(doc);

    // The fixture is valid on open: no unknown-input diagnostics.
    const clean = await waitForDiagnostics(
      doc.uri,
      (d) => !ours(d).some((x) => x.code === 'unknown-input')
    );
    assert.ok(
      !ours(clean).some((x) => x.code === 'unknown-input'),
      `fixture should open clean. Got: ${JSON.stringify(ours(clean).map((d) => ({ code: d.code, msg: d.message })))}`
    );

    // Rename `target_input` -> `target_inputX` (now an unknown input) far below the include line.
    const text = doc.getText();
    const offset = text.indexOf('target_input:');
    assert.ok(offset > 0, 'fixture missing target_input');
    const namePos = doc.positionAt(offset + 'target_input'.length);
    await editor.edit((b) => b.insert(namePos, 'X'));

    const after = await waitForDiagnostics(
      doc.uri,
      (d) => ours(d).some((x) => x.code === 'unknown-input' && /target_inputX/.test(x.message))
    );
    const unknown = ours(after).find(
      (x) => x.code === 'unknown-input' && /target_inputX/.test(x.message)
    );
    assert.ok(
      unknown,
      `expected an unknown-input diagnostic for target_inputX after the edit. Got: ${JSON.stringify(ours(after).map((d) => ({ code: d.code, msg: d.message, line: d.range.start.line })))}`
    );
  });
});
