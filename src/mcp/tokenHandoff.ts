/**
 * One-time token hand-off from the extension to the MCP server it launches. A process's starting environment stays
 * readable to the same user (`ps eww`, `/proc/<pid>/environ`) even after the server deletes a variable, so the
 * extension writes the tokens to a private file instead and passes only its path. The server reads the file once and
 * deletes it; the extension deletes any file the server never picked up.
 */

import { randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { chmod, lstat, mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The variable holding the hand-off file's path. */
export const HANDOFF_ENV = 'GCH_TOKENS_HANDOFF';
/** How long the extension keeps a hand-off file the server hasn't read. */
export const HANDOFF_TTL_MS = 30_000;

const HANDOFF_FILE_PATTERN = /^gch-tokens-[0-9a-f]{32}\.json$/;
const HANDOFF_NAME_BYTES = 16;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;
const GROUP_OR_OTHER_BITS = 0o077;
/** A host-to-token map is tiny; anything bigger isn't ours. */
const MAX_HANDOFF_BYTES = 64 * 1024;
const POSIX = process.platform !== 'win32';

/**
 * Write the tokens to a new private file in `dir`.
 *
 * @returns The file's path, or `undefined` when there are no tokens to hand over.
 */
export async function writeTokenHandoff(dir: string, tokens: ReadonlyMap<string, string>): Promise<string | undefined> {
  if (tokens.size === 0) return undefined;
  await mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  if (POSIX) await chmod(dir, PRIVATE_DIR_MODE);
  const file = join(dir, `gch-tokens-${randomBytes(HANDOFF_NAME_BYTES).toString('hex')}.json`);
  await writeFile(file, JSON.stringify(Object.fromEntries(tokens)), { flag: 'wx', mode: PRIVATE_FILE_MODE });
  return file;
}

/** Delete a hand-off file if it is still there. */
export async function removeTokenHandoff(file: string): Promise<void> {
  await unlink(file).catch(() => undefined);
}

/**
 * Delete hand-off files left in `dir` by a server that never started. Every VS Code window shares the directory, so
 * only files older than `olderThanMs` go: a fresh one may belong to another window's server that is starting now.
 */
export async function purgeTokenHandoffs(dir: string, olderThanMs: number = HANDOFF_TTL_MS, now: number = Date.now()): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(names.filter((name) => HANDOFF_FILE_PATTERN.test(name)).map(async (name) => {
    const file = join(dir, name);
    const stats = await lstat(file).catch(() => undefined);
    if (stats && now - stats.mtimeMs >= olderThanMs) await removeTokenHandoff(file);
  }));
}

/** Why a hand-off file can't be trusted, or `undefined` when it can. */
function handoffProblem(stats: { isFile(): boolean; mode: number; uid: number; size: number }): string | undefined {
  if (!stats.isFile()) return 'it is not a regular file';
  if (POSIX && (stats.mode & GROUP_OR_OTHER_BITS) !== 0) return 'it is readable by other users';
  if (POSIX && typeof process.getuid === 'function' && stats.uid !== process.getuid()) return 'it is owned by another user';
  if (stats.size > MAX_HANDOFF_BYTES) return 'it is too large';
  return undefined;
}

/**
 * Read a hand-off file once and delete it. Refuses (without reading) a symlink, a file other users can read or own,
 * or an oversized file.
 *
 * @returns The file's text, or `undefined` (with a warning that never includes its contents) when it was refused.
 */
export function readTokenHandoff(file: string, warn: (message: string) => void): string | undefined {
  try {
    const problem = handoffProblem(lstatSync(file));
    if (problem) {
      warn(`Ignoring the token hand-off file: ${problem}`);
      return undefined;
    }
    const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const openedProblem = handoffProblem(fstatSync(fd));
      if (openedProblem) {
        warn(`Ignoring the token hand-off file: ${openedProblem}`);
        return undefined;
      }
      return readFileSync(fd, 'utf8');
    } finally {
      closeSync(fd);
      unlinkSync(file);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown error';
    warn(`Ignoring the token hand-off file: it could not be read (${code})`);
    return undefined;
  }
}
