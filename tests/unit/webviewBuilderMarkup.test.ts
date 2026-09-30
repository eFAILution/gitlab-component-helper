// @mocha
/**
 * Guards over what the webview views actually render.
 *
 * The compiler already rejects malformed markup and duplicate attributes, and eslint rejects inline styles, handlers
 * and raw HTML in the view source. These render every view from fixtures and check the properties neither can see:
 * that the output carries no code the CSP would block, that publisher-controlled text stays inert, and that every
 * `data-action` the markup names has a handler in its client script — a missing one is a dead button, not an error.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SourceGroup } from '../../src/providers/componentBrowserTypes';
import { renderDocument } from '../../src/webview/render';
import { ComponentBrowserView } from '../../src/webview/views/ComponentBrowserView';
import { ComponentDetailsView } from '../../src/webview/views/ComponentDetailsView';
import { ErrorsView } from '../../src/webview/views/ErrorsView';
import { ErrorView } from '../../src/webview/views/ErrorView';
import { LoadingView } from '../../src/webview/views/LoadingView';
import { NoSourcesView } from '../../src/webview/views/NoSourcesView';

const CLIENT_DIR = path.resolve(__dirname, '..', '..', 'src', 'webview', 'client');

/** A legal git tag and a legal component description, so a publisher can ship either. */
const HOSTILE = `x"'><img src=x onerror=alert(1)></script><script>alert(2)</script>`;

const assets = (client?: string) => ({
  cspSource: 'vscode-webview://origin',
  nonce: 'NONCE123',
  styleUri: 'vscode-webview://origin/styles/view.css',
  scriptUri: client && `vscode-webview://origin/client/${client}.js`,
});

const SOURCES: SourceGroup[] = [{
  source: 'Main', type: 'source', isExpanded: true, totalComponents: 2, totalVersions: 3, projectCount: 1,
  componentCount: 2,
  projects: [{
    name: 'proj', path: 'group/proj', gitlabInstance: 'gitlab.com', type: 'project', isExpanded: false,
    components: [
      {
        name: HOSTILE, description: `**bold** ${HOSTILE}`, parameters: [], source: 'Main', sourcePath: 'group/proj',
        gitlabInstance: 'gitlab.com', documentationUrl: '', versionCount: 2, defaultVersion: `${HOSTILE}-2`,
        availableVersions: [`${HOSTILE}-1`, `${HOSTILE}-2`], tagPattern: '{name}-{version}',
        versions: [{
          version: HOSTILE, description: HOSTILE, parameters: [], documentationUrl: '', source: 'Main',
          sourcePath: 'group/proj', gitlabInstance: 'gitlab.com',
        }],
      },
      {
        name: 'unloaded', description: '', parameters: [], source: 'Main', sourcePath: 'group/proj',
        gitlabInstance: 'gitlab.com', documentationUrl: '', versionCount: 0, defaultVersion: '', availableVersions: [],
        versions: [],
      },
    ],
  }],
}];

const VERSION_DATA = { [HOSTILE]: { [HOSTILE]: { description: HOSTILE } } };

/** Every view, rendered with fixtures that exercise each optional section, and the client script it loads. */
const VIEWS: Record<string, { html: string; client?: string }> = {
  loading: { html: renderDocument(LoadingView, assets()) },
  noSources: { html: renderDocument(NoSourcesView, assets('noSources')), client: 'noSources' },
  errors: {
    html: renderDocument(ErrorsView, {
      ...assets('errors'),
      errors: [{ source: HOSTILE, summary: HOSTILE, raw: HOSTILE }],
      hasAuthError: true,
    }),
    client: 'errors',
  },
  error: {
    html: renderDocument(ErrorView, { ...assets('errors'), message: HOSTILE, authSummary: HOSTILE }),
    client: 'errors',
  },
  browser: {
    html: renderDocument(ComponentBrowserView, {
      ...assets('componentBrowser'),
      sources: SOURCES,
      cacheErrors: [{ source: HOSTILE, summary: HOSTILE, raw: HOSTILE }],
      hasAuthError: true,
      versionData: VERSION_DATA,
    }),
    client: 'componentBrowser',
  },
  details: {
    html: renderDocument(ComponentDetailsView, {
      ...assets('componentDetails'),
      name: HOSTILE, description: HOSTILE, summary: HOSTILE, usage: HOSTILE, notes: [HOSTILE], rawYaml: HOSTILE,
      source: HOSTILE, gitlabInstance: HOSTILE, version: `${HOSTILE}-1`,
      availableVersions: [`${HOSTILE}-1`, `${HOSTILE}-2`], tagPattern: '{name}-{version}', url: HOSTILE,
      parameters: [{ name: HOSTILE, description: HOSTILE, required: true, type: HOSTILE, default: HOSTILE }],
      safeDocUrl: 'https://docs.example.com/?a=1&b=2', safeTemplateUrl: 'https://gitlab.com/t.yml',
    }),
    client: 'componentDetails',
  },
};

