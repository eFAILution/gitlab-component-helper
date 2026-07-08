import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'eFAILution.gitlab-component-helper';

// __dirname is <repo>/out-test/suite at runtime; fixtures live under tests/fixtures.
const FIXTURE_DIR = path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'enum-options');
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

function itemNamed(list: vscode.CompletionList | undefined, label: string): vscode.CompletionItem | undefined {
  return (list?.items ?? []).find((i) => (typeof i.label === 'string' ? i.label : i.label.label) === label);
}

/** Like {@link itemNamed} but fails the test (and narrows away `undefined`) when no item has that label. */
function requireItem(list: vscode.CompletionList, label: string): vscode.CompletionItem {
  const item = itemNamed(list, label);
  if (!item) {
    throw new assert.AssertionError({
      message: `expected a '${label}' completion item. Got: ${JSON.stringify(labels(list))}`,
    });
  }
  return item;
}

function snippetText(item: vscode.CompletionItem): string {
  const insert = item.insertText;
  if (typeof insert === 'string') return insert;
  if (insert instanceof vscode.SnippetString) return insert.value;
  return '';
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

// Drives VS Code's own completion engine (executeCompletionItemProvider) against a local include whose
// `environment` input declares `options:` AND a `default:`. Covers both completion slots: the value position
// (after `environment:`) must offer the allowed values directly, and the name slot must still insert the
// name + value-choice snippet.
suite('Enum options completion for an include input', () => {
  suiteSetup(ensureActive);

  test('value slot after `region:` offers the allowed values as bare scalars', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
    await vscode.window.showTextDocument(doc);

    const line = lineStartingWith(doc, 'region');
    // End of the `      region: ` line — the value position a user fills.
    const position = new vscode.Position(line, doc.lineAt(line).text.length);
    const list = await completionsAt(doc, position);

    const eu = requireItem(list, 'eu-west-1');
    const us = requireItem(list, 'us-east-1');
    // Values insert as the bare scalar, not a name: value snippet.
    assert.strictEqual(snippetText(eu), 'eu-west-1');
    assert.strictEqual(snippetText(us), 'us-east-1');
  });

  test('name slot offers the ${1|...|} value choice for an enum input that also has a default (default first)', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
    await vscode.window.showTextDocument(doc);

    // `environment` is an enum input WITH a default (`staging`) and isn't set yet. Accepting it by name must offer
    // the value choice — not silently insert the bare default — with the default floated to the front.
    const keyIndent = doc.lineAt(lineStartingWith(doc, 'job_name')).firstNonWhitespaceCharacterIndex;
    let slotLine = -1;
    for (let i = 0; i < doc.lineCount; i++) {
      const t = doc.lineAt(i).text;
      if (t.trim() === '' && t.length >= keyIndent && /^\s+$/.test(t)) {
        slotLine = i;
        break;
      }
    }
    assert.ok(slotLine !== -1, 'fixture is missing a whitespace-only name slot at the input-key indent');
    const position = new vscode.Position(slotLine, keyIndent);
    const list = await completionsAt(doc, position);

    const envItem = requireItem(list, 'environment');
    assert.strictEqual(snippetText(envItem), 'environment: ${1|staging,production|}');
  });
});
