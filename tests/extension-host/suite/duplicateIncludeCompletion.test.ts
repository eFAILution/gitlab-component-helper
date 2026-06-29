import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'eFAILution.gitlab-component-helper';

// __dirname is <repo>/out-test/suite at runtime; fixtures live under tests/fixtures.
const FIXTURE_DIR = path.resolve(__dirname, '..', '..', 'tests', 'fixtures', 'duplicate-include-completion');
const FIXTURE = path.join(FIXTURE_DIR, '.gitlab-ci.yml');

async function ensureActive(): Promise<void> {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(ext);
  if (!ext.isActive) await ext.activate();
}

/**
 * The input-name completion slot under the second include: the blank, six-space-indented line directly after the
 * second include's `region: eu-west-2`. Derived from the document so the position survives fixture edits.
 */
function secondIncludeSlot(doc: vscode.TextDocument): vscode.Position {
  const lines = doc.getText().split('\n');
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('region: eu-west-2')) {
      seen++;
      if (seen === 1) {
        const slotLine = i + 1;
        assert.ok(lines[slotLine] !== undefined, 'fixture missing the blank slot line after the second include');
        return new vscode.Position(slotLine, 6); // align with the existing input keys
      }
    }
  }
  throw new Error('fixture missing the second include`s region: eu-west-2 input');
}

// The fixture includes the same local template twice. The duplicate-include fix made the completion provider
// anchor each include to its own occurrence's line; before it, the second include's inputs slot resolved to the
// first include and offered nothing. This drives the real CompletionProvider end-to-end.
suite('Duplicate include input completions', () => {
  suiteSetup(ensureActive);

  test('offers input completions in the second identical include`s slot', async () => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(FIXTURE));
    await vscode.window.showTextDocument(doc);
    const slot = secondIncludeSlot(doc);

    const list = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      doc.uri,
      slot
    );
    const labels = (list?.items ?? []).map((i) => (typeof i.label === 'string' ? i.label : i.label.label));

    // The template's inputs are job_name, cluster, region. `region` is already set under the second include,
    // so it must be filtered out; the other two must be offered.
    assert.ok(labels.includes('job_name'), `expected job_name to be offered. Got: ${JSON.stringify(labels)}`);
    assert.ok(labels.includes('cluster'), `expected cluster to be offered. Got: ${JSON.stringify(labels)}`);
    assert.ok(
      !labels.includes('region'),
      `region is already present under the second include and must be filtered out. Got: ${JSON.stringify(labels)}`
    );
  });
});
