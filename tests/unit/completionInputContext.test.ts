// @mocha
/**
 * Imports the real `findCompletionInputContextAtLine` and `buildInputInsertValue` from
 * src/providers/completionInputContext.ts. Covers the pure stages of CompletionProvider's input-completion flow:
 * resolving which `include:` entry's `inputs:` block a cursor sits in (the part that previously broke when an
 * earlier input was a multi-line array), and turning a parameter spec into a snippet body.
 *
 * The cache/local resolution and `vscode.CompletionItem` rendering still live in CompletionProvider and are
 * exercised by the extension-host suite.
 */

import * as assert from 'node:assert/strict';
import {
  findCompletionInputContextAtLine,
  buildInputInsertValue,
} from '../../src/providers/completionInputContext';
import type { ComponentParameter } from '../../src/types/git-component';

const FULL_PIPELINE_URL = 'https://gitlab.com/components/opentofu/full-pipeline@2.6.1';

suite('findCompletionInputContextAtLine', () => {
  test('detects an empty parameter slot under the only include', () => {
    const text = `include:
  - component: ${FULL_PIPELINE_URL}
    inputs:
      environment: "development"
      `;
    const ctx = findCompletionInputContextAtLine(text, 4); // blank, 6-space-indented slot
    assert.deepStrictEqual(ctx, {
      componentUrl: FULL_PIPELINE_URL,
      includeKind: 'component',
      existingInputNames: ['environment'],
    });
  });

  test('detects a slot after a multi-line array input (regression)', () => {
    // An array value's `- item` lines must not be mistaken for the start of the next include entry.
    const text = `include:
  - component: ${FULL_PIPELINE_URL}
    inputs:
      tags:
        - one
        - two
      `;
    const ctx = findCompletionInputContextAtLine(text, 6); // blank slot below the array
    assert.deepStrictEqual(ctx, {
      componentUrl: FULL_PIPELINE_URL,
      includeKind: 'component',
      existingInputNames: ['tags'],
    });
  });

  test('reports existing inputs so the caller can filter them out', () => {
    const text = `include:
  - component: ${FULL_PIPELINE_URL}
    inputs:
      environment: "dev"
      debug: true
      `;
    const ctx = findCompletionInputContextAtLine(text, 5);
    assert.deepStrictEqual(ctx?.existingInputNames, ['environment', 'debug']);
  });

  test('scopes to the closest include when several are present', () => {
    const second = 'https://gitlab.com/my-group/my-component@v1.0.0';
    const text = `include:
  - component: ${FULL_PIPELINE_URL}
    inputs:
      environment: "dev"
  - component: ${second}
    inputs:
      stage: build
      `;
    const ctx = findCompletionInputContextAtLine(text, 7); // slot under the second include
    assert.deepStrictEqual(ctx, {
      componentUrl: second,
      includeKind: 'component',
      existingInputNames: ['stage'],
    });
  });

  test('detects a slot under a `- local:` include and reports includeKind = local', () => {
    const text = `include:
  - local: /templates/nx-test.yml
    inputs:
      stage: build
      `;
    const ctx = findCompletionInputContextAtLine(text, 4);
    assert.deepStrictEqual(ctx, {
      componentUrl: '/templates/nx-test.yml',
      includeKind: 'local',
      existingInputNames: ['stage'],
    });
  });

  test('detects a slot in the mapping form, where include is a single mapping not a list', () => {
    // `include:` as a bare mapping (no leading `- `): `component:` and `inputs:` are siblings at the same indent.
    const text = `include:
  component: ${FULL_PIPELINE_URL}
  inputs:
    environment: "dev"
    `;
    const ctx = findCompletionInputContextAtLine(text, 4); // slot under `inputs:`, indented past it
    assert.deepStrictEqual(ctx, {
      componentUrl: FULL_PIPELINE_URL,
      includeKind: 'component',
      existingInputNames: ['environment'],
    });
  });

  test('detects a slot regardless of the indentation step (threshold is relative to `inputs:`)', () => {
    // 4-space steps rather than the conventional 2 — the slot is a child of `inputs:`, not pinned to 6 columns.
    const text = `include:
    - component: ${FULL_PIPELINE_URL}
      inputs:
          environment: "dev"
          `;
    const ctx = findCompletionInputContextAtLine(text, 4);
    assert.deepStrictEqual(ctx, {
      componentUrl: FULL_PIPELINE_URL,
      includeKind: 'component',
      existingInputNames: ['environment'],
    });
  });

  test('returns null when the cursor is on a complete key: value line', () => {
    const text = `include:
  - component: ${FULL_PIPELINE_URL}
    inputs:
      environment: "development"`;
    const ctx = findCompletionInputContextAtLine(text, 3); // a finished assignment, not a name slot
    assert.strictEqual(ctx, null);
  });

  test('returns null when the slot is too shallow to be an inputs child', () => {
    const text = `include:
  - component: ${FULL_PIPELINE_URL}
    inputs:
      environment: "dev"
    `; // only 4-space indent — sibling of inputs:, not a child
    const ctx = findCompletionInputContextAtLine(text, 4);
    assert.strictEqual(ctx, null);
  });

  test('returns null when the cursor is outside any inputs section', () => {
    const text = `include:
  - component: ${FULL_PIPELINE_URL}
    inputs:
      environment: "dev"
stages:
  - build`;
    const ctx = findCompletionInputContextAtLine(text, 5); // the `- build` stages line
    assert.strictEqual(ctx, null);
  });

  test('returns null when there are no include blocks parsed', () => {
    const text = `stages:
  - build
variables:
  MY_VAR: value`;
    const ctx = findCompletionInputContextAtLine(text, 3);
    assert.strictEqual(ctx, null);
  });
});

