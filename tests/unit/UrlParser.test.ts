// @mocha
/**
 * URL Parsing Tests
 *
 * Imports the real UrlParser from src/. tsx (configured in .mocharc.cjs)
 * loads this TypeScript file directly so we exercise production code and
 * get static type-checking against ParsedComponentUrl.
 */

import * as assert from 'node:assert/strict';
import { UrlParser, ParsedComponentUrl } from '../../src/services/component/urlParser';

suite('UrlParser.parseCustomComponentUrl', () => {
  const parser = new UrlParser();

  test('parses gitlab.com URL with version', () => {
    const expected: ParsedComponentUrl = {
      gitlabInstance: 'gitlab.com',
      path: 'components/opentofu',
      name: 'full-pipeline',
      version: '2.9.0',
    };
    assert.deepStrictEqual(
      parser.parseCustomComponentUrl('https://gitlab.com/components/opentofu/full-pipeline@2.9.0'),
      expected
    );
  });

  test('parses self-hosted URL without version', () => {
    const expected: ParsedComponentUrl = {
      gitlabInstance: 'gitlab.example.com',
      path: 'group/project',
      name: 'my-component',
      version: undefined,
    };
    assert.deepStrictEqual(
      parser.parseCustomComponentUrl('https://gitlab.example.com/group/project/my-component'),
      expected
    );
  });

  test('parses simple component URL with @latest', () => {
    const expected: ParsedComponentUrl = {
      gitlabInstance: 'gitlab.com',
      path: 'user',
      name: 'simple-component',
      version: 'latest',
    };
    assert.deepStrictEqual(
      parser.parseCustomComponentUrl('https://gitlab.com/user/simple-component@latest'),
      expected
    );
  });

  test('returns null for paths with fewer than 2 segments', () => {
    assert.strictEqual(parser.parseCustomComponentUrl('https://gitlab.com/lonely'), null);
  });

  test('project-only shorthand defaults name and version to main', () => {
    const expected: ParsedComponentUrl = {
      gitlabInstance: 'gitlab.com',
      path: 'group/project',
      name: 'main',
      version: 'main',
    };
    assert.deepStrictEqual(
      parser.parseCustomComponentUrl('https://gitlab.com/group/project'),
      expected
    );
  });
});

suite('UrlParser.cleanGitLabInstance', () => {
  const parser = new UrlParser();

  test('strips https:// prefix', () => {
    assert.strictEqual(parser.cleanGitLabInstance('https://gitlab.com'), 'gitlab.com');
  });

  test('strips http:// prefix', () => {
    assert.strictEqual(parser.cleanGitLabInstance('http://gitlab.local'), 'gitlab.local');
  });

  test('leaves bare hostname untouched', () => {
    assert.strictEqual(parser.cleanGitLabInstance('gitlab.example.com'), 'gitlab.example.com');
  });
});
