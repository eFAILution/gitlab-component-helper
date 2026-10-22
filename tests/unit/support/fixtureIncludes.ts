import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseLocalIncludeText, type LocalIncludeOutcome } from '../../../src/core/localInclude';
import type { ComponentParameter, ParameterDefault } from '../../../src/types/git-component';

/** `tests/fixtures`, the workspace root the extension-host suite opens; fixture `local:` paths are relative to it. */
export const FIXTURES_ROOT = resolve(__dirname, '../../fixtures');

export async function readFixture(name: string): Promise<{ file: string; text: string }> {
  const file = join(FIXTURES_ROOT, name, '.gitlab-ci.yml');
  return { file, text: await readFile(file, 'utf8') };
}

/** Resolves `local:` paths against {@link FIXTURES_ROOT} from disk, like the extension does for an unopened file. */
export async function resolveFixtureLocalInclude(localPath: string): Promise<LocalIncludeOutcome> {
  const absolute = join(FIXTURES_ROOT, ...localPath.replace(/^\/+/, '').split('/'));
  try {
    return parseLocalIncludeText(localPath, await readFile(absolute, 'utf8'), absolute);
  } catch {
    return { kind: 'unreadable' };
  }
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
