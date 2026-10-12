// @mocha
/**
 * Tests src/providers/componentInsertionPoint.ts — where the Component Browser's "Insert" places a new component:
 * at the end of the top-level `include:` list, or in a new `include:` block at the top of the file.
 */

import * as assert from 'node:assert/strict';
import {
  planComponentInsertion,
  type ComponentInsertion,
  type TextPosition,
} from '../../src/providers/componentInsertionPoint';

const SNIPPET = '  - component: gitlab.com/g/p/c@v1';
const SNIPPET_WITH_INPUTS = '  - component: gitlab.com/g/p/c@v1\n    inputs:\n      stage: "test" # optional';

/** Apply `insertion` to `text` so assertions read as the resulting document. */
function apply(text: string, insertion: ComponentInsertion | null): string {
  assert.ok(insertion, 'expected an insertion plan');
  const lines = text.split('\n');
  const offset = (at: TextPosition) =>
    lines.slice(0, at.line).reduce((sum, line) => sum + line.length + 1, 0) + at.character;
  return text.slice(0, offset(insertion.start)) + insertion.text + text.slice(offset(insertion.end));
}

const plannedText = (text: string, snippet = SNIPPET) => apply(text, planComponentInsertion(text, snippet));

suite('planComponentInsertion — existing include list', () => {
  test('appends after the last entry, before the next top-level key', () => {
    assert.strictEqual(
      plannedText('include:\n  - local: a.yml\n  - component: gitlab.com/g/p/other@v2\n\nstages:\n  - test\n'),
      'include:\n  - local: a.yml\n  - component: gitlab.com/g/p/other@v2\n'
        + '  - component: gitlab.com/g/p/c@v1\n\nstages:\n  - test\n',
    );
  });

  test('appends after a multi-line last entry', () => {
    assert.strictEqual(
      plannedText('include:\n  - component: gitlab.com/g/p/a@v1\n    inputs:\n      stage: build\n'
        + 'build:\n  script: make\n'),
      'include:\n  - component: gitlab.com/g/p/a@v1\n    inputs:\n      stage: build\n'
        + '  - component: gitlab.com/g/p/c@v1\nbuild:\n  script: make\n',
    );
  });

  test('re-indents the snippet to match a column-0 list', () => {
    assert.strictEqual(
      plannedText('include:\n- local: a.yml\n', SNIPPET_WITH_INPUTS),
      'include:\n- local: a.yml\n- component: gitlab.com/g/p/c@v1\n  inputs:\n    stage: "test" # optional\n',
    );
  });

  test('re-indents the snippet to match a 4-space list', () => {
    assert.strictEqual(
      plannedText('include:\n    - local: a.yml\n'),
      'include:\n    - local: a.yml\n    - component: gitlab.com/g/p/c@v1\n',
    );
  });

  test('leaves trailing comments and blank lines after the new entry', () => {
    assert.strictEqual(
      plannedText('include:\n  - local: a.yml\n  # - local: disabled.yml\n\n# Stages\nstages: [test]\n'),
      'include:\n  - local: a.yml\n  - component: gitlab.com/g/p/c@v1\n'
        + '  # - local: disabled.yml\n\n# Stages\nstages: [test]\n',
    );
  });

  test('appends to an include list at the end of a file with no trailing newline', () => {
    assert.strictEqual(
      plannedText('stages: [test]\ninclude:\n  - local: a.yml'),
      'stages: [test]\ninclude:\n  - local: a.yml\n  - component: gitlab.com/g/p/c@v1',
    );
  });

  test('fills an empty include key, keeping its comment', () => {
    assert.strictEqual(
      plannedText('include: # shared\nstages: [test]\n'),
      'include: # shared\n  - component: gitlab.com/g/p/c@v1\nstages: [test]\n',
    );
  });

  test('positions the insert before a CRLF line ending', () => {
    const at = { line: 1, character: '  - local: a.yml'.length };
    assert.deepStrictEqual(
      planComponentInsertion('include:\r\n  - local: a.yml\r\n', SNIPPET),
      { start: at, end: at, text: `\n${SNIPPET}` },
    );
  });

  test('ignores an indented include key belonging to a job', () => {
    assert.strictEqual(plannedText('job:\n  include: nope\n'), `include:\n${SNIPPET}\n\njob:\n  include: nope\n`);
  });
});

