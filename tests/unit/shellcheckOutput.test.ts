// @mocha
/**
 * Tests src/utils/shellcheckOutput.ts — argument building, `json1` parsing, GitLab false-positive filtering and
 * mapping findings back to YAML offsets. ShellCheck output is hand-written, so no binary is needed.
 */

import * as assert from 'node:assert/strict';
import { extractLintUnits } from '../../src/utils/shellScriptExtractor';
import {
  buildShellcheckArgs,
  disableDirectiveEdit,
  filterGitLabFalsePositives,
  mapToSource,
  parseShellcheckJson,
  type ShellcheckComment,
} from '../../src/utils/shellcheckOutput';

function comment(overrides: Partial<ShellcheckComment>): ShellcheckComment {
  return { line: 1, endLine: 1, column: 1, endColumn: 2, level: 'warning', code: 2086, message: 'msg', ...overrides };
}

suite('buildShellcheckArgs', () => {
  test('reads stdin as json1 with dialect and severity', () => {
    assert.deepEqual(buildShellcheckArgs({ shell: 'sh', severity: 'info', exclude: [] }), [
      '--format=json1', '--shell=sh', '--severity=info', '-',
    ]);
  });

  test('passes valid exclusions and drops anything else', () => {
    const args = buildShellcheckArgs({ shell: 'bash', severity: 'warning', exclude: ['sc2086', '2034', '--x', 'SC1'] });
    assert.ok(args.includes('--exclude=SC2086,2034'));
    assert.equal(args.length, 5);
  });
});

suite('parseShellcheckJson', () => {
  test('returns well-formed comments', () => {
    const stdout = JSON.stringify({ comments: [comment({ code: 2154 }), { line: 'bad' }] });
    assert.deepEqual(parseShellcheckJson(stdout).map(c => c.code), [2154]);
  });

  test('returns nothing for malformed output', () => {
    assert.deepEqual(parseShellcheckJson('not json'), []);
    assert.deepEqual(parseShellcheckJson('[]'), []);
  });
});

suite('filterGitLabFalsePositives', () => {
  const source = [
    'variables:',
    '  from_yaml: a',
    'build:',
    '  script: echo "$from_yaml $deploy_key $missing"',
  ].join('\n');
  const unit = extractLintUnits(source)[0];
  const unassigned = (name: string) => comment({ code: 2154, message: `${name} is referenced but not assigned.` });

  test('drops SC2154 for variables from the file or configured patterns', () => {
    const kept = filterGitLabFalsePositives(
      unit,
      [unassigned('from_yaml'), unassigned('deploy_key'), unassigned('missing'), comment({ code: 2086 })],
      ['deploy_*'],
    );
    assert.deepEqual(kept.map(c => c.message), ['missing is referenced but not assigned.', 'msg']);
  });

  test('keeps SC2154 whose message does not name a variable', () => {
    assert.equal(filterGitLabFalsePositives(unit, [comment({ code: 2154, message: 'other' })], []).length, 1);
  });

  test('drops SC2034 only in a lone before_script', () => {
    const units = extractLintUnits('default:\n  before_script: x=1\nbuild:\n  script: x=1\n');
    const unused = comment({ code: 2034 });
    assert.equal(filterGitLabFalsePositives(units[0], [unused], []).length, 0);
    assert.equal(filterGitLabFalsePositives(units[1], [unused], []).length, 1);
  });

  test('drops constant-expression findings only on lines with an interpolation', () => {
    const interpolated = extractLintUnits([
      'build:',
      '  script:',
      '    - |',
      '      if [ "$[[ inputs.mode ]]" == "fast" ]; then',
      '        echo $unquoted',
      '      fi',
      '      if [ "literal" == "fast" ]; then echo; fi',
    ].join('\n'))[0];
    const findings = [
      comment({ line: 1, code: 2050 }),
      comment({ line: 1, code: 2086 }),
      comment({ line: 2, code: 2157 }),
      comment({ line: 4, code: 2050 }),
    ];
    assert.deepEqual(
      filterGitLabFalsePositives(interpolated, findings, []).map(c => `${c.line}:${c.code}`),
      ['1:2086', '2:2157', '4:2050'],
    );
  });
});

suite('disableDirectiveEdit', () => {
  test('inserts a directive at the command line indent', () => {
    assert.deepEqual(disableDirectiveEdit('      if [ x ]; then', '    - |', 2050), {
      kind: 'insert',
      text: '      # shellcheck disable=SC2050',
    });
  });

  test('appends to a directive directly above at the same indent', () => {
    assert.deepEqual(disableDirectiveEdit('      echo $x', '      # shellcheck disable=SC2086', 2154), {
      kind: 'replacePrevious',
      text: '      # shellcheck disable=SC2086,SC2154',
    });
  });

  test('does nothing when the code is already disabled', () => {
    assert.equal(disableDirectiveEdit('  echo $x', '  # shellcheck disable=SC2034,2086', 2086), undefined);
  });

  test('inserts rather than appending to a directive at another indent', () => {
    assert.equal(disableDirectiveEdit('        echo $x', '      # shellcheck disable=SC2086', 2154)?.kind, 'insert');
  });
});

suite('mapToSource', () => {
  test('positions a finding on the YAML source span', () => {
    const source = 'build:\n  script:\n    - echo ok\n    - echo $value\n';
    const unit = extractLintUnits(source)[0];
    // Content is "echo ok\necho $value\n"; `$value` is line 2, columns 6-12.
    const [finding] = mapToSource(unit, [comment({ line: 2, endLine: 2, column: 6, endColumn: 12 })]);
    assert.equal(source.slice(finding.start, finding.end), '$value');
  });

  test('drops findings inside an inherited before_script', () => {
    const source = 'default:\n  before_script: echo $a\nbuild:\n  script: echo $b\n';
    const job = extractLintUnits(source)[1];
    assert.equal(mapToSource(job, [comment({ line: 1, column: 6, endColumn: 8 })]).length, 0);
    const [kept] = mapToSource(job, [comment({ line: 2, endLine: 2, column: 6, endColumn: 8 })]);
    assert.equal(source.slice(kept.start, kept.end), '$b');
  });

  test('clips a range that runs past its segment and ignores lines that do not exist', () => {
    const source = 'build:\n  script: echo $tail\n';
    const unit = extractLintUnits(source)[0];
    const [finding] = mapToSource(unit, [comment({ line: 1, endLine: 9, column: 6, endColumn: 1 })]);
    assert.ok(source.slice(finding.start, finding.end).startsWith('$tail'));
    assert.equal(mapToSource(unit, [comment({ line: 9 })]).length, 0);
  });

  test('gives a directive position only inside a literal block, at the start of the command', () => {
    const source = [
      'build:',
      '  script:',
      '    - echo $plain',
      '    - |',
      '      apt-get install \\',
      '        $package',
      '    - >',
      '      echo $folded',
    ].join('\n');
    const unit = extractLintUnits(source)[0];
    // Content lines: 1 "echo $plain", 2 "apt-get install \", 3 "  $package", 4 "echo $folded".
    const [plain, continued, folded] = mapToSource(unit, [
      comment({ line: 1, endLine: 1, column: 6, endColumn: 12 }),
      comment({ line: 3, endLine: 3, column: 3, endColumn: 11 }),
      comment({ line: 4, endLine: 4, column: 6, endColumn: 13 }),
    ]);
    assert.equal(plain.directiveOffset, undefined);
    assert.equal(folded.directiveOffset, undefined);
    assert.ok(continued.directiveOffset !== undefined);
    assert.ok(source.slice(continued.directiveOffset).startsWith('apt-get install'));
  });
});