/** Inline code the document's nonce CSP blocks, so it would silently not run. */
const INLINE_CODE: Record<string, RegExp> = {
  'inline <script>': /<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>/,
  'inline <style>': /<style[\s>]/,
  'inline event handler': /<[a-z][^>]*\son[a-z]+=/i,
  'inline style attribute': /<[a-z][^>]*\sstyle=/i,
};

/** The `data-action` names a client script dispatches on, read from its source. */
function handledActions(client: string): Set<string> {
  const source = fs.readFileSync(path.join(CLIENT_DIR, `${client}.ts`), 'utf8');
  const actions = new Set<string>();
  // `const ACTIONS = { name: …, name, … }` and `const COMMANDS = { name: '…' }`: keys at the start of a line.
  const map = source.match(/const (?:ACTIONS|COMMANDS)\b[^\n]*\{\n([\s\S]*?)\n\};/);
  for (const [, key] of map?.[1].matchAll(/^ {2}([a-zA-Z]+)\s*[:,]/gm) ?? []) {
    actions.add(key);
  }
  // Actions matched by comparison rather than through the map, e.g. `action === 'toggleDetails'`.
  for (const [, key] of source.matchAll(/action === '([a-zA-Z]+)'/g)) {
    actions.add(key);
  }
  for (const [, key] of source.matchAll(/\[data-action="([a-zA-Z]+)"\]/g)) {
    actions.add(key);
  }
  return actions;
}

suite('webview views', () => {
  for (const [name, { html, client }] of Object.entries(VIEWS)) {
    suite(name, () => {
      test('carries no inline code the CSP would block', () => {
        const found = Object.entries(INLINE_CODE).filter(([, pattern]) => pattern.test(html)).map(([kind]) => kind);
        assert.deepEqual(found, []);
      });

      test('sets the CSP and nonces every script', () => {
        assert.match(html, /^<!doctype html><html lang="en"><head>/);
        assert.match(
          html,
          /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; [^"]*'nonce-NONCE123';"/,
        );
        for (const [tag] of html.matchAll(/<script[^>]*>/g)) {
          assert.match(tag, /\snonce="NONCE123"/, tag);
        }
      });

      test('keeps publisher text inert', () => {
        assert.doesNotMatch(html, /<img/);
        assert.doesNotMatch(html, /<script>alert/);
      });

      if (client) {
        test(`every data-action has a handler in client/${client}.ts`, () => {
          const handled = handledActions(client);
          const unhandled = [...new Set([...html.matchAll(/data-action="([^"]+)"/g)].map(match => match[1]))]
            .filter(action => !handled.has(action));
          assert.deepEqual(unhandled, [], `no handler for: ${unhandled.join(', ')}`);
        });
      }
    });
  }

  test('finds the handlers it is meant to check against', () => {
    // If the client scripts stopped matching `handledActions`, every handler test would fail loudly, but a view whose
    // markup lost its data-actions would pass vacuously.
    assert.ok(handledActions('componentBrowser').size >= 10);
    assert.ok([...VIEWS.browser.html.matchAll(/data-action=/g)].length >= 10);
  });
});

suite('bootstrap data', () => {
  const json = (html: string, id: string) => {
    const match = html.match(new RegExp(`<script type="application/json" id="${id}" nonce="NONCE123">(.*?)</script>`));
    assert.ok(match, `no #${id} block`);
    return JSON.parse(match[1]);
  };

  test('the browser version data round-trips, including a closing script tag', () => {
    assert.deepEqual(json(VIEWS.browser.html, 'component-version-data'), VERSION_DATA);
  });

  test('the details panel reports its version list as loaded', () => {
    assert.deepEqual(json(VIEWS.details.html, 'details-bootstrap'), { loaded: true });
  });
});

suite('component details link handling', () => {
  const client = fs.readFileSync(path.join(CLIENT_DIR, 'componentDetails.ts'), 'utf8');

  test('the client script never assigns a URL to a navigable property', () => {
    // Component metadata reaches this script by message and is attacker-influenced (`documentation_url` is set by
    // whoever publishes the component). Links are opened by the extension host instead, so there must be no sink here.
    assert.doesNotMatch(client, /\.(href|src|action)\s*=/);
    assert.doesNotMatch(client, /\b(location|window\.open)\b/);
  });

  test('the view never puts a metadata URL in an href', () => {
    const hrefs = [...VIEWS.details.html.matchAll(/href="([^"]*)"/g)].map(match => match[1]);
    assert.deepEqual(hrefs.filter(href => href !== '#' && !href.startsWith('vscode-webview://')), []);
    assert.match(VIEWS.details.html, />https:\/\/docs\.example\.com\/\?a=1&amp;b=2</);
  });
});
