import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  resolveLocalIncludeOutcome,
  type LocalIncludeOutcome,
  type WorkspacePort,
} from '../../../src/core/localInclude';
import { readBoundedTextFile } from '../../../src/adapters/node/readTextFile';
import type { ComponentParameter, ParameterDefault } from '../../../src/types/git-component';

/** `tests/fixtures`, the workspace root the extension-host suite opens; fixture `local:` paths are relative to it. */
export const FIXTURES_ROOT = resolve(__dirname, '../../fixtures');

/** A filesystem {@link WorkspacePort} rooted at {@link FIXTURES_ROOT}, like the extension-host workspace. */
export const fixtureWorkspace: WorkspacePort<string> = {
  roots: () => [FIXTURES_ROOT],
  resolutionRoot: async () => FIXTURES_ROOT,
  readText: readBoundedTextFile,
};

export async function readFixture(name: string): Promise<{ file: string; text: string }> {
  const file = join(FIXTURES_ROOT, name, '.gitlab-ci.yml');
  return { file, text: await readFile(file, 'utf8') };
}

/** Resolves `local:` paths in `forFile` the way the core does, reading fixtures from disk. */
export function resolveFixtureLocalInclude(localPath: string, forFile = join(FIXTURES_ROOT, '.gitlab-ci.yml')): Promise<LocalIncludeOutcome> {
  return resolveLocalIncludeOutcome(localPath, forFile, fixtureWorkspace);
}

/** A parameter exactly as the local-include parser builds it, `default`/`options` keys included. */
export function localParam(
  name: string,
  description: string,
  type: string,
  defaultValue?: ParameterDefault
): ComponentParameter {
  return { name, description, required: defaultValue === undefined, type, default: defaultValue, options: undefined };
}
