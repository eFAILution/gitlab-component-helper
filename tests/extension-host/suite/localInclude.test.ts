import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'eFAILution.gitlab-component-helper';

// __dirname is <repo>/out-test/suite at runtime; fixtures live under tests/fixtures.
const FIXTURE_DIR = path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'local-include');
const FIXTURE = path.join(FIXTURE_DIR, '.gitlab-ci.yml');

async function ensureActive(): Promise<void> {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(ext);
  if (!ext.isActive) await ext.activate();
}

function renderHoverContents(hovers: vscode.Hover[]): string {
  return hovers
    .flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : c.value)))
    .join('\n');
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

suite('Local include support', () => {
  suiteSetup(ensureActive);

  test('hovering on a - local: line surfaces spec.inputs parameters', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
    await vscode.window.showTextDocument(doc);

    const text = doc.getText();
    const offset = text.indexOf('local: "local-include/templates/nx-test.yml"');
    assert.ok(offset > 0, 'fixture missing local: include line');
    const position = doc.positionAt(offset + 8); // land on the `local:` token

    const hovers = (await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      doc.uri,
      position
    )) || [];

    assert.ok(hovers.length > 0, 'expected a hover result on the local include line');
    const rendered = renderHoverContents(hovers);
    assert.match(rendered, /job_name/, 'hover should list job_name input from spec.inputs');
    assert.match(rendered, /job_type/, 'hover should list job_type input from spec.inputs');
  });

  test('hovering on an input parameter under a - local: shows parameter docs', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
    await vscode.window.showTextDocument(doc);

    const text = doc.getText();
    const offset = text.indexOf('job_type: nightly');
    assert.ok(offset > 0, 'fixture missing job_type input line');
    const position = doc.positionAt(offset + 3); // land inside `job_type`

    const hovers = (await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      doc.uri,
      position
    )) || [];

    const rendered = renderHoverContents(hovers);
    assert.match(
      rendered,
      /Input Parameter|job_type/i,
      'hover on an input param should produce parameter info from the local template'
    );
  });

  test('unknown input under a - local: produces a validation diagnostic', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
    await vscode.window.showTextDocument(doc);

    const diags = await waitForDiagnostics(doc.uri);
    const ourDiags = diags.filter((d) => d.source === 'gitlab-component-helper');
    const unknown = ourDiags.find(
      (d) => d.code === 'unknown-input' && /bogus_input/.test(d.message)
    );
    assert.ok(
      unknown,
      `expected an unknown-input diagnostic for bogus_input. Got: ${JSON.stringify(ourDiags.map((d) => ({ code: d.code, msg: d.message })))}`
    );
  });

  test('missing local include file produces a not-found diagnostic', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
    await vscode.window.showTextDocument(doc);

    const diags = await waitForDiagnostics(doc.uri);
    const notFound = diags.find(
      (d) => d.source === 'gitlab-component-helper' && d.code === 'local-include-not-found'
    );
    assert.ok(
      notFound,
      `expected a local-include-not-found diagnostic. Got: ${JSON.stringify(diags.map((d) => ({ code: d.code, msg: d.message })))}`
    );
  });

  test('missing required input under a - local: produces a missing-required-input diagnostic', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
    await vscode.window.showTextDocument(doc);

    const diags = await waitForDiagnostics(doc.uri);
    const ourDiags = diags.filter((d) => d.source === 'gitlab-component-helper');
    const missing = ourDiags.find(
      (d) => d.code === 'missing-required-input' && /runner_tag/.test(d.message)
    );
    assert.ok(
      missing,
      `expected a missing-required-input diagnostic for runner_tag. Got: ${JSON.stringify(ourDiags.map((d) => ({ code: d.code, msg: d.message })))}`
    );
  });
});
