// @mocha
/**
 * GitLabSpecParser tests
 *
 * Imports the real `GitLabSpecParser` from src/. Each suite covers a distinct phase of `parse`:
 *  - `spec.inputs extraction` — pre-`---` inputs walk, ignoring post-`---` job sections.
 *  - `description extraction` — top-of-file `#` comment, with generic GitLab/CI banner comments filtered out.
 *    Replaces the legacy `description-extraction` and `fallback-behavior` tests, which asserted against a phantom
 *    `spec.description` regex that production never implemented.
 */

import * as assert from 'node:assert/strict';
import { GitLabSpecParser } from '../../src/parsers/specParser';

suite('GitLabSpecParser.parse — spec.inputs extraction', () => {
  // NOTE: The parser's quote-strip regex (`/^["']|["']$/g`) runs BEFORE `.trim()` on the value after the property
  // key, so a leading space prevents the opening quote from being stripped. Quoted values therefore retain their
  // opening `"`/`'` in the parsed result. The unquoted test uses unquoted values to avoid that.
  test('extracts inputs (unquoted values) from spec section, ignores post-separator job variables', () => {
    const template = `spec:
  inputs:
    environment:
      description: Target environment
      default: development
      type: string
    debug:
      description: Enable debug mode
      default: false
      type: boolean
---
deploy-job:
  stage: deploy
  variables:
    ENV_VAR: "should not be parsed"
    ANOTHER_VAR: "also should not be parsed"
  script:
    - echo "Deploying to $[[ inputs.environment ]]"
  after_script:
    - echo "Cleanup"`;

    const parsed = GitLabSpecParser.parse(template);

    assert.strictEqual(parsed.isValidComponent, true);
    assert.strictEqual(parsed.variables.length, 2);

    const environment = parsed.variables.find((v) => v.name === 'environment');
    assert.ok(environment, 'environment input missing');
    assert.strictEqual(environment.type, 'string');
    assert.strictEqual(environment.default, 'development');

    const debug = parsed.variables.find((v) => v.name === 'debug');
    assert.ok(debug, 'debug input missing');
    assert.strictEqual(debug.type, 'boolean');
    // The boolean `false`, not the string "false" — a stringified default renders back as a quoted `"false"`.
    assert.strictEqual(debug.default, false);

    const names = parsed.variables.map((v) => v.name);
    for (const unwanted of ['ENV_VAR', 'ANOTHER_VAR', 'script', 'after_script']) {
      assert.ok(!names.includes(unwanted), `job-section name leaked into inputs: ${unwanted}`);
    }
  });

  test('maps hyphenated input names correctly across comments and blank lines (issue #211)', () => {
    // Hyphenated keys (e.g. `job-name`) weren't recognised as new inputs, so their description/default
    // bled onto the previous non-hyphenated input — `architecture` would show a later input's description.
    // Comment and blank lines within the inputs block must not shift the mapping either.
    const template = `spec:
  inputs:
    job-name:
      description: The job name
      default: build
    # ── package metadata ──────────────
    package-name:
      description: The package name

    package-version:
      description: The version to stamp
      default: 0.0.1

    # ── build options ─────────────────
    architecture:
      description: Target CPU architecture
      default: amd64
    skip-find-images:
      description: Skip image discovery
      default: false
---
$[[ inputs.job-name ]]:
  script: echo build`;

    const parsed = GitLabSpecParser.parse(template);
    const byName = Object.fromEntries(parsed.variables.map((v) => [v.name, v]));

    // All five inputs are recognised — the hyphenated ones were previously skipped entirely.
    assert.deepStrictEqual(parsed.variables.map((v) => v.name), [
      'job-name',
      'package-name',
      'package-version',
      'architecture',
      'skip-find-images',
    ]);

    // Each input keeps its OWN description/default — no bleed across the comment/blank boundaries.
    assert.strictEqual(byName['job-name'].description, 'The job name');
    assert.strictEqual(byName['job-name'].default, 'build');
    assert.strictEqual(byName['package-version'].description, 'The version to stamp');
    assert.strictEqual(byName['package-version'].default, '0.0.1');
    assert.strictEqual(byName['architecture'].description, 'Target CPU architecture');
    assert.strictEqual(byName['architecture'].default, 'amd64');
    assert.strictEqual(byName['skip-find-images'].description, 'Skip image discovery');
    // No `type:` on this input, so GitLab resolves it as a string — the default stays the text it appears as.
    assert.strictEqual(byName['skip-find-images'].default, 'false');

    // A hyphenated input with no default is marked required, same as a non-hyphenated one.
    assert.strictEqual(byName['package-name'].default, undefined);
    assert.strictEqual(byName['package-name'].required, true);
  });

  test('component without --- separator (legacy format) still scopes inputs to the spec section', () => {
    const template = `spec:
  inputs:
    version:
      description: Version to deploy
      default: latest
variables:
  LEGACY_VAR: "value"
deploy:
  script: echo "deploying"`;

    const parsed = GitLabSpecParser.parse(template);

    assert.strictEqual(parsed.variables.length, 1);
    const version = parsed.variables[0];
    assert.strictEqual(version.name, 'version');
    assert.strictEqual(version.type, 'string');
    assert.strictEqual(version.default, 'latest');

    const names = parsed.variables.map((v) => v.name);
    assert.ok(!names.includes('LEGACY_VAR'), 'top-level legacy variable leaked into inputs');
    assert.ok(!names.includes('script'), 'job key leaked into inputs');
  });

  test('variables block inside a job section is not treated as component inputs', () => {
    const template = `spec:
  inputs:
    stage:
      default: test
---
component-job:
  script: echo job 1
  stage: $[[ inputs.stage ]]
  variables:
    JOB_VAR: "should not be extracted"
    ANOTHER_JOB_VAR: "also should not be extracted"
    CI_DEBUG_TRACE: true`;

    const parsed = GitLabSpecParser.parse(template);

    assert.strictEqual(parsed.variables.length, 1);
    assert.strictEqual(parsed.variables[0].name, 'stage');
    assert.strictEqual(parsed.variables[0].default, 'test');

    const names = parsed.variables.map((v) => v.name);
    for (const unwanted of ['JOB_VAR', 'ANOTHER_JOB_VAR', 'CI_DEBUG_TRACE', 'script']) {
      assert.ok(!names.includes(unwanted), `job-section name leaked into inputs: ${unwanted}`);
    }
  });
});

