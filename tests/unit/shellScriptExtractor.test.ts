// @mocha
/**
 * Tests src/utils/shellScriptExtractor.ts — which YAML keys count as job shell, how blocks share a shell, and that
 * every content character maps back to its source offset across scalar styles.
 */

import * as assert from 'node:assert/strict';
import { extractLintUnits, maskComponentInterpolation, type LintUnit } from '../../src/utils/shellScriptExtractor';

/**
 * @param source - YAML text.
 * @param unit - A unit extracted from it.
 * @param needle - Text expected once in the unit's content.
 * @returns The source text at the offsets of `needle`'s first and last characters, inclusive.
 */
function sourceOf(source: string, unit: LintUnit, needle: string): string {
  const index = unit.content.indexOf(needle);
  assert.notEqual(index, -1, `'${needle}' not in content: ${JSON.stringify(unit.content)}`);
  return source.slice(unit.offsets[index], unit.offsets[index + needle.length - 1] + 1);
}

function only(units: LintUnit[]): LintUnit {
  assert.equal(units.length, 1, `expected one unit, got ${units.map(u => JSON.stringify(u.content)).join(', ')}`);
  return units[0];
}

suite('extractLintUnits: job-level rule', () => {
  test('ignores a spec input named script in a component template', () => {
    const source = [
      'spec:',
      '  inputs:',
      '    script:',
      '      description: not shell',
      '      type: string',
      '---',
      'build:',
      '  script:',
      '    - echo "real script"',
    ].join('\n');
    const unit = only(extractLintUnits(source));
    assert.equal(unit.content, 'echo "real script"\n');
  });

  test('ignores script keys under include inputs and variables', () => {
    const source = [
      'include:',
      '  - component: example.com/group/project/thing@1.0.0',
      '    inputs:',
      '      script: echo not-linted',
      'variables:',
      '  script: echo not-linted',
    ].join('\n');
    assert.deepEqual(extractLintUnits(source), []);
  });

  test('ignores script keys nested deeper inside a job', () => {
    const source = ['build:', '  trigger:', '    script: echo not-linted', '  script: echo linted'].join('\n');
    assert.equal(only(extractLintUnits(source)).content, 'echo linted\n');
  });

  test('lints hidden jobs, interpolated job names, default and legacy globals', () => {
    const source = [
      'before_script: echo global',
      'default:',
      '  after_script: echo default',
      '.template:',
      '  script: echo hidden',
      '$[[ inputs.job_name ]]:',
      '  script: echo interpolated',
    ].join('\n');
    // The legacy global before_script prefixes each job as unreportable context.
    const contents = extractLintUnits(source).map(unit => unit.content);
    assert.deepEqual(contents, [
      'echo global\n',
      'echo default\n',
      'echo global\necho hidden\n',
      'echo global\necho interpolated\n',
    ]);
  });

  test('skips a document that fails to parse', () => {
    assert.deepEqual(extractLintUnits('build:\n  script: [unterminated\n'), []);
  });

  test('lints a file whose jobs use several merge keys', () => {
    const source = [
      '.base: &base',
      '  stage: deploy',
      '.extra: &extra',
      '  when: manual',
      'rollout:',
      '  <<: *base',
      '  <<: *extra',
      '  script: echo $rollout',
    ].join('\n');
    assert.deepEqual(extractLintUnits(source).map(unit => unit.content), ['echo $rollout\n']);
  });
});

suite('extractLintUnits: shell boundaries', () => {
  test('joins sequence items, flattening nested sequences', () => {
    const source = ['build:', '  script:', '    - echo one', '    - - echo two', '      - echo three'].join('\n');
    assert.equal(only(extractLintUnits(source)).content, 'echo one\necho two\necho three\n');
  });

  test('skips !reference tags and aliases', () => {
    const source = [
      '.shared: &shared echo anchored',
      'build:',
      '  script:',
      '    - !reference [.other, script]',
      '    - *shared',
      '    - echo kept',
    ].join('\n');
    assert.equal(only(extractLintUnits(source)).content, 'echo kept\n');
  });

  test('puts a job before_script and script in one unit, after_script in its own', () => {
    const source = [
      'build:',
      '  before_script: setup=1',
      '  script: echo "$setup"',
      '  after_script: echo done',
    ].join('\n');
    const units = extractLintUnits(source);
    assert.deepEqual(units.map(u => u.content), ['setup=1\necho "$setup"\n', 'echo done\n']);
    assert.ok(units[0].segments.every(s => s.reportable));
  });

  test('prefixes an inherited default before_script as unreportable context', () => {
    const source = ['default:', '  before_script: setup=1', 'build:', '  script: echo "$setup"'].join('\n');
    const [defaults, job] = extractLintUnits(source);
    assert.equal(defaults.content, 'setup=1\n');
    assert.equal(defaults.continuesInScript, true);
    assert.equal(job.content, 'setup=1\necho "$setup"\n');
    assert.deepEqual(job.segments.map(s => s.reportable), [false, true]);
    assert.equal(job.continuesInScript, false);
  });

  test('prefers a same-file extends template before_script over default', () => {
    const source = [
      'default:',
      '  before_script: from_default=1',
      '.template:',
      '  before_script: from_template=1',
      'build:',
      '  extends: .template',
      '  script: echo hi',
    ].join('\n');
    const job = extractLintUnits(source).find(u => u.content.endsWith('echo hi\n'));
    assert.equal(job?.content, 'from_template=1\necho hi\n');
  });

  test('honours inherit:default false', () => {
    const source = [
      'default:',
      '  before_script: setup=1',
      'build:',
      '  inherit:',
      '    default: false',
      '  script: echo hi',
    ].join('\n');
    assert.equal(extractLintUnits(source)[1].content, 'echo hi\n');
  });
});

