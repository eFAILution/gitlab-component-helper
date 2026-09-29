// @mocha
/**
 * Guards the built webview assets under out/webview.
 *
 * The HTML builders live on a class that imports `vscode` and cannot be loaded here, so these assert on the build
 * output instead — which is what the webview actually loads, and where an escaping or bundling fault would show up.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const OUT_DIR = path.resolve(__dirname, '..', '..', 'out', 'webview');

/** Client scripts expected to be emitted, without the extension. */
const CLIENT_SCRIPTS = ['errors', 'noSources'];

/** Stylesheets expected to be emitted, without the extension. */
const STYLESHEETS = ['errors', 'loading', 'noSources'];

function read(relativePath: string): string {
  return fs.readFileSync(path.join(OUT_DIR, relativePath), 'utf8');
}

suite('built webview assets', function () {
  suiteSetup(function () {
    // `npm test` runs after `pretest` compiles, but skip rather than fail if the suite is run standalone.
    if (!fs.existsSync(OUT_DIR)) {
      this.skip();
    }
  });

  for (const name of STYLESHEETS) {
    test(`styles/${name}.css is emitted and non-empty`, () => {
      assert.ok(read(`styles/${name}.css`).trim().length > 0);
    });
  }

  for (const name of CLIENT_SCRIPTS) {
    test(`client/${name}.js is emitted as a self-contained IIFE`, () => {
      const script = read(`client/${name}.js`);
      // `format: 'iife'` keeps each script from leaking globals into the document or colliding with another.
      assert.match(script, /^"use strict";\n\(\(\) => \{/);
      // A bare `export`/`import` would mean the bundle needs `type="module"`, which the `<script>` tag does not set.
      assert.doesNotMatch(script, /^\s*(export|import)\s/m);
    });
  }

  test('no declaration file is emitted as an asset', () => {
    const emitted = fs.readdirSync(path.join(OUT_DIR, 'client'));
    assert.deepEqual(emitted.filter(file => file.includes('.d.')), []);
  });

  test('stylesheets carry no sourceMappingURL pointing at a separate file', () => {
    // A sibling .map is fetched by the webview and blocked by `default-src 'none'`; inline maps are fine.
    for (const name of STYLESHEETS) {
      const css = read(`styles/${name}.css`);
      const reference = css.match(/sourceMappingURL=(\S+)/);
      if (reference) {
        assert.ok(
          reference[1].startsWith('data:'),
          `${name}.css should inline its sourcemap, got ${reference[1]}`,
        );
      }
    }
  });
});