suite('GitLabSpecParser.parse — options (enum) extraction', () => {
  test('extracts an expanded `- item` options list, preserving order', () => {
    const template = `spec:
  inputs:
    registry_type:
      description: Configures the type of registry to use.
      type: string
      options:
        - aws
        - gcp
        - azure`;

    const parsed = GitLabSpecParser.parse(template);

    const registry = parsed.variables.find((v) => v.name === 'registry_type');
    assert.ok(registry, 'registry_type input missing');
    assert.deepStrictEqual(registry.options, ['aws', 'gcp', 'azure']);
  });

  test('extracts an inline `[a, b]` options list, stripping quotes', () => {
    const template = `spec:
  inputs:
    region:
      type: string
      options: ["us-east-1", 'eu-west-2']`;

    const parsed = GitLabSpecParser.parse(template);

    const region = parsed.variables.find((v) => v.name === 'region');
    assert.ok(region, 'region input missing');
    assert.deepStrictEqual(region.options, ['us-east-1', 'eu-west-2']);
  });

  test('leaves options undefined for an input without an options block', () => {
    const template = `spec:
  inputs:
    environment:
      type: string
      default: development`;

    const parsed = GitLabSpecParser.parse(template);

    const environment = parsed.variables.find((v) => v.name === 'environment');
    assert.ok(environment, 'environment input missing');
    assert.strictEqual(environment.options, undefined);
  });

  test('a following input after an options list is parsed as its own input, not an option', () => {
    const template = `spec:
  inputs:
    registry_type:
      type: string
      options:
        - aws
        - gcp
    region:
      type: string
      default: us-east-1`;

    const parsed = GitLabSpecParser.parse(template);

    const registry = parsed.variables.find((v) => v.name === 'registry_type');
    const region = parsed.variables.find((v) => v.name === 'region');
    assert.deepStrictEqual(registry?.options, ['aws', 'gcp']);
    assert.ok(region, 'region input missing — options list may have swallowed the next input');
    assert.strictEqual(region.default, 'us-east-1');
    assert.strictEqual(region.options, undefined);
  });
});

