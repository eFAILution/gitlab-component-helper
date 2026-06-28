import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'eFAILution.gitlab-component-helper';

// __dirname is <repo>/out-test/suite at runtime; fixtures live under tests/fixtures.
const FIXTURE_DIR = path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'duplicate-include');
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

/** 0-indexed line of the second `- local:` entry — derived from the document so it survives fixture edits. */
function secondIncludeLine(doc: vscode.TextDocument): number {
  const lines = doc.getText().split('\n');
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('local:') && lines[i].includes('templates/deploy.yml')) {
      seen++;
      if (seen === 2) return i;
    }
  }
  throw new Error('fixture missing a second - local: deploy.yml include');
}

// The fixture includes the same template twice: the first entry is correct, the second uses a wrong input
// name (`target_cluster` instead of `cluster`). Before the per-entry line scoping fix, the diagnostics for
// the second entry were anchored onto the first entry because the line-finders matched the first occurrence
// of the shared path. These tests pin the diagnostics to the entry they actually belong to.
suite('Duplicate include line scoping', () => {
  suiteSetup(ensureActive);

  test('unknown input on the second include is anchored to the second block', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
    await vscode.window.showTextDocument(doc);
    const secondLine = secondIncludeLine(doc);

    const diags = await waitForDiagnostics(doc.uri);
    const ourDiags = diags.filter((d) => d.source === 'gitlab-component-helper');
    const unknown = ourDiags.find(
      (d) => d.code === 'unknown-input' && /target_cluster/.test(d.message)
    );
    assert.ok(
      unknown,
      `expected an unknown-input diagnostic for target_cluster. Got: ${JSON.stringify(ourDiags.map((d) => ({ code: d.code, msg: d.message, line: d.range.start.line })))}`
    );
    assert.ok(
      unknown.range.start.line >= secondLine,
      `unknown-input for target_cluster should land in the second include block (line >= ${secondLine}), but landed on line ${unknown.range.start.line}`
    );
  });

  test('missing required input on the second include is anchored to the second block', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
    await vscode.window.showTextDocument(doc);
    const secondLine = secondIncludeLine(doc);

    const diags = await waitForDiagnostics(doc.uri);
    const ourDiags = diags.filter((d) => d.source === 'gitlab-component-helper');

    // Only the second include is missing `cluster`; the first supplies it. So there must be exactly one
    // missing-required-input diagnostic for `cluster`, and it must sit on the second include line.
    const missing = ourDiags.filter(
      (d) => d.code === 'missing-required-input' && /cluster/.test(d.message)
    );
    assert.strictEqual(
      missing.length,
      1,
      `expected exactly one missing-required-input for cluster (second include only). Got: ${JSON.stringify(missing.map((d) => ({ msg: d.message, line: d.range.start.line })))}`
    );
    assert.strictEqual(
      missing[0].range.start.line,
      secondLine,
      `missing cluster diagnostic should anchor to the second include line (${secondLine}), but landed on line ${missing[0].range.start.line}`
    );
  });

  test('the first include reports no diagnostics', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
    await vscode.window.showTextDocument(doc);
    const secondLine = secondIncludeLine(doc);

    const diags = await waitForDiagnostics(doc.uri);
    const firstBlockDiags = diags.filter(
      (d) => d.source === 'gitlab-component-helper' && d.range.start.line < secondLine
    );
    assert.strictEqual(
      firstBlockDiags.length,
      0,
      `the first (correct) include should have no diagnostics, but found: ${JSON.stringify(firstBlockDiags.map((d) => ({ code: d.code, msg: d.message, line: d.range.start.line })))}`
    );
  });
});
