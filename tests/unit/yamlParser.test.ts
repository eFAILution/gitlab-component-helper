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
import { parseYamlDocuments, findDocumentWith, isYamlNode } from '../../src/utils/yamlParser';

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

  // GitLab parses with Psych, where `<<: *anchor` merges. Left unmerged, an input inheriting its `default` through
  // an anchor reads as required, and a merged `spec.inputs` offers an input named `<<`.
  test('merges `<<:` into the surrounding mapping', () => {
    const text = `.defaults: &defaults
  stage:
    type: string
    default: build
spec:
  inputs:
    <<: *defaults
    extra:
      type: string
`;
    const docs = parseYamlDocuments(text, true);
    assert.deepStrictEqual(findDocumentWith(docs, 'spec')?.spec, {
      inputs: {
        stage: { type: 'string', default: 'build' },
        extra: { type: 'string' },
      },
    });
  });

  test('merges a sequence of anchors, earlier entries winning', () => {
    const text = `.a: &a
  x: 1
  y: one
.b: &b
  y: two
  z: 3
job:
  <<: [*a, *b]
`;
    const docs = parseYamlDocuments(text, true);
    assert.deepStrictEqual(docs[0].job, { x: 1, y: 'one', z: 3 });
  });

  // YAML 1.1 scalar resolution would make these booleans; all are plausible job or input names.
  test('keeps `y`, `n`, `yes`, `no`, `on`, `off` as string keys', () => {
    const text = 'spec:\n  inputs:\n    y: 1\n    n: 2\n    yes: 3\n    no: 4\n    on: 5\n    off: 6\n';
    const spec = findDocumentWith(parseYamlDocuments(text, true), 'spec')?.spec;
    assert.ok(isYamlNode(spec));
    assert.ok(isYamlNode(spec.inputs));
    assert.deepStrictEqual(Object.keys(spec.inputs), ['y', 'n', 'yes', 'no', 'on', 'off']);
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