suite('GitLabSpecParser.parse — default value types', () => {
  // The parser reads the spec line-by-line, so a `default:` arrives as raw text. Keeping it as text turned
  // `default: false` into the string "false", which completion then inserted as a quoted `"false"` — a string
  // where GitLab expects a boolean.
  test('parses scalar defaults as their YAML types, not as strings', () => {
    const template = `spec:
  inputs:
    flag_off:
      type: boolean
      default: false
    flag_on:
      type: boolean
      default: true
    port:
      type: number
      default: 8080
    ratio:
      type: number
      default: 0.5
    name:
      type: string
      default: production
    empty:
      type: string
      default:`;

    const parsed = GitLabSpecParser.parse(template);
    const byName = Object.fromEntries(parsed.variables.map((v) => [v.name, v]));

    assert.strictEqual(byName['flag_off'].default, false);
    assert.strictEqual(byName['flag_on'].default, true);
    assert.strictEqual(byName['port'].default, 8080);
    assert.strictEqual(byName['ratio'].default, 0.5);
    assert.strictEqual(byName['name'].default, 'production');
    // An explicit but empty `default:` is an empty string, so the input is not required.
    assert.strictEqual(byName['empty'].default, '');
    assert.strictEqual(byName['empty'].required, false);
  });

  test('keeps a quoted "false" a string, so it round-trips as a quoted scalar', () => {
    const template = `spec:
  inputs:
    literal:
      type: string
      default: "false"
    numeric_string:
      type: string
      default: "8080"`;

    const parsed = GitLabSpecParser.parse(template);
    const byName = Object.fromEntries(parsed.variables.map((v) => [v.name, v]));

    assert.strictEqual(byName['literal'].default, 'false');
    assert.strictEqual(byName['numeric_string'].default, '8080');
  });

  test('treats an omitted type as string, leaving the default as written', () => {
    // GitLab resolves an untyped input as StringInput and coerces the default with `to_s`, so an untyped default
    // is text whatever it looks like. Sending it through YAML instead would renumber it: `0755` loses its leading
    // zero, `1.0` becomes `1`, `1e5` becomes `100000` — silent value corruption.
    const template = `spec:
  inputs:
    file_mode:
      default: 0755
    version:
      default: 1.0
    scientific:
      default: 1e5
    padded:
      default: 007
    flag:
      description: no type declared
      default: false
    untyped_nothing:
      description: no type and no default`;

    const parsed = GitLabSpecParser.parse(template);
    const byName = Object.fromEntries(parsed.variables.map((v) => [v.name, v]));

    assert.strictEqual(byName['file_mode'].default, '0755');
    assert.strictEqual(byName['version'].default, '1.0');
    assert.strictEqual(byName['scientific'].default, '1e5');
    assert.strictEqual(byName['padded'].default, '007');
    assert.strictEqual(byName['flag'].default, 'false');
    for (const name of ['file_mode', 'version', 'scientific', 'padded', 'flag', 'untyped_nothing']) {
      assert.strictEqual(byName[name].type, 'string', `${name} should resolve as a string input`);
    }
  });

  test('a valueless `default:` at input-name indentation is not read as an input', () => {
    // On a spec indented `inputs:` at 0, an input's keys sit at 4 and match the input-name pattern — a bare
    // `default:` would otherwise open a phantom input named `default` and swallow the real input's value.
    const template = `spec:
inputs:
  flag:
    type: boolean
    default:`;

    const parsed = GitLabSpecParser.parse(template);

    assert.deepStrictEqual(parsed.variables.map((v) => v.name), ['flag']);
    assert.strictEqual(parsed.variables[0].default, '');
    assert.strictEqual(parsed.variables[0].required, false);
  });

  test('an explicit `type: string` keeps a numeric-looking default as text', () => {
    // The declared type wins over what YAML would make of the text: `1.0` must not become the number 1, and
    // `0755` must keep its leading zero.
    const template = `spec:
  inputs:
    ratio:
      type: string
      default: 1.0
    mode:
      type: string
      default: 0755`;

    const parsed = GitLabSpecParser.parse(template);
    const byName = Object.fromEntries(parsed.variables.map((v) => [v.name, v]));

    assert.strictEqual(byName['ratio'].default, '1.0');
    assert.strictEqual(byName['mode'].default, '0755');
  });

  test('types options entries like defaults, so a default matches the option naming it', () => {
    // Options parsed as strings while defaults are typed would leave `false` unable to match `'false'` — the
    // default would not pre-select, and the choice would insert quoted values into a boolean/number input.
    const template = `spec:
  inputs:
    mode:
      type: boolean
      default: false
      options: [true, false]
    size:
      type: number
      default: 2
      options: [1, 2, 3]`;

    const parsed = GitLabSpecParser.parse(template);
    const byName = Object.fromEntries(parsed.variables.map((v) => [v.name, v]));

    assert.deepStrictEqual(byName['mode'].options, [true, false]);
    assert.strictEqual(byName['mode'].default, false);
    assert.deepStrictEqual(byName['size'].options, [1, 2, 3]);
    assert.strictEqual(byName['size'].default, 2);
  });

  test('types options against a `type:` declared after the options block', () => {
    const template = `spec:
  inputs:
    size:
      options: [1, 2]
      type: number`;

    const parsed = GitLabSpecParser.parse(template);

    assert.deepStrictEqual(parsed.variables[0].options, [1, 2]);
  });

  test('an explicit `type: string` keeps numeric-looking options as text', () => {
    const template = `spec:
  inputs:
    version:
      type: string
      options: ["1.0", "2.0"]`;

    const parsed = GitLabSpecParser.parse(template);

    assert.deepStrictEqual(parsed.variables[0].options, ['1.0', '2.0']);
  });

  test('an input with a false default is optional, not required', () => {
    const template = `spec:
  inputs:
    debug:
      type: boolean
      default: false`;

    const parsed = GitLabSpecParser.parse(template);

    assert.strictEqual(parsed.variables[0].required, false);
  });
});