suite('planComponentInsertion — single include entry', () => {
  const cases: [string, string, string][] = [
    ['a plain scalar', 'include: a.yml', 'include:\n  - a.yml'],
    ['a quoted scalar', "include: 'a #1.yml'", "include:\n  - 'a #1.yml'"],
    [
      'a flow mapping',
      'include: { local: a.yml, rules: [{ if: $X }] }',
      'include:\n  - { local: a.yml, rules: [{ if: $X }] }',
    ],
    [
      'a flow sequence',
      'include: [a.yml, "b, c.yml", { local: d.yml }]',
      'include:\n  - a.yml\n  - "b, c.yml"\n  - { local: d.yml }',
    ],
    ['an empty flow sequence', 'include: []', 'include:'],
    ['a value with a trailing comment', 'include: a.yml  # shared', 'include: # shared\n  - a.yml'],
  ];
  for (const [label, line, converted] of cases) {
    test(`converts ${label} into a list`, () => {
      assert.strictEqual(plannedText(`${line}\nstages: [test]\n`), `${converted}\n${SNIPPET}\nstages: [test]\n`);
    });
  }

  test('converts a flow sequence spanning lines, moving its trailing comment to the include line', () => {
    assert.strictEqual(
      plannedText('include: [a.yml,\n  b.yml]  # shared\nstages: [test]\n'),
      `include: # shared\n  - a.yml\n  - b.yml\n${SNIPPET}\nstages: [test]\n`,
    );
  });

  test('converts a block mapping into a list, re-indenting its nested lines', () => {
    assert.strictEqual(
      plannedText('include:\n  local: a.yml\n  rules:\n    - if: $X\n\nstages: [test]\n'),
      'include:\n  - local: a.yml\n    rules:\n      - if: $X\n  - component: gitlab.com/g/p/c@v1\n\nstages: [test]\n',
    );
  });

  const unconvertible = [
    'include: *shared',
    'include: &shared a.yml',
    'include: !reference [.x, include]',
    'include: |\n  a.yml',
    'include: [{ local: a.yml,\n  rules: [] }]',
  ];
  for (const line of unconvertible) {
    test(`returns null for \`${line}\` so the caller falls back to the cursor`, () => {
      assert.strictEqual(planComponentInsertion(`${line}\nstages: [test]\n`, SNIPPET), null);
    });
  }

  test('returns null for a plain scalar continued on the next line', () => {
    assert.strictEqual(planComponentInsertion('include: a\n  .yml\n', SNIPPET), null);
  });
});

suite('planComponentInsertion — unparseable or unplaceable files', () => {
  test('returns null for YAML that does not parse', () => {
    assert.strictEqual(planComponentInsertion('include: [a.yml,\nstages: [test]\n', SNIPPET), null);
  });

  test('returns null for a spec header with no pipeline document', () => {
    assert.strictEqual(planComponentInsertion('spec:\n  inputs: {}\n', SNIPPET), null);
  });

  test('still places the include when another key uses a !reference tag', () => {
    assert.strictEqual(
      plannedText('job:\n  script: !reference [.setup, script]\n'),
      `include:\n${SNIPPET}\n\njob:\n  script: !reference [.setup, script]\n`,
    );
  });
});

suite('planComponentInsertion — no include key', () => {
  test('adds an include block at the top of the file, separated by a blank line', () => {
    assert.strictEqual(plannedText('stages:\n  - test\n'), `include:\n${SNIPPET}\n\nstages:\n  - test\n`);
  });

  test('adds the include block after leading comments and blank lines', () => {
    assert.strictEqual(
      plannedText('# Pipeline for X\n# owner: y\n\nstages: [test]\n'),
      `# Pipeline for X\n# owner: y\n\ninclude:\n${SNIPPET}\n\nstages: [test]\n`,
    );
  });

  test('adds the include block after a file of only comments', () => {
    assert.strictEqual(plannedText('# todo\n'), `# todo\ninclude:\n${SNIPPET}\n`);
    assert.strictEqual(plannedText('# todo'), `# todo\ninclude:\n${SNIPPET}`);
  });

  test('adds an include block to an empty file', () => {
    assert.strictEqual(plannedText(''), `include:\n${SNIPPET}\n`);
  });

  test('places the include block after a component template\'s spec header', () => {
    assert.strictEqual(
      plannedText('spec:\n  inputs:\n    stage:\n      default: test\n---\n# Jobs\njob:\n  script: make\n'),
      `spec:\n  inputs:\n    stage:\n      default: test\n---\n# Jobs\ninclude:\n${SNIPPET}\n\njob:\n  script: make\n`,
    );
  });

  test('adds the include block to a component template\'s empty pipeline document', () => {
    assert.strictEqual(plannedText('spec:\n  inputs: {}\n---\n'), `spec:\n  inputs: {}\n---\ninclude:\n${SNIPPET}\n`);
  });

  test('appends to an include list in the pipeline document of a component template', () => {
    assert.strictEqual(
      plannedText('spec:\n  inputs: {}\n---\ninclude:\n  - local: a.yml\n'),
      `spec:\n  inputs: {}\n---\ninclude:\n  - local: a.yml\n${SNIPPET}\n`,
    );
  });
});