suite('buildInputInsertValue', () => {
  const base: ComponentParameter = { name: 'p', description: '', required: false, type: 'string' };

  test('renders a string default bare and stringifies a non-string default', () => {
    assert.strictEqual(buildInputInsertValue({ ...base, default: 'dev' }), 'dev');
    assert.strictEqual(buildInputInsertValue({ ...base, type: 'number', default: 42 }), '42');
    assert.strictEqual(buildInputInsertValue({ ...base, type: 'boolean', default: true }), 'true');
  });

  test('quotes a string default only when it ends in a colon', () => {
    assert.strictEqual(buildInputInsertValue({ ...base, default: 'ns:' }), '"ns:"');
    assert.strictEqual(buildInputInsertValue({ ...base, default: 'a:b' }), 'a:b');
  });

  test('renders an array default as a flow sequence', () => {
    assert.strictEqual(buildInputInsertValue({ ...base, type: 'array', default: ['a', 'b'] }), '[a, b]');
  });

  test('offers both boolean values, leading with the safer one by requiredness', () => {
    assert.strictEqual(buildInputInsertValue({ ...base, type: 'boolean', required: true }), '${1|true,false|}');
    assert.strictEqual(buildInputInsertValue({ ...base, type: 'boolean', required: false }), '${1|false,true|}');
  });

  test('seeds empty literals for array and object inputs', () => {
    assert.strictEqual(buildInputInsertValue({ ...base, type: 'array' }), '${1:[]}');
    assert.strictEqual(buildInputInsertValue({ ...base, type: 'object' }), '${1:{}}');
  });

  test('offers a choice of the allowed values (options), unquoted', () => {
    assert.strictEqual(buildInputInsertValue({ ...base, options: ['aws', 'gcp'] }), '${1|aws,gcp|}');
  });

  test('quotes an options entry only when it ends in a colon, leaving others bare', () => {
    assert.strictEqual(buildInputInsertValue({ ...base, options: ['ns:', 'plain'] }), '${1|"ns:",plain|}');
  });

  test('falls back to a TODO placeholder for a required untyped input', () => {
    assert.strictEqual(buildInputInsertValue({ ...base, required: true }), '${1:TODO set value}');
    assert.strictEqual(buildInputInsertValue({ ...base, required: false }), '${1:}');
  });
});
