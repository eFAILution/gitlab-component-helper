/**
 * Loads and shape-checks the two decision stores (ADR-366).
 *
 * - `.ai/decisions.yaml` holds the legacy entries, keyed by SCREAMING_SNAKE names. It is closed to new keys since
 *   #366; existing entries can still be edited.
 * - `.ai/decisions/ADR-<issue>.yaml` holds one record per file, each a full AICaC v2 document with exactly one key.
 *
 * The AICaC validator only reads `.ai/*.yaml`, so it never sees the record files. The entry checks below repeat the
 * parts of its decisions schema that matter, plus a few stricter ones (quoted date and version, list-of-text items).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';

export const LEGACY_FILE = '.ai/decisions.yaml';
export const RECORDS_DIR = '.ai/decisions';
export const RECORDS_README = 'README.md';
export const DOCS_POINTER = "see AGENTS.md, 'Issues, branches, and records'";

/** The keys `.ai/decisions.yaml` held when #366 closed it, in file order. Nothing else may appear there. */
export const LEGACY_KEYS: readonly string[] = [
  'USE_ESBUILD',
  'CACHE_COMPONENTS',
  'USE_SECRETSTORAGE_FOR_TOKENS',
  'RELEASE_IT',
  'DEPENDABOT_TARGETS_BETA',
  'MODULAR_SERVICE_SPLIT',
  'CENTRALIZED_ERROR_HANDLING',
  'REQUEST_DEDUPLICATION',
  'PERFORMANCE_MONITORING',
  'FILE_SIZE_POLICY',
  'EXTENSION_HOST_TEST_LAYER',
  'MULTI_SOURCE_SUPPORT',
  'TYPESCRIPT_STRICT_MODE',
  'BATCH_API_REQUESTS',
  'MOCHA_OVER_JEST',
  'DEMO_GIFS_RECORDED_BY_SCRIPT',
  'MCP_STDIO_HANDROLLED',
  'MCP_SERVER_NEVER_WRITES_FILES',
  'MCP_DISTRIBUTED_AS_RELEASE_ASSET',
  'MCP_TOKENS_VIA_HANDOFF_FILE',
];

export const RECORD_FILE = /^ADR-([1-9]\d*)\.yaml$/;
export const STATUSES = ['proposed', 'accepted', 'rejected', 'deprecated', 'superseded'] as const;

