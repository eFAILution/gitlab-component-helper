// @mocha
/**
 * Imports the real `findInputContextAtLine` from src/providers/hoverInputContext.ts. Covers the pure detection
 * stage of HoverProvider's component-input-hover flow (parsing `include:`, walking back to the closest `component:`
 * or `local:` line, verifying the cursor sits inside an `inputs:` block at deeper indent).
 *
 * The catalog-resolution + vscode.Hover-rendering stages still live in HoverProvider and are exercised by the
 * extension-host suite.
 */

import * as assert from 'node:assert/strict';
import { findInputContextAtLine } from '../../src/providers/hoverInputContext';

const FULL_PIPELINE_URL = 'https://gitlab.com/components/opentofu/full-pipeline@2.6.1';
const MY_COMPONENT_URL = 'https://gitlab.com/my-group/my-component@v1.0.0';

suite('findInputContextAtLine', () => {
  test('detects a single input under the only include', () => {
    const text = `include:
  - component: ${FULL_PIPELINE_URL}
    inputs:
      environment: "development"
      debug: true
      version: "1.0.0"
stages:
  - build
  - test`;
    const ctx = findInputContextAtLine(text, 3); // environment line
    assert.deepStrictEqual(ctx, {
      inputName: 'environment',
      componentUrl: FULL_PIPELINE_URL,
      includeKind: 'component',
    });
  });

  test('detects a different input on a later line under the same include', () => {
    const text = `include:
  - component: ${FULL_PIPELINE_URL}
    inputs:
      environment: "production"
      debug: false
      timeout: 300
stages:
  - deploy`;
    const ctx = findInputContextAtLine(text, 4); // debug line
    assert.deepStrictEqual(ctx, {
      inputName: 'debug',
      componentUrl: FULL_PIPELINE_URL,
      includeKind: 'component',
    });
  });

  test('detects an input that appears after a multi-line `|` block', () => {
    const text = `include:
  - component: ${MY_COMPONENT_URL}
    inputs:
      complex_param: |
        multi-line
        value
      simple_param: "test"`;
    const ctx = findInputContextAtLine(text, 6); // simple_param line
    assert.deepStrictEqual(ctx, {
      inputName: 'simple_param',
      componentUrl: MY_COMPONENT_URL,
      includeKind: 'component',
    });
  });

  test('detects an input under a `- local:` include and reports includeKind = local', () => {
    const text = `include:
  - local: /templates/nx-test.yml
    inputs:
      stage: build
      timeout: 30`;
    const ctx = findInputContextAtLine(text, 3); // stage line
    assert.deepStrictEqual(ctx, {
      inputName: 'stage',
      componentUrl: '/templates/nx-test.yml',
      includeKind: 'local',
    });
  });

  test('returns null when the line is in a sibling `variables:` block, not `inputs:`', () => {
    const text = `include:
  - component: https://gitlab.com/components/test@1.0.0
variables:
  MY_VAR: "value"
stages:
  - build`;
    const ctx = findInputContextAtLine(text, 3); // MY_VAR line
    assert.strictEqual(ctx, null);
  });

  test('returns null when there are no `include:` blocks parsed', () => {
    const text = `stages:
  - build
variables:
  MY_VAR: value`;
    const ctx = findInputContextAtLine(text, 3);
    assert.strictEqual(ctx, null);
  });

  test('returns null when the current line is not an indented key-value', () => {
    const text = `include:
  - component: ${FULL_PIPELINE_URL}
    inputs:
      environment: "development"`;
    // Line 0 is `include:` itself — not an indented child.
    const ctx = findInputContextAtLine(text, 0);
    assert.strictEqual(ctx, null);
  });
});
