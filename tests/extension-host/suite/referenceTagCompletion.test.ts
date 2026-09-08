import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'eFAILution.gitlab-component-helper';

// __dirname is <repo>/out-test/suite at runtime; fixtures live under tests/fixtures.
const FIXTURE_DIR = path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'reference-tag-completion');
const FIXTURE = path.join(FIXTURE_DIR, '.gitlab-ci.yml');

async function ensureActive(): Promise<void> {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(ext);
  if (!ext.isActive) await ext.activate();
}

/** 0-indexed line whose trimmed text starts with `<name>:`. */
function lineStartingWith(doc: vscode.TextDocument, name: string): number {
  const lines = doc.getText().split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith(`${name}:`)) return i;
  }
  throw new Error(`fixture missing a line starting with ${name}:`);
}

function labels(list: vscode.CompletionList | undefined): string[] {
  return (list?.items ?? []).map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
}

async function completionsAt(doc: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionList> {
  const list = await vscode.commands.executeCommand<vscode.CompletionList>(
    'vscode.executeCompletionItemProvider',
    doc.uri,
    position
  );
  assert.ok(list, 'executeCompletionItemProvider returned no completion list');
  return list;
}

// Regression for GitLab's `!reference [.job, key]` tag. It belongs to no YAML schema, so a stock parser threw on it
// and took the entire file down — `include:` block included — leaving the parse null and suppressing every input
// completion, even though the tag sits in an unrelated job further down the file. Drives VS Code's own completion
// engine end-to-end to confirm the name slot still resolves with a `!reference` present.
suite('Input completion in a file using a !reference tag', () => {
  suiteSetup(ensureActive);

  test('name slot under the include offers the include\'s not-yet-set inputs', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
    const editor = await vscode.window.showTextDocument(doc);

    // The include's inputs already set `job_name`; the remaining inputs are `environment` and `region`. Type a
    // fresh name slot on a new line under `job_name:` at that key's indent, then ask for completions at the caret.
    const jobNameLine = lineStartingWith(doc, 'job_name');
    const keyIndent = doc.lineAt(jobNameLine).firstNonWhitespaceCharacterIndex;
    const insertAt = new vscode.Position(jobNameLine, doc.lineAt(jobNameLine).text.length);
    await editor.edit((b) => b.insert(insertAt, `\n${' '.repeat(keyIndent)}`));

    const slotLine = jobNameLine + 1;
    const position = new vscode.Position(slotLine, keyIndent);
    const list = await completionsAt(doc, position);

    const got = labels(list);
    assert.ok(got.includes('environment'), `expected an 'environment' completion. Got: ${JSON.stringify(got)}`);
    assert.ok(got.includes('region'), `expected a 'region' completion. Got: ${JSON.stringify(got)}`);
    // The already-set input must not be re-offered.
    assert.ok(!got.includes('job_name'), `'job_name' is already set and must not be offered. Got: ${JSON.stringify(got)}`);
  });
});