suite('extractLintUnits: source offsets', () => {
  test('maps literal block lines, including extra indentation', () => {
    const source = ['build:', '  script:', '    - |', '      echo $first', '        echo $second'].join('\n');
    const unit = only(extractLintUnits(source));
    assert.equal(sourceOf(source, unit, '$first'), '$first');
    assert.equal(sourceOf(source, unit, '$second'), '$second');
  });

  test('maps single- and double-quoted scalars, including escapes', () => {
    const source = ['build:', '  script:', "    - 'it''s $single'", '    - "say \\"hi\\" $double"'].join('\n');
    const unit = only(extractLintUnits(source));
    assert.equal(sourceOf(source, unit, '$single'), '$single');
    assert.equal(sourceOf(source, unit, '$double'), '$double');
    assert.equal(sourceOf(source, unit, '"hi'), '\\"hi');
  });

  test('maps multi-line plain and folded scalars to their own source lines', () => {
    const source = [
      'build:',
      '  script:',
      '    - echo $plain_one',
      '      $plain_two',
      '    - >',
      '      echo $folded_one',
      '      $folded_two',
    ].join('\n');
    const unit = only(extractLintUnits(source));
    for (const name of ['$plain_one', '$plain_two', '$folded_one', '$folded_two']) {
      assert.equal(sourceOf(source, unit, name), name);
    }
  });

  test('maps an inline script value', () => {
    const source = 'build:\n  script: echo $inline\n';
    assert.equal(sourceOf(source, only(extractLintUnits(source)), '$inline'), '$inline');
  });

  test('maps CRLF sources', () => {
    const source = 'build:\r\n  script:\r\n    - |\r\n      echo $one\r\n      echo $two\r\n';
    const unit = only(extractLintUnits(source));
    assert.equal(sourceOf(source, unit, '$two'), '$two');
  });
});

suite('maskComponentInterpolation', () => {
  test('replaces interpolation with same-length underscores', () => {
    const text = 'deploy --env $[[ inputs.env ]] --x "$[[ inputs.y | expand_vars ]]"';
    const masked = maskComponentInterpolation(text);
    assert.equal(masked.length, text.length);
    assert.ok(!masked.includes('$[['));
    assert.ok(masked.startsWith('deploy --env ____'));
  });

  test('is applied to extracted content without moving offsets', () => {
    const source = 'build:\n  script: echo $[[ inputs.name ]] $after\n';
    const unit = only(extractLintUnits(source));
    assert.ok(!unit.content.includes('$[['));
    assert.equal(sourceOf(source, unit, '$after'), '$after');
  });

  test('records where each interpolation was masked', () => {
    const source = 'build:\n  script: echo $[[ inputs.a ]] x $[[ inputs.b ]]\n';
    const unit = only(extractLintUnits(source));
    assert.deepEqual(
      unit.interpolations.map(range => source.slice(unit.offsets[range.start], unit.offsets[range.end - 1] + 1)),
      ['$[[ inputs.a ]]', '$[[ inputs.b ]]'],
    );
  });
});

suite('extractLintUnits: literal blocks', () => {
  test('records content from | blocks only', () => {
    const source = [
      'build:',
      '  script:',
      '    - echo plain',
      '    - |',
      '      echo literal',
      '    - >',
      '      echo folded',
    ].join('\n');
    const unit = only(extractLintUnits(source));
    assert.deepEqual(unit.literalBlocks.map(range => unit.content.slice(range.start, range.end)), ['echo literal\n']);
  });
});
