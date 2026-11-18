import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as oniguruma from 'vscode-oniguruma';
import * as vsctm from 'vscode-textmate';

// The injection rides on whichever source.yaml grammar is active plus VS Code's shell grammar. Red Hat YAML (in this
// extension's extensionPack) replaces VS Code's YAML grammar, so every test runs against both. The built-in grammars
// come from the VS Code under test; Red Hat's is a pinned copy.
const BUILTIN = path.join(vscode.env.appRoot, 'extensions');
const REPO = path.resolve(__dirname, '..', '..');
const INJECTION_SCOPE = 'source.yaml.gitlab-ci-script.injection';
const HEREDOC_INJECTION_SCOPE = 'source.yaml.gitlab-ci-script-heredoc.injection';
const CONTINUATION_INJECTION_SCOPE = 'source.yaml.gitlab-ci-script-continuation.injection';

const SHARED_GRAMMARS: Record<string, string> = {
  'source.yaml.1.0': path.join(BUILTIN, 'yaml', 'syntaxes', 'yaml-1.0.tmLanguage.json'),
  'source.yaml.1.1': path.join(BUILTIN, 'yaml', 'syntaxes', 'yaml-1.1.tmLanguage.json'),
  'source.yaml.1.2': path.join(BUILTIN, 'yaml', 'syntaxes', 'yaml-1.2.tmLanguage.json'),
  'source.yaml.1.3': path.join(BUILTIN, 'yaml', 'syntaxes', 'yaml-1.3.tmLanguage.json'),
  'source.yaml.embedded': path.join(BUILTIN, 'yaml', 'syntaxes', 'yaml-embedded.tmLanguage.json'),
  'source.shell': path.join(BUILTIN, 'shellscript', 'syntaxes', 'shell-unix-bash.tmLanguage.json'),
  [INJECTION_SCOPE]: path.join(REPO, 'syntaxes', 'gitlab-ci-script.injection.tmLanguage.json'),
  [HEREDOC_INJECTION_SCOPE]: path.join(REPO, 'syntaxes', 'gitlab-ci-script-heredoc.injection.tmLanguage.json'),
  [CONTINUATION_INJECTION_SCOPE]: path.join(REPO, 'syntaxes', 'gitlab-ci-script-continuation.injection.tmLanguage.json'),
};

const INJECTIONS = [INJECTION_SCOPE, HEREDOC_INJECTION_SCOPE, CONTINUATION_INJECTION_SCOPE];

const YAML_GRAMMARS = [
  { name: 'VS Code YAML grammar', file: path.join(BUILTIN, 'yaml', 'syntaxes', 'yaml.tmLanguage.json') },
  { name: 'Red Hat YAML grammar', file: path.join(REPO, 'tests', 'fixtures', 'grammars', 'redhat-yaml.tmLanguage.json') },
];

let onigLoaded: Promise<void> | undefined;

function loadOniguruma(): Promise<void> {
  if (!onigLoaded) {
    const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
    onigLoaded = oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  }
  return onigLoaded;
}

async function loadYamlGrammar(yamlFile: string): Promise<vsctm.IGrammar> {
  await loadOniguruma();
  const grammars: Record<string, string> = { ...SHARED_GRAMMARS, 'source.yaml': yamlFile };
  const registry = new vsctm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
      createOnigString: (text: string) => new oniguruma.OnigString(text),
    }),
    loadGrammar: async (scope: string) => {
      const file = grammars[scope];
      return file ? vsctm.parseRawGrammar(fs.readFileSync(file, 'utf8'), file) : null;
    },
    getInjections: (scope: string) => (scope === 'source.yaml' ? INJECTIONS : undefined),
  });
  const grammar = await registry.loadGrammar('source.yaml');
  assert.ok(grammar, `YAML grammar not found: ${yamlFile}`);
  return grammar;
}

function tokenize(grammar: vsctm.IGrammar, lines: string[]): vsctm.IToken[][] {
  let state = vsctm.INITIAL;
  return lines.map((line) => {
    const result = grammar.tokenizeLine(line, state);
    state = result.ruleStack;
    return result.tokens;
  });
}

