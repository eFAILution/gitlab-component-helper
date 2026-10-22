// @mocha
/**
 * Shape checks for the two decision stores (ADR-366): the closed legacy file and the issue-keyed record files.
 */

import * as assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as yaml from 'js-yaml';
import { runCheck } from '../../scripts/ci/decisionRecords';
import { LEGACY_KEYS } from '../../scripts/ci/decisionRecordsStore';
import { BASE_ENTRY, DEFAULT_LEGACY, errorsFor, type Fields, recordDoc, useTempRoots } from './support/decisionRecordFixtures';

const REPO_ROOT = resolve(__dirname, '..', '..');

suite('decision stores', () => {
  const { tempRoot, fixture } = useTempRoots();

  suite('legacy store (.ai/decisions.yaml)', () => {
    test('the frozen key set matches this repo\'s file', () => {
      const text = readFileSync(join(REPO_ROOT, '.ai', 'decisions.yaml'), 'utf8');
      const { decisions } = yaml.load(text) as { decisions: Fields };
      assert.deepEqual(Object.keys(decisions), [...LEGACY_KEYS]);
    });

    test('a clean store passes', () => assert.equal(errorsFor(fixture()), ''));

    test('missing stores pass', () => assert.deepEqual(runCheck(tempRoot(), {}), { errors: [], warnings: [] }));

    test('editing an existing entry is allowed', () => {
      const legacy = { ...DEFAULT_LEGACY, USE_ESBUILD: { ...BASE_ENTRY, status: 'superseded' } };
      assert.equal(errorsFor(fixture({ legacy })), '');
    });

    test('a new key is rejected with the fix', () => {
      const errors = errorsFor(fixture({ legacy: { ...DEFAULT_LEGACY, NEW_THING: BASE_ENTRY } }));
      assert.match(errors, /NEW_THING/);
      assert.match(errors, /closed to new entries/);
      assert.match(errors, /\.ai\/decisions\/ADR-<issue>\.yaml/);
    });

    test('an ADR-<n> key there is rejected too', () => {
      assert.match(errorsFor(fixture({ legacy: { ...DEFAULT_LEGACY, 'ADR-366': BASE_ENTRY } })), /ADR-366/);
    });

    test('a duplicate key is rejected', () => {
      const text = 'decisions:\n  USE_ESBUILD:\n    title: One\n  USE_ESBUILD:\n    title: Two\nversion: \'2.0\'\n';
      const errors = errorsFor(fixture({ legacy: text }));
      assert.match(errors, /duplicated mapping key/);
      assert.match(errors, /line 4/);
    });

    test('a file without a decisions mapping is rejected', () => {
      assert.match(errorsFor(fixture({ legacy: 'version: \'2.0\'\n' })), /'decisions' mapping/);
    });

    test('superseded_by cannot point at a record file', () => {
      const legacy = { ...DEFAULT_LEGACY, USE_ESBUILD: { ...BASE_ENTRY, superseded_by: 'ADR-483' } };
      const errors = errorsFor(fixture({ legacy, records: { 'ADR-483.yaml': recordDoc('ADR-483') } }));
      assert.match(errors, /USE_ESBUILD\.superseded_by/);
      assert.match(errors, /'supersedes'/);
    });
  });

  suite('record files (.ai/decisions/)', () => {
    const errorsForRecord = (name: string, text: string): string => errorsFor(fixture({ records: { [name]: text } }));

    test('a clean record passes', () => assert.equal(errorsForRecord('ADR-483.yaml', recordDoc('ADR-483')), ''));

    test('a README.md is allowed', () => {
      const records = { 'ADR-483.yaml': recordDoc('ADR-483'), 'README.md': '# Notes\n' };
      assert.equal(errorsFor(fixture({ records })), '');
    });

    ['ADR-0483.yaml', 'adr-483.yaml', 'ADR-483.yml', 'ADR-0.yaml', 'notes.md', 'ADR-483.yaml.bak'].forEach((name) =>
      test(`${name} is a bad file name`, () => {
        assert.match(errorsForRecord(name, recordDoc('ADR-483')), /named ADR-<issue>\.yaml/);
      }));

    test('a subdirectory is a stray entry', () => {
      const root = fixture({ records: { 'ADR-483.yaml': recordDoc('ADR-483') } });
      mkdirSync(join(root, '.ai', 'decisions', 'drafts'));
      assert.match(errorsFor(root), /drafts/);
    });

    test('version is required', () => {
      const text = yaml.dump({ decisions: { 'ADR-483': BASE_ENTRY } });
      assert.match(errorsForRecord('ADR-483.yaml', text), /quoted top-level version/);
    });

    test('an unquoted version is rejected', () => {
      const text = recordDoc('ADR-483').replace("version: '2.0'", 'version: 2.0');
      assert.match(errorsForRecord('ADR-483.yaml', text), /quoted top-level version/);
    });

    test('exactly one key, matching the file name', () => {
      const two = yaml.dump({ version: '2.0', decisions: { 'ADR-483': BASE_ENTRY, 'ADR-484': BASE_ENTRY } });
      assert.match(errorsForRecord('ADR-483.yaml', two), /exactly one entry, keyed ADR-483/);
      assert.match(errorsForRecord('ADR-483.yaml', recordDoc('ADR-484')), /exactly one entry, keyed ADR-483/);
      assert.match(errorsForRecord('ADR-483.yaml', "version: '2.0'\ndecisions: {}\n"), /exactly one entry/);
    });

    test('a duplicate key at any depth is rejected', () => {
      const text = `${recordDoc('ADR-483')}    title: Again\n`;
      assert.match(errorsForRecord('ADR-483.yaml', text), /ADR-483\.yaml: duplicated mapping key/);
    });

    test('invalid YAML, an empty file and a non-mapping are reported', () => {
      assert.match(errorsForRecord('ADR-483.yaml', 'version: [unclosed\n'), /ADR-483\.yaml/);
      assert.match(errorsForRecord('ADR-483.yaml', ''), /ADR-483\.yaml/);
      assert.match(errorsForRecord('ADR-483.yaml', '- a\n- list\n'), /quoted top-level version/);
    });

    test('required text fields and status', () => {
      const text = recordDoc('ADR-483', { title: 'x', context: 'short', decision: 'no', status: 'done' });
      const errors = errorsForRecord('ADR-483.yaml', text);
      ["'title'", "'context'", "'decision'", "'status'"].forEach((field) => assert.ok(errors.includes(field), field));
      assert.match(errors, /at least 3 characters/);
      assert.match(errors, /proposed, accepted, rejected, deprecated, superseded/);
    });

    test('a missing required field is reported', () => {
      const text = yaml.dump({ version: '2.0', decisions: { 'ADR-483': { title: 'Only a title' } } });
      assert.match(errorsForRecord('ADR-483.yaml', text), /'decision' is required/);
    });

    test('date must be a quoted YYYY-MM-DD', () => {
      const quoted = recordDoc('ADR-483', { date: '2026-10-22' });
      assert.equal(errorsForRecord('ADR-483.yaml', quoted), '');
      assert.match(errorsForRecord('ADR-483.yaml', quoted.replace("'2026-10-22'", '2026-10-22')), /'date'/);
      assert.match(errorsForRecord('ADR-483.yaml', recordDoc('ADR-483', { date: '2026-10' })), /'date'/);
      assert.match(errorsForRecord('ADR-483.yaml', recordDoc('ADR-483', { date: '2026-02-30' })), /'date'/);
    });

    test('rationale must be a list of text', () => {
      assert.match(errorsForRecord('ADR-483.yaml', recordDoc('ADR-483', { rationale: 'one string' })), /'rationale'/);
      // An unquoted ': ' inside a list item parses as a mapping and loses the sentence.
      const colon = recordDoc('ADR-483', { rationale: [{ Speed: 'it is fast' }] });
      assert.match(errorsForRecord('ADR-483.yaml', colon), /quote any item that contains ': '/);
    });

    test('consequences takes only positive and negative lists of text', () => {
      const extra = recordDoc('ADR-483', { consequences: { positive: ['Good.'], neutral: ['Meh.'] } });
      assert.match(errorsForRecord('ADR-483.yaml', extra), /only 'positive' and 'negative'/);
      const bad = recordDoc('ADR-483', { consequences: { negative: 'A string.' } });
      assert.match(errorsForRecord('ADR-483.yaml', bad), /'consequences\.negative'/);
      assert.match(errorsForRecord('ADR-483.yaml', recordDoc('ADR-483', { consequences: ['x'] })), /'consequences'/);
    });

    test('optional fields keep the shapes the legacy entries use', () => {
      const good = recordDoc('ADR-483', {
        alternatives_considered: [{ name: 'Other', rejected_because: 'No.' }],
        implementation: { pattern: 'x' },
        references: ['scripts/ci/decisionRecords.ts'],
      });
      assert.equal(errorsForRecord('ADR-483.yaml', good), '');
      const bad = recordDoc('ADR-483', { alternatives_considered: [{ rejected_because: 'No name.' }],
        implementation: ['a'], references: 'one' });
      const errors = errorsForRecord('ADR-483.yaml', bad);
      ["'alternatives_considered'", "'implementation'", "'references'"].forEach((f) => assert.ok(errors.includes(f), f));
    });

    test('supersedes must name decisions that exist', () => {
      const records = {
        'ADR-483.yaml': recordDoc('ADR-483', { supersedes: ['USE_ESBUILD', 'ADR-500', 'ADR-999', 'NOPE'] }),
        'ADR-500.yaml': recordDoc('ADR-500'),
      };
      const errors = errorsFor(fixture({ records }));
      assert.match(errors, /'ADR-999'/);
      assert.match(errors, /'NOPE'/);
      assert.doesNotMatch(errors, /'USE_ESBUILD'|'ADR-500'/);
      assert.match(errorsFor(fixture({ records: { 'ADR-483.yaml': recordDoc('ADR-483', { supersedes: 'X' }) } })),
        /'supersedes' must be a list/);
    });
  });
});