const VERSION = /^(1|2)\.\d+(\.\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_TEXT: ReadonlyArray<readonly [string, number]> = [['title', 3], ['context', 10], ['decision', 5]];
const CONSEQUENCE_SIDES = ['positive', 'negative'];

export type Entry = Record<string, unknown>;

export interface StoredEntry {
  id: string;
  entry: Entry;
  source: string;
}

export interface StoreResult {
  entries: StoredEntry[];
  errors: string[];
}

type Parsed = { ok: true; value: unknown; ast: yaml.Node | null } | { ok: false; error: string };

const isRecord = (value: unknown): value is Entry =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isTextList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const describeYamlError = (error: unknown): string => {
  if (!(error instanceof yaml.YAMLException)) return String(error);
  return error.mark ? `${error.reason} at line ${error.mark.line + 1}` : error.reason;
};

/** Parse one YAML document. js-yaml refuses a duplicate key at any depth, so that surfaces here as an error. */
export function parseYaml(text: string, filename: string): Parsed {
  try {
    const value = yaml.load(text, { filename });
    const [document] = yaml.eventsToAst(yaml.parseEvents(text, { filename }), {
      source: text,
      schema: yaml.CORE_SCHEMA,
    });
    return { ok: true, value, ast: document?.contents ?? null };
  } catch (error) {
    return { ok: false, error: describeYamlError(error) };
  }
}

/** The scalar node at a path of mapping keys, if there is one. */
function scalarAt(node: yaml.Node | null | undefined, path: readonly string[]): yaml.ScalarNode | undefined {
  if (!node) return undefined;
  if (path.length === 0) return node.kind === 'scalar' ? node : undefined;
  if (node.kind !== 'mapping') return undefined;
  const [head, ...rest] = path;
  const item = node.items.find(({ key }) => key.kind === 'scalar' && key.value === head);
  return scalarAt(item?.value, rest);
}

const isQuoted = (node: yaml.ScalarNode | undefined): boolean =>
  node?.style === yaml.SCALAR_STYLE.SINGLE_QUOTED || node?.style === yaml.SCALAR_STYLE.DOUBLE_QUOTED;

const isCalendarDate = (value: string): boolean =>
  DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

function requiredTextErrors(where: string, entry: Entry): string[] {
  return REQUIRED_TEXT.flatMap(([field, minimum]) => {
    const value = entry[field];
    if (value === undefined) return [`${where}: '${field}' is required (text of at least ${minimum} characters)`];
    if (typeof value === 'string' && value.trim().length >= minimum) return [];
    return [`${where}: '${field}' must be text of at least ${minimum} characters`];
  });
}

function consequenceErrors(where: string, consequences: unknown): string[] {
  if (consequences === undefined) return [];
  if (!isRecord(consequences)) {
    return [`${where}: 'consequences' must be a mapping with 'positive' and 'negative' lists`];
  }
  const extra = Object.keys(consequences).filter((side) => !CONSEQUENCE_SIDES.includes(side));
  const extraErrors = extra.length
    ? [`${where}: 'consequences' takes only 'positive' and 'negative' lists (found ${extra.join(', ')})`]
    : [];
  const sideErrors = CONSEQUENCE_SIDES
    .filter((side) => side in consequences && !isTextList(consequences[side]))
    .map((side) => `${where}: 'consequences.${side}' must be a list of text items; quote any item that contains ': '`);
  return [...extraErrors, ...sideErrors];
}

function alternativesErrors(where: string, alternatives: unknown): string[] {
  if (alternatives === undefined || isTextList(alternatives)) return [];
  const named = Array.isArray(alternatives)
    && alternatives.every((item) => isRecord(item) && typeof item.name === 'string');
  return named ? [] : [`${where}: 'alternatives_considered' must be a list of text, or of mappings that each have a 'name'`];
}

/**
 * Shape errors for one record entry, checked against the AICaC v2 decisions schema plus the stricter rules record
 * files follow. `ast` is the file's parsed node tree, used to tell a quoted date from a plain one.
 */
export function entryErrors(where: string, id: string, entry: Entry, ast: yaml.Node | null): string[] {
  const { status, date, rationale, consequences, implementation, references, supersedes } = entry;
  const statusErrors = STATUSES.includes(status as (typeof STATUSES)[number])
    ? []
    : [`${where}: 'status' must be one of ${STATUSES.join(', ')}`];
  const dateOk = date === undefined
    || (typeof date === 'string' && isCalendarDate(date) && isQuoted(scalarAt(ast, ['decisions', id, 'date'])));
  const listOfText = (field: string, value: unknown, hint: string): string[] =>
    value === undefined || isTextList(value) ? [] : [`${where}: '${field}' must be a list of ${hint}`];
  return [
    ...requiredTextErrors(where, entry),
    ...statusErrors,
    ...(dateOk ? [] : [`${where}: 'date' must be a quoted 'YYYY-MM-DD' calendar date, like date: '2026-10-22'`]),
    ...listOfText('rationale', rationale, "text items; quote any item that contains ': '"),
    ...consequenceErrors(where, consequences),
    ...alternativesErrors(where, entry.alternatives_considered),
    ...(implementation === undefined || typeof implementation === 'string' || isRecord(implementation)
      ? []
      : [`${where}: 'implementation' must be text or a mapping`]),
    ...listOfText('references', references, 'text items (paths, links or issue numbers)'),
    ...listOfText('supersedes', supersedes, 'decision keys, like [USE_ESBUILD] or [ADR-366]'),
  ];
}

const readText = (root: string, relative: string): string | undefined => {
  try {
    return readFileSync(join(root, relative), 'utf8');
  } catch {
    return undefined;
  }
};

/** The legacy entries, plus an error for anything not in the frozen key set. A missing file is an empty store. */
export function loadLegacy(root: string): StoreResult {
  const text = readText(root, LEGACY_FILE);
  if (text === undefined) return { entries: [], errors: [] };
  const parsed = parseYaml(text, LEGACY_FILE);
  if (!parsed.ok) {
    return { entries: [], errors: [`${LEGACY_FILE}: ${parsed.error}; every key must be unique (after a merge, keep `
      + `the entry already on beta and move yours to ${RECORDS_DIR}/ADR-<issue>.yaml)`] };
  }
  const decisions = isRecord(parsed.value) ? parsed.value.decisions : undefined;
  if (!isRecord(decisions)) {
    return { entries: [], errors: [`${LEGACY_FILE}: expected a 'decisions' mapping keyed by decision name`] };
  }
  const entries = Object.entries(decisions)
    .filter((pair): pair is [string, Entry] => isRecord(pair[1]))
    .map(([id, entry]) => ({ id, entry, source: LEGACY_FILE }));
  const errors = Object.keys(decisions)
    .filter((id) => !LEGACY_KEYS.includes(id))
    .map((id) => `${LEGACY_FILE}: '${id}' is a new key, but this file is closed to new entries since #366; move it `
      + `to ${RECORDS_DIR}/ADR-<issue>.yaml (${DOCS_POINTER})`);
  return { entries, errors };
}

/** One record file: its single entry (when it has one) and everything wrong with it. */
function loadRecord(root: string, name: string): StoreResult {
  const source = `${RECORDS_DIR}/${name}`;
  const id = name.replace(/\.yaml$/, '');
  const parsed = parseYaml(readFileSync(join(root, source), 'utf8'), source);
  if (!parsed.ok) return { entries: [], errors: [`${source}: ${parsed.error}`] };
  const { value, ast } = parsed;
  const document = isRecord(value) ? value : {};
  const versionOk = typeof document.version === 'string' && VERSION.test(document.version)
    && isQuoted(scalarAt(ast, ['version']));
  const versionErrors = versionOk ? [] : [`${source}: needs a quoted top-level version, like version: '2.0'`];
  const decisions = document.decisions;
  const keys = isRecord(decisions) ? Object.keys(decisions) : [];
  if (!isRecord(decisions) || keys.length !== 1 || keys[0] !== id) {
    const found = keys.length ? ` (found ${keys.join(', ')})` : '';
    return { entries: [], errors: [...versionErrors,
      `${source}: 'decisions' must hold exactly one entry, keyed ${id} to match the file name${found}`] };
  }
  const entry = decisions[id];
  if (!isRecord(entry)) return { entries: [], errors: [...versionErrors, `${source}: ${id} must be a mapping of fields`] };
  return { entries: [{ id, entry, source }], errors: [...versionErrors, ...entryErrors(source, id, entry, ast)] };
}

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** Every record file, sorted by issue number. Anything else in the directory (but a README.md) is an error. */
export function loadRecords(root: string): StoreResult {
  const directory = join(root, RECORDS_DIR);
  if (!isDirectory(directory)) return { entries: [], errors: [] };
  const names = readdirSync(directory).filter((name) => name !== RECORDS_README).sort();
  const stray = names
    .filter((name) => !RECORD_FILE.test(name) || isDirectory(join(directory, name)))
    .map((name) => `${RECORDS_DIR}/${name}: record files are named ADR-<issue>.yaml with the bare issue number and `
      + `a .yaml extension (for example ADR-366.yaml); nothing else but a ${RECORDS_README} belongs here`);
  const results = names
    .filter((name) => RECORD_FILE.test(name) && !isDirectory(join(directory, name)))
    .map((name) => loadRecord(root, name));
  const entries = results.flatMap((result) => result.entries).sort((a, b) => recordNumber(a.id) - recordNumber(b.id));
  return { entries, errors: [...stray, ...results.flatMap((result) => result.errors)] };
}

/** The issue number in a record key (`ADR-366` -> 366), or 0 for a legacy key. */
export const recordNumber = (id: string): number => Number(/^ADR-(\d+)$/.exec(id)?.[1] ?? 0);

/** Cross-store references: `supersedes` must resolve, and a legacy entry can't name a record as its successor. */
export function referenceErrors(legacy: StoredEntry[], records: StoredEntry[]): string[] {
  const known = new Set([...legacy, ...records].map(({ id }) => id));
  const recordIds = new Set(records.map(({ id }) => id));
  const successorErrors = legacy
    .filter(({ entry }) => typeof entry.superseded_by === 'string' && recordIds.has(entry.superseded_by))
    .map(({ id, entry }) => `${LEGACY_FILE}: ${id}.superseded_by points at ${String(entry.superseded_by)}, which the `
      + `AICaC validator can't resolve; drop it and list ${id} under 'supersedes' in `
      + `${RECORDS_DIR}/${String(entry.superseded_by)}.yaml instead`);
  const danglingErrors = records.flatMap(({ entry, source }) => (isTextList(entry.supersedes) ? entry.supersedes : [])
    .filter((ref) => !known.has(ref))
    .map((ref) => `${source}: 'supersedes' names '${ref}', which is in neither ${LEGACY_FILE} nor ${RECORDS_DIR}/; `
      + 'fix the key or drop it'));
  return [...successorErrors, ...danglingErrors];
}