/** Trimmed source lines on which the shell grammar scoped any text. */
function shellLines(grammar: vsctm.IGrammar, source: string): string[] {
  const lines = source.split('\n');
  return tokenize(grammar, lines).flatMap((tokens, i) => {
    const shellText = tokens
      .filter((token) => token.scopes.some((scope) => scope.endsWith('.shell')))
      .map((token) => lines[i].slice(token.startIndex, token.endIndex))
      .join('')
      .trim();
    return shellText ? [lines[i].trim()] : [];
  });
}

/** Scopes of the token covering the first occurrence of `text` on line `line`. */
function scopesAt(grammar: vsctm.IGrammar, lines: string[], line: number, text: string): string[] {
  const index = lines[line].indexOf(text);
  assert.ok(index >= 0, `"${text}" not on line ${line}`);
  const token = tokenize(grammar, lines.slice(0, line + 1))[line].find(
    (t) => t.startIndex <= index && index < t.endIndex,
  );
  return token?.scopes ?? [];
}

for (const yaml of YAML_GRAMMARS) {
  suite(`Script block highlighting (${yaml.name})`, () => {
    let grammar: vsctm.IGrammar;

    suiteSetup(async () => {
      grammar = await loadYamlGrammar(yaml.file);
    });

    test('a spec input named script stays YAML while the job script is shell', () => {
      const source = [
        'spec:',
        '  inputs:',
        '    role_arn:',
        '      type: string',
        '    script:',
        '      description: Script to run',
        '      type: string',
        '    region:',
        '      type: string',
        '---',
        '$[[ inputs.job_name ]]:',
        '  script:',
        '    - echo "real script"',
      ].join('\n');
      assert.deepStrictEqual(shellLines(grammar, source), ['- echo "real script"']);
    });

    test('script keys deeper than a job stay YAML', () => {
      const source = [
        'include:',
        '  - component: example.com/group/project/thing@1.0.0',
        '    inputs:',
        '      script: echo not-shell',
        'build:',
        '  rules:',
        '    - if: $CI_COMMIT_TAG',
        '      script: not-a-job-key',
        '  script: echo linted',
      ].join('\n');
      assert.deepStrictEqual(shellLines(grammar, source), ['script: echo linted']);
    });

    test('a global variable named script stays YAML between jobs', () => {
      const lines = [
        'first:',
        '  script: echo one',
        'variables:',
        '  script: echo $HOME',
        '',
        '  after_script: echo $HOME',
        'stages: [build]',
        'second:',
        '  script:',
        '    - echo two',
      ];
      assert.deepStrictEqual(shellLines(grammar, lines.join('\n')), ['script: echo one', '- echo two']);
      assert.ok(
        scopesAt(grammar, lines, 3, 'echo').includes('string.unquoted.plain.out.yaml'),
        JSON.stringify(scopesAt(grammar, lines, 3, 'echo')),
      );
    });

    test('covers block scalars, compact lists, default:, hidden jobs and legacy globals', () => {
      const source = [
        'before_script: echo global',
        'default:',
        '  after_script:',
        '  - echo compact',
        '  # between items',
        '  - echo second',
        '  image: alpine',
        '.template:',
        '    script: |',
        '        if [ -n "$x" ]; then',
        '          echo yes',
        '        fi',
        '    stage: test',
      ].join('\n');
      assert.deepStrictEqual(shellLines(grammar, source), [
        'before_script: echo global',
        '- echo compact',
        '# between items',
        '- echo second',
        'if [ -n "$x" ]; then',
        'echo yes',
        'fi',
      ]);
    });

    test('finds jobs after top-level comments and with colons in their names', () => {
      const source = [
        '# disabled:',
        '#   script:',
        '#     - echo old',
        '',
        'test:unit:',
        '  stage: test',
        '  script:',
        '    - make test',
      ].join('\n');
      assert.deepStrictEqual(shellLines(grammar, source), ['- make test']);
    });

    test('a heredoc ends at its indented terminator inside a block scalar', () => {
      const lines = [
        'build:',
        '  script:',
        '    - |',
        '      case "$mode" in',
        '        all)',
        '          while read -r item; do echo "$item"; done <<EOF',
        '      $(git ls-files)',
        '      EOF',
        '          ;;',
        '      esac',
        "      cat <<-'END'",
        '      \tliteral $HOME',
        '      \tEND',
        '      echo after',
      ];
      const isHeredocBody = (scopes: string[]): boolean => scopes.some((scope) => scope.includes('heredoc.indent'));

      assert.ok(isHeredocBody(scopesAt(grammar, lines, 6, '$(')), 'heredoc body');
      assert.ok(
        scopesAt(grammar, lines, 7, 'EOF').includes('punctuation.definition.string.heredoc.delimiter.shell'),
        'terminator',
      );
      assert.ok(scopesAt(grammar, lines, 9, 'esac').includes('keyword.control.esac.shell'), 'esac after heredoc');
      assert.ok(isHeredocBody(scopesAt(grammar, lines, 11, 'literal')), 'quoted <<- heredoc body');
      assert.ok(scopesAt(grammar, lines, 13, 'echo').includes('entity.name.command.shell'), 'command after heredoc');
    });

    test('each list item starts fresh, so an unterminated construct cannot spill into the next', () => {
      const lines = [
        'build:',
        '  script:',
        '    - echo "unterminated',
        '    - |',
        '      make test',
        '    - apt-get install \\',
        '        curl',
        '    - make lint',
      ];
      assert.ok(
        scopesAt(grammar, lines, 3, '|').includes('keyword.control.flow.block-scalar.yaml'),
        JSON.stringify(scopesAt(grammar, lines, 3, '|')),
      );
      assert.ok(scopesAt(grammar, lines, 4, 'make').includes('entity.name.command.shell'), 'make test');
      assert.ok(scopesAt(grammar, lines, 7, 'make').includes('entity.name.command.shell'), 'make lint');
    });

    test('reads backslash-continued lines as more arguments, not new commands', () => {
      const lines = [
        'build:',
        '  script:',
        '    - |',
        '      tool publish \\',
        '        $ARGS \\',
        '        --first "a" \\',
        '        --second "b"',
        '      docker run \\',
        '        $(collect \\',
        '          name_one \\',
        '          name_two)',
        '      git merge main \\',
        '        || echo conflict',
        '      FOO=bar \\',
        '        make all',
        '      if true; then echo done; fi',
      ];
      const isCommandName = (line: number, text: string): boolean =>
        scopesAt(grammar, lines, line, text).some((scope) => scope.startsWith('meta.statement.command.name'));

      assert.ok(scopesAt(grammar, lines, 4, 'ARGS').includes('variable.other.normal.shell'), '$ARGS');
      assert.ok(scopesAt(grammar, lines, 5, 'first').some((s) => s.includes('constant.other.option')), '--first');
      assert.ok(scopesAt(grammar, lines, 6, 'second').some((s) => s.includes('constant.other.option')), '--second');
      assert.ok(!isCommandName(9, 'name_one') && !isCommandName(10, 'name_two'), 'continued inside $( )');
      assert.ok(scopesAt(grammar, lines, 12, '||').includes('keyword.operator.pipe.shell'), '|| continuation');
      assert.ok(!isCommandName(14, 'make'), 'continued assignment');
      assert.ok(scopesAt(grammar, lines, 15, 'if').includes('keyword.control.if.shell'), 'next command');
    });

    test('keeps block headers, !reference, aliases and empty lists as YAML and scopes command names', () => {
      const source = [
        'build:',
        '  before_script: []  # clear the inherited one',
        '  script:',
        '    - |',
        '      make test',
        '    - !reference [.setup, script]',
        '    - *shared_steps',
      ].join('\n');
      assert.deepStrictEqual(shellLines(grammar, source), ['make test']);

      const lines = ['build:', '  script:', '    - make test'];
      assert.ok(scopesAt(grammar, lines, 2, 'make').includes('entity.name.command.shell'), 'command name');
    });
  });
}
