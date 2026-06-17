import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'eFAILution.gitlab-component-helper';

// __dirname is <repo>/out-test/suite at runtime; fixtures live under tests/fixtures.
const FIXTURE_DIR = path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'flow-inputs');
const FIXTURE = path.join(FIXTURE_DIR, '.gitlab-ci.yml');

async function ensureActive(): Promise<void> {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(ext);
  if (!ext.isActive) await ext.activate();
}

async function waitForDiagnostics(uri: vscode.Uri, timeoutMs = 5000): Promise<vscode.Diagnostic[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const diags = vscode.languages.getDiagnostics(uri);
    if (diags.length > 0) return diags;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return vscode.languages.getDiagnostics(uri);
}

/** 0-indexed line of the top-level `deploy:` job that lies below the include. */
function jobLine(doc: vscode.TextDocument): number {
  const lines = doc.getText().split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === 'deploy:') return i;
  }
  throw new Error('fixture missing the top-level deploy: job');
}

// The single (last) include uses flow-style `inputs: { ... }`, so its unknown input `bad_input` appears only on
// the `inputs:` line — never on its own line. A top-level job below reuses `bad_input:` under `variables:`. With
// the input scan bounded only by end-of-file, the diagnostic would bleed down onto the job's variable. The
// indent break keeps it inside the include's block.
suite('Flow-style inputs do not bleed into a later top-level section', () => {
  suiteSetup(ensureActive);

  test('unknown input in flow-style inputs anchors inside the include, not the job below', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
    await vscode.window.showTextDocument(doc);
    const job = jobLine(doc);

    const diags = await waitForDiagnostics(doc.uri);
    const ourDiags = diags.filter((d) => d.source === 'gitlab-component-helper');

    const badInput = ourDiags.find((d) => d.code === 'unknown-input' && /bad_input/.test(d.message));
    assert.ok(
      badInput,
      `expected an unknown-input diagnostic for bad_input. Got: ${JSON.stringify(ourDiags.map((d) => ({ code: d.code, msg: d.message, line: d.range.start.line })))}`
    );
    assert.ok(
      badInput.range.start.line < job,
      `bad_input should anchor inside the include block (above the deploy: job at line ${job}), but landed on line ${badInput.range.start.line}`
    );
  });
});
