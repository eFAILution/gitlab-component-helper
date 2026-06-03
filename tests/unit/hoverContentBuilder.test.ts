// @mocha
/**
 * Tests src/providers/hoverContentBuilder.ts — the pure markdown body the hover popup emits when the cursor sits
 * on a `- component:` include.
 */

import * as assert from 'node:assert/strict';
import type { Component } from '../../src/providers/componentDetector';
import { buildComponentHoverMarkdown } from '../../src/providers/hoverContentBuilder';

const HOVER_CONTEXT = {
  documentUri: 'file:///workspace/.gitlab-ci.yml',
  position: { line: 4, character: 12 },
};

function baseComponent(overrides: Partial<Component> = {}): Component {
  return {
    name: 'deploy',
    description: 'Deploys a service to the target environment',
    parameters: [],
    ...overrides,
  };
}

suite('buildComponentHoverMarkdown — title + detach link', () => {
  test('emits a level-2 heading with the component name', () => {
    const md = buildComponentHoverMarkdown(baseComponent({ name: 'my-component' }), HOVER_CONTEXT);
    assert.ok(md.startsWith('## my-component\n\n'), md);
  });

  test('emits the detach link with the JSON-encoded component + cursor context', () => {
    const md = buildComponentHoverMarkdown(baseComponent(), HOVER_CONTEXT);
    const detachLineMatch = md.match(/\[🔗 Open in Detailed View\]\((command:[^\)]+)\)/);
    assert.ok(detachLineMatch, 'detach link markdown missing');
    const url = detachLineMatch[1];
    assert.ok(url.startsWith('command:gitlab-component-helper.detachHover?'));

    // The query string is the URL-encoded JSON payload — decode and check shape.
    const payloadJson = decodeURIComponent(url.split('?')[1]);
    const payload = JSON.parse(payloadJson);
    assert.strictEqual(payload.name, 'deploy');
    assert.deepStrictEqual(payload._hoverContext, HOVER_CONTEXT);
  });
});

suite('buildComponentHoverMarkdown — description', () => {
  test('emits the description verbatim', () => {
    const md = buildComponentHoverMarkdown(
      baseComponent({ description: 'Custom description text' }),
      HOVER_CONTEXT,
    );
    assert.ok(md.includes('Custom description text\n\n'), md);
  });

  test('still emits the spacer when description is empty', () => {
    // The spacer keeps the source/version/parameters sections aligned with production's layout.
    const md = buildComponentHoverMarkdown(baseComponent({ description: '' }), HOVER_CONTEXT);
    // Detach link is followed by "\n\n" + description ("") + "\n\n", so the body has four consecutive newlines
    // between the detach link and whatever comes next.
    assert.match(md, /Open in Detailed View\]\([^)]+\)\n\n\n\n/);
  });
});

suite('buildComponentHoverMarkdown — source line', () => {
  test('renders a clickable template-file URL when context + templatePath are present', () => {
    const md = buildComponentHoverMarkdown(
      baseComponent({
        context: { gitlabInstance: 'gitlab.com', path: 'group/project' },
        version: 'v1.2.3',
        templatePath: 'templates/deploy.yml',
      }),
      HOVER_CONTEXT,
    );
    assert.ok(
      md.includes(
        '**Source:** [https://gitlab.com/group/project/-/blob/v1.2.3/templates/deploy.yml]' +
          '(https://gitlab.com/group/project/-/blob/v1.2.3/templates/deploy.yml)',
      ),
      md,
    );
  });

  test('falls back to plain `<instance>/<path>` when context is set but templatePath is missing', () => {
    const md = buildComponentHoverMarkdown(
      baseComponent({
        context: { gitlabInstance: 'gitlab.example.com', path: 'team/repo' },
      }),
      HOVER_CONTEXT,
    );
    assert.ok(md.includes('**Source:** gitlab.example.com/team/repo\n\n'), md);
  });

  test('falls back to the bare `source` string when context is absent', () => {
    const md = buildComponentHoverMarkdown(
      baseComponent({ source: 'gitlab.com/legacy/project' }),
      HOVER_CONTEXT,
    );
    assert.ok(md.includes('**Source:** gitlab.com/legacy/project\n\n'), md);
  });

  test('omits the source line entirely when neither context nor source is set', () => {
    const md = buildComponentHoverMarkdown(baseComponent(), HOVER_CONTEXT);
    assert.ok(!md.includes('**Source:**'), md);
  });
});

suite('buildComponentHoverMarkdown — version line', () => {
  test('emits **Version:** when set', () => {
    const md = buildComponentHoverMarkdown(baseComponent({ version: '2.1.0' }), HOVER_CONTEXT);
    assert.ok(md.includes('**Version:** 2.1.0\n\n'), md);
  });

  test('omits the version line when version is absent', () => {
    const md = buildComponentHoverMarkdown(baseComponent(), HOVER_CONTEXT);
    assert.ok(!md.includes('**Version:**'), md);
  });
});

suite('buildComponentHoverMarkdown — parameters table', () => {
  test('emits the header + separator + one row per parameter', () => {
    const md = buildComponentHoverMarkdown(
      baseComponent({
        parameters: [
          { name: 'environment', description: 'Target env', required: true, type: 'string' },
          { name: 'debug', description: 'Enable debug', required: false, type: 'boolean', default: false },
          { name: 'timeout', description: 'Seconds', required: false, type: 'number', default: 30 },
        ],
      }),
      HOVER_CONTEXT,
    );
    assert.ok(md.includes('### Parameters\n\n'), md);
    assert.ok(md.includes('| Name | Description | Required | Default |\n'), md);
    assert.ok(md.includes('| ---- | ----------- | -------- | ------- |\n'), md);
    assert.ok(md.includes('| environment | Target env | Yes | - |\n'), md);
    assert.ok(md.includes('| debug | Enable debug | No | `false` |\n'), md);
    assert.ok(md.includes('| timeout | Seconds | No | `30` |\n'), md);
  });

  test('omits the section entirely when there are no parameters', () => {
    const md = buildComponentHoverMarkdown(baseComponent({ parameters: [] }), HOVER_CONTEXT);
    assert.ok(!md.includes('### Parameters'), md);
  });

  test('renders the default column as `-` when default is undefined, backticked when set', () => {
    const md = buildComponentHoverMarkdown(
      baseComponent({
        parameters: [
          { name: 'required_no_default', description: '', required: true, type: 'string' },
          { name: 'with_default', description: '', required: false, type: 'string', default: 'prod' },
        ],
      }),
      HOVER_CONTEXT,
    );
    assert.ok(md.includes('| required_no_default |  | Yes | - |\n'), md);
    assert.ok(md.includes('| with_default |  | No | `prod` |\n'), md);
  });
});