suite('GitLabSpecParser.parse — description extraction', () => {
  test('extracts description from a leading `#` comment', () => {
    const template = `# Deploys a service to the target environment
spec:
  inputs:
    environment:
      default: production
---
deploy-job:
  script: echo deploy`;

    const parsed = GitLabSpecParser.parse(template);

    assert.strictEqual(parsed.description, 'Deploys a service to the target environment');
    assert.strictEqual(parsed.isValidComponent, true);
  });

  test('filters out generic "GitLab"-mentioning banner comments', () => {
    const template = `# GitLab CI/CD component
spec:
  inputs:
    foo:
      default: bar`;

    const parsed = GitLabSpecParser.parse(template);

    assert.strictEqual(parsed.description, '', 'banner mentioning "GitLab" must be filtered');
  });

  test('filters out generic "CI"-mentioning banner comments (case-insensitive)', () => {
    const template = `# Generic CI helpers
spec:
  inputs:
    foo:
      default: bar`;

    const parsed = GitLabSpecParser.parse(template);

    assert.strictEqual(parsed.description, '', 'banner mentioning "CI" must be filtered');
  });

  test('template without any leading comment yields an empty description (fallback path)', () => {
    const template = `spec:
  inputs:
    foo:
      description: An input parameter
      default: bar`;

    const parsed = GitLabSpecParser.parse(template);

    assert.strictEqual(
      parsed.description,
      '',
      'input-parameter descriptions must NOT be used as the component description',
    );
    assert.strictEqual(parsed.variables.length, 1);
    assert.strictEqual(parsed.variables[0].name, 'foo');
  });

  test('trims surrounding whitespace from the captured comment', () => {
    const template = `#    Surrounded by whitespace
spec:
  inputs:
    foo:
      default: bar`;

    const parsed = GitLabSpecParser.parse(template);

    assert.strictEqual(parsed.description, 'Surrounded by whitespace');
  });
});
