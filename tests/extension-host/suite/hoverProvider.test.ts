import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'eFAILution.gitlab-component-helper';
// __dirname is <repo>/out-test/suite at runtime; fixture lives under tests/fixtures.
const FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'tests',
  'fixtures',
  'variables.gitlab-ci.yml'
);

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

suite('HoverProvider — GitLab predefined variables', () => {
  suiteSetup(ensureActive);

  test('hovering over $CI_COMMIT_SHA in a .gitlab-ci.yml returns variable info', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
    await vscode.window.showTextDocument(doc);

    // The fixture's `script:` line is deterministic: `    - echo "commit $CI_COMMIT_SHA on ...`
    // Find the first occurrence of CI_COMMIT_SHA and hover at its midpoint.
    const text = doc.getText();
    const offset = text.indexOf('CI_COMMIT_SHA');
    assert.ok(offset > 0, 'fixture missing CI_COMMIT_SHA');
    const position = doc.positionAt(offset + 3); // land inside the token

    const hovers = (await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      doc.uri,
      position
    )) || [];

    assert.ok(hovers.length > 0, 'expected at least one hover result');
    const rendered = renderHoverContents(hovers);
    assert.match(rendered, /CI_COMMIT_SHA/, 'hover content should mention the variable name');
    assert.match(rendered, /GitLab Variable/i, 'hover content should identify as a GitLab variable');
  });

  test('hovering on a plain word in a non-GitLab file returns no extension hover', async () => {
    // Open an untitled plain-text doc — the provider's isGitLabCIFile() should skip it.
    const doc = await vscode.workspace.openTextDocument({
      content: 'some plain text with the word CI_COMMIT_SHA inside\n',
      language: 'plaintext',
    });
    await vscode.window.showTextDocument(doc);

    const offset = doc.getText().indexOf('CI_COMMIT_SHA');
    const position = doc.positionAt(offset + 3);

    const hovers = (await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      doc.uri,
      position
    )) || [];

    // VS Code itself may contribute an empty-ish hover for plain text; we just
    // assert nothing from *our* extension fires — i.e. no hover mentions
    // "GitLab Variable", which is a string only our provider emits.
    const rendered = renderHoverContents(hovers);
    assert.doesNotMatch(
      rendered,
      /GitLab Variable/i,
      'extension hover must not trigger on non-GitLab files'
    );
  });
});
