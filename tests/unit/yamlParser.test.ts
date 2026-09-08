// @mocha
/**
 * yamlParser tests — the multi-document stream helpers `parseYamlDocuments` and `findDocumentWith`.
 *
 * The critical case: a GitLab component template is a multi-document file — the `spec:` header is one
 * `---`-delimited document, the `include:`/jobs body another. `js-yaml`'s `load` throws on such a stream, so
 * completion/hover/validation (which read `include:`) got nothing until they switched to these helpers, which
 * parse all documents and let a caller select the one owning the key it needs.
 */

import * as assert from 'node:assert/strict';
import { parseYaml, parseYamlDocuments, findDocumentWith } from '../../src/utils/yamlParser';

suite('parseYamlDocuments', () => {
  test('returns every mapping document of a multi-document stream', () => {
    const text = `spec:
  inputs:
    job_name:
      type: string
---
include:
  - component: https://gitlab.com/c/x@1.0.0
`;
    const docs = parseYamlDocuments(text, true);
    assert.strictEqual(docs.length, 2);
    assert.ok('spec' in docs[0]);
    assert.ok('include' in docs[1]);
  });

  test('returns the single document of a one-document stream', () => {
    const docs = parseYamlDocuments('include:\n  - local: a.yml\n', true);
    assert.strictEqual(docs.length, 1);
    assert.ok('include' in docs[0]);
  });

  test('drops non-mapping documents (scalars, sequences, null)', () => {
    const docs = parseYamlDocuments('- a\n- b\n---\njustAScalar\n', true);
    assert.deepStrictEqual(docs, []);
  });

  test('returns [] on unparseable input', () => {
    assert.deepStrictEqual(parseYamlDocuments('key: "unterminated', true), []);
  });

  // A stock schema throws on GitLab's `!reference`, taking the whole document — `include:` and all — down with it.
  test('parses a document using GitLab\'s !reference tag', () => {
    const text = `include:
  - component: https://gitlab.com/c/x@1.0.0
    inputs:
      stage: build

test:
  script:
    - !reference [.pnpm-setup, script]
`;
    const docs = parseYamlDocuments(text, true);
    assert.strictEqual(docs.length, 1);
    const doc = findDocumentWith(docs, 'include');
    assert.ok(doc, 'the include-bearing document should survive the !reference tag');
    assert.deepStrictEqual(doc.include, [
      { component: 'https://gitlab.com/c/x@1.0.0', inputs: { stage: 'build' } },
    ]);
  });

  test('constructs !reference as the path sequence it points at', () => {
    const docs = parseYamlDocuments('test:\n  script:\n    - !reference [.setup, script]\n', true);
    assert.deepStrictEqual(docs[0].test, { script: [['.setup', 'script']] });
  });

  // Any local tag is fatal to a stock parse, not just a sequence-position `!reference`. Each of these forms took the
  // whole document down while only the sequence form was handled, so the tags match by prefix on `!` instead.
  test('tolerates a local tag in every node position', () => {
    const cases: [string, string, unknown][] = [
      ['scalar', 'key: !reference foo', { key: 'foo' }],
      ['sequence', 'key: !reference [.setup, script]', { key: ['.setup', 'script'] }],
      ['mapping', 'key: !reference\n  nested: value', { key: { nested: 'value' } }],
    ];
    for (const [position, text, expected] of cases) {
      assert.deepStrictEqual(parseYamlDocuments(text, true)[0], expected, `${position} position`);
    }
  });

  // The shape a user is mid-way through typing: `!reference` with no argument yet. Losing the parse here blanks
  // completion at exactly the moment it is wanted.
  test('tolerates a half-typed tag with no value yet', () => {
    const text = `include:
  - component: https://gitlab.com/c/x@1.0.0
    inputs:
      stage: build

test:
  script:
    - !reference
`;
    const doc = findDocumentWith(parseYamlDocuments(text, true), 'include');
    assert.ok(doc, 'the include must still resolve while a tag is half-typed');
  });

  test('tolerates an unknown tag that is not !reference', () => {
    assert.deepStrictEqual(parseYamlDocuments('a: !custom [1, 2]', true)[0], { a: [1, 2] });
  });

  // The tolerated tags must not disturb ordinary YAML: core scalars keep their types rather than becoming strings.
  test('leaves untagged YAML and its scalar types alone', () => {
    const text = 'num: 1\nbool: true\nnul: null\nstr: plain\nlist:\n  - a\n';
    assert.deepStrictEqual(parseYamlDocuments(text, true)[0], {
      num: 1,
      bool: true,
      nul: null,
      str: 'plain',
      list: ['a'],
    });
  });
});

// `parseYaml` is the single-document path (the completion round-trip probe, the component browser's wrapped-include
// parse). It takes the same schema, but the tests above all go through `parseYamlDocuments`.
suite('parseYaml', () => {
  test('tolerates a local tag in every node position', () => {
    assert.deepStrictEqual(parseYaml('key: !reference foo', true), { key: 'foo' });
    assert.deepStrictEqual(parseYaml('key: !reference [.setup, script]', true), { key: ['.setup', 'script'] });
    assert.deepStrictEqual(parseYaml('key: !reference\n  nested: value', true), { key: { nested: 'value' } });
  });

  test('still returns null on genuinely malformed YAML', () => {
    assert.strictEqual(parseYaml('key: "unterminated', true), null);
  });
});

suite('findDocumentWith', () => {
  test('finds the document that owns the requested key, past an earlier document', () => {
    const docs = parseYamlDocuments('spec:\n  inputs: {}\n---\ninclude:\n  - local: a.yml\n', true);
    const includeDoc = findDocumentWith(docs, 'include');
    assert.ok(includeDoc && 'include' in includeDoc);
    const specDoc = findDocumentWith(docs, 'spec');
    assert.ok(specDoc && 'spec' in specDoc);
  });

  test('returns null when no document carries the key', () => {
    const docs = parseYamlDocuments('stages:\n  - build\n', true);
    assert.strictEqual(findDocumentWith(docs, 'include'), null);
  });
});
