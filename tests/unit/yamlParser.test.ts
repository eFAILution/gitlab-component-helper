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
import { parseYamlDocuments, findDocumentWith } from '../../src/utils/yamlParser';

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
