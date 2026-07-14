// @mocha
/**
 * Tests src/services/component/readmeDescription.ts — the pure helpers that derive a component description
 * from its README.
 * */

import * as assert from 'node:assert/strict';
import {
  firstParagraph,
  readmeDirForTemplate,
  stripHtmlComments,
} from '../../src/services/component/readmeDescription';

suite('stripHtmlComments', () => {
  test('removes a simple comment', () => {
    assert.equal(stripHtmlComments('before<!-- x -->after'), 'beforeafter');
  });

  test('removes multiple and adjacent comments', () => {
    assert.equal(stripHtmlComments('a<!--1-->b<!--2-->c'), 'abc');
    assert.equal(stripHtmlComments('<!--x--><!--y-->keep'), 'keep');
  });

  test('leaves no residual <!-- on nested / overlapping markers', () => {
    for (const input of [
      '<!--<!-- -->-->',
      '<!--a<!--b-->c-->description',
      'before<!-- x -->after<!--',
    ]) {
      assert.ok(!stripHtmlComments(input).includes('<!--'), `residual opener for: ${input}`);
    }
  });

  test('drops the remainder of an unterminated comment', () => {
    assert.equal(stripHtmlComments('<!-- open but never closed'), '');
    assert.equal(stripHtmlComments('keep<!-- dangling'), 'keep');
  });

  test('passes clean prose through unchanged', () => {
    assert.equal(stripHtmlComments('Just a normal paragraph.'), 'Just a normal paragraph.');
  });
});

suite('firstParagraph', () => {
  test('returns undefined for missing or empty input', () => {
    assert.equal(firstParagraph(undefined), undefined);
    assert.equal(firstParagraph(''), undefined);
    assert.equal(firstParagraph('   \n\n  '), undefined);
  });

  test('skips a leading H1 title and returns the first prose paragraph', () => {
    const readme = '# Markdown lint CI Check\n\nRuns markdownlint on modified files.\n\n## Usage\n\n...';
    assert.equal(firstParagraph(readme), 'Runs markdownlint on modified files.');
  });

  test('skips a leading HTML comment block', () => {
    const readme = '<!-- a toc comment -->\n\nActual description here.';
    assert.equal(firstParagraph(readme), 'Actual description here.');
  });

  test('skips a badge/image-only block', () => {
    const readme = '# Title\n\n![build](https://ci/badge.svg)[![cov](https://c/b.svg)](https://c)\n\nReal prose.';
    assert.equal(firstParagraph(readme), 'Real prose.');
  });

  test('drops a heading line and keeps the prose in the same block', () => {
    assert.equal(firstParagraph('## Overview\nSome text'), 'Some text');
  });

  test('keeps prose when a H1 shares a block with it (no blank line between)', () => {
    assert.equal(firstParagraph('# Title\nDescription on next line'), 'Description on next line');
  });

  test('returns undefined when there is no usable prose', () => {
    assert.equal(firstParagraph('# Only A Title'), undefined);
  });
});

suite('readmeDirForTemplate', () => {
  test('returns the directory for a directory-form template', () => {
    assert.equal(readmeDirForTemplate('templates/markdown-lint/template.yml'), 'templates/markdown-lint');
  });

  test('returns empty string for a flat single-file template', () => {
    assert.equal(readmeDirForTemplate('templates/deploy.yml'), '');
  });

  test('returns empty string for a missing path', () => {
    assert.equal(readmeDirForTemplate(undefined), '');
  });
});
