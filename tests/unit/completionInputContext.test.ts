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

  test('returns null when the cursor sits left of the slot indent, even though the line is indented correctly', () => {
    // The slot line has the right 6-space indent, but the cursor has been moved left to column 3 — it is no
    // longer in the name slot, so no completions should be offered.
    const text = `include:
  - component: ${FULL_PIPELINE_URL}
    inputs:
      environment: "dev"
      `;
    assert.strictEqual(findCompletionInputContextAtLine(text, 4, 3), null);
  });

  test('detects the slot when the cursor sits at the slot indent', () => {
    const text = `include:
  - component: ${FULL_PIPELINE_URL}
    inputs:
      environment: "dev"
      `;
    assert.deepStrictEqual(findCompletionInputContextAtLine(text, 4, 6)?.existingInputNames, ['environment']);
  });

  test('detects the slot while a new input name is being typed (bare token would otherwise break the parse)', () => {
    // `env` with no `:` yet is a bare scalar beside the `environment` mapping, so the raw document is invalid YAML.
    // Slot detection tolerates the in-progress name and still reports the already-present inputs.
    const text = `include:
  - component: ${FULL_PIPELINE_URL}
    inputs:
      environment: "dev"
      env`;
    const ctx = findCompletionInputContextAtLine(text, 4, 9);
    assert.deepStrictEqual(ctx, {
      componentUrl: FULL_PIPELINE_URL,
      includeKind: 'component',
      existingInputNames: ['environment'],
    });
  });

  test('detects the slot for the first input while its name is being typed', () => {
    // The in-progress name is the only thing under `inputs:`, so there are no existing inputs yet.
    const text = `include:
  - component: ${FULL_PIPELINE_URL}
    inputs:
      env`;
    const ctx = findCompletionInputContextAtLine(text, 3, 9);
    assert.deepStrictEqual(ctx, {
      componentUrl: FULL_PIPELINE_URL,
      includeKind: 'component',
      existingInputNames: [],
    });
  });

  test('detects the in-progress name slot when it is not at end of document', () => {
    const text = `include:
  - component: ${FULL_PIPELINE_URL}
    inputs:
      environment: "dev"
      env
stages:
  - build`;
    const ctx = findCompletionInputContextAtLine(text, 4, 9);
    assert.deepStrictEqual(ctx?.existingInputNames, ['environment']);
  });

  test('returns null inside a multi-line array input, where a `- item` line is a value not a name slot', () => {
    // An array item nested under an input is deeper-indented than `inputs:` and has no `:`, but it is part of a
    // parameter value — completing input names there would interrupt the array.
    const text = `include:
  - component: ${FULL_PIPELINE_URL}
    inputs:
      tags:
        - one
        - two
      environment: "dev"`;
    const ctx = findCompletionInputContextAtLine(text, 5); // the `- two` array item line
    assert.strictEqual(ctx, null);
  });

  test('returns null when the slot is one column shallower than the existing input keys', () => {
    // Existing keys sit at 6 spaces; a 5-space slot is misaligned (a sibling of `inputs:`), not a name slot.
    const text =
      'include:\n' +
      `  - component: ${FULL_PIPELINE_URL}\n` +
      '    inputs:\n' +
      '      environment: "dev"\n' +
      '     ';
    const ctx = findCompletionInputContextAtLine(text, 4);
    assert.strictEqual(ctx, null);
  });

  test('returns null when the slot is deeper than the existing input keys (a nested value position)', () => {
    // Existing keys sit at 6 spaces; an 8-space slot is nested under a value, not a name slot.
    const text =
      'include:\n' +
      `  - component: ${FULL_PIPELINE_URL}\n` +
      '    inputs:\n' +
      '      environment: "dev"\n' +
      '        ';
    const ctx = findCompletionInputContextAtLine(text, 4);
    assert.strictEqual(ctx, null);
  });

  test('detects a slot aligned with the existing input keys', () => {
    const text =
      'include:\n' +
      `  - component: ${FULL_PIPELINE_URL}\n` +
      '    inputs:\n' +
      '      environment: "dev"\n' +
      '      ';
    const ctx = findCompletionInputContextAtLine(text, 4);
    assert.deepStrictEqual(ctx, {
      componentUrl: FULL_PIPELINE_URL,
      includeKind: 'component',
      existingInputNames: ['environment'],
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

  test('scopes to the second of two identical include', () => {
    const text = `include:
  - component: ${FULL_PIPELINE_URL}
    inputs:
      environment: "dev"
  - component: ${FULL_PIPELINE_URL}
    inputs:
      stage: build
      `;
    const ctx = findCompletionInputContextAtLine(text, 7); // slot under the second (duplicate) include
    assert.deepStrictEqual(ctx, {
      componentUrl: FULL_PIPELINE_URL,
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

  test('quotes a string default only when a bare scalar would not round-trip', () => {
    // Bare-safe values stay bare.
    assert.strictEqual(buildInputInsertValue({ ...base, default: 'a:b' }), 'a:b'); // colon without trailing/space
    assert.strictEqual(buildInputInsertValue({ ...base, default: '1.2.3' }), '1.2.3');
    // Hazards that bare YAML would reinterpret get quoted.
    assert.strictEqual(buildInputInsertValue({ ...base, default: 'ns:' }), '"ns:"'); // trailing colon → mapping
    assert.strictEqual(buildInputInsertValue({ ...base, default: 'a: b' }), '"a: b"'); // `: ` → mapping
    assert.strictEqual(buildInputInsertValue({ ...base, default: 'tag #1' }), '"tag #1"'); // ` #` → comment
    assert.strictEqual(buildInputInsertValue({ ...base, default: '*anchor' }), '"*anchor"'); // leading indicator
    assert.strictEqual(buildInputInsertValue({ ...base, default: ' padded ' }), '" padded "'); // surrounding space
    assert.strictEqual(buildInputInsertValue({ ...base, default: 'true' }), '"true"'); // type-like token
    assert.strictEqual(buildInputInsertValue({ ...base, default: '42' }), '"42"'); // number-like token
    // An inner double quote is harmless in a bare plain scalar (quotes are only special at the start), so it stays bare.
    assert.strictEqual(buildInputInsertValue({ ...base, default: 'say "hi"' }), 'say "hi"');
    // When the value quotes for another reason and also contains a quote, inner quotes are escaped.
    assert.strictEqual(buildInputInsertValue({ ...base, default: '"wrapped"' }), '"\\"wrapped\\""'); // leading quote indicator
  });

  test('renders an array default as a flow sequence, quoting flow-unsafe elements', () => {
    assert.strictEqual(buildInputInsertValue({ ...base, type: 'array', default: ['a', 'b'] }), '[a, b]');
    // A comma is significant inside the flow sequence even though it isn't a leading indicator.
    assert.strictEqual(buildInputInsertValue({ ...base, type: 'array', default: ['a,b', 'c'] }), '["a,b", c]');
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

  test('quotes an options entry only when bare YAML would reinterpret it, leaving others bare', () => {
    assert.strictEqual(buildInputInsertValue({ ...base, options: ['ns:', 'plain'] }), '${1|"ns:",plain|}');
    assert.strictEqual(buildInputInsertValue({ ...base, options: ['true', 'aws'] }), '${1|"true",aws|}');
  });

  test('falls back to a TODO placeholder for a required untyped input', () => {
    assert.strictEqual(buildInputInsertValue({ ...base, required: true }), '${1:TODO set value}');
    assert.strictEqual(buildInputInsertValue({ ...base, required: false }), '${1:}');
  });
});
