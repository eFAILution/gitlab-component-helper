/**
 * Fixtures for the decision-record tests: temp repos holding `.ai/decisions.yaml` and `.ai/decisions/`, and a git
 * helper for throwaway repositories.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { runCheck } from '../../../scripts/ci/decisionRecords';

export type Fields = Record<string, unknown>;

export const BASE_ENTRY: Fields = {
  title: 'A decision',
  status: 'accepted',
  context: 'Some context that is long enough.',
  decision: 'Do the thing.',
};

export const DEFAULT_LEGACY: Record<string, Fields> = {
  USE_ESBUILD: { ...BASE_ENTRY, title: 'Use Esbuild' },
  CACHE_COMPONENTS: { ...BASE_ENTRY, title: 'Cache Components' },
};

/** A full AICaC v2 record document holding one entry. */
export function recordDoc(id: string, overrides: Fields = {}): string {
  return yaml.dump({ version: '2.0', decisions: { [id]: { ...BASE_ENTRY, title: `Record ${id}`, ...overrides } } });
}

export interface Fixture {
  legacy?: Record<string, Fields> | string;
  records?: Record<string, string>;
}

export function writeFixture(root: string, { legacy = DEFAULT_LEGACY, records }: Fixture): string {
  mkdirSync(join(root, '.ai'), { recursive: true });
  const legacyText = typeof legacy === 'string' ? legacy : yaml.dump({ decisions: legacy, version: '2.0' });
  writeFileSync(join(root, '.ai', 'decisions.yaml'), legacyText);
  if (records) {
    mkdirSync(join(root, '.ai', 'decisions'), { recursive: true });
    Object.entries(records).forEach(([name, text]) => writeFileSync(join(root, '.ai', 'decisions', name), text));
  }
  return root;
}

/** git with a fixed identity, no signing and no hooks, so it behaves the same on every machine. */
export function git(root: string, ...args: string[]): string {
  const config = ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false',
    '-c', 'core.hooksPath=/dev/null'];
  return execFileSync('git', [...config, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function commitAll(root: string, message: string): void {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

export const errorsFor = (root: string): string => runCheck(root, {}).errors.join('\n');

/** Temp-directory factories for one suite; everything they create is removed when the suite ends. */
export function useTempRoots(): { tempRoot: () => string; fixture: (spec?: Fixture) => string } {
  const dirs: string[] = [];
  const tempRoot = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'gch-decisions-'));
    dirs.push(dir);
    return dir;
  };
  suiteTeardown(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
  return { tempRoot, fixture: (spec: Fixture = {}) => writeFixture(tempRoot(), spec) };
}
