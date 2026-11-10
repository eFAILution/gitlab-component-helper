/**
 * Persistent storage for the MCP server: one JSON file per key in a private cache directory (0700), written
 * atomically with 0600 permissions.
 */

import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import type { StoragePort } from '../../core/ports';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const TEMP_SUFFIX_BYTES = 6;

/** `--cache-dir`, then `GCH_CACHE_DIR`, then `$XDG_CACHE_HOME` or `~/.cache`, under `gitlab-component-helper/mcp`. */
export function resolveCacheDir(cliDir: string | undefined, env: NodeJS.ProcessEnv): string {
  if (cliDir) return path.resolve(cliDir);
  if (env.GCH_CACHE_DIR) return path.resolve(env.GCH_CACHE_DIR);
  const base = env.XDG_CACHE_HOME ? path.resolve(env.XDG_CACHE_HOME) : path.join(homedir(), '.cache');
  return path.join(base, 'gitlab-component-helper', 'mcp');
}

function fileFor(dir: string, key: string): string {
  return path.join(dir, `${encodeURIComponent(key)}.json`);
}

export function createFileStorage(dir: string): StoragePort {
  let ready: Promise<void> | undefined;
  const ensureDir = () => {
    ready ??= mkdir(dir, { recursive: true, mode: DIR_MODE }).then(() => chmod(dir, DIR_MODE));
    return ready;
  };

  return {
    persistent: true,
    get: async <T>(key: string) => {
      try {
        return JSON.parse(await readFile(fileFor(dir, key), 'utf8')) as T;
      } catch {
        return undefined;
      }
    },
    update: async (key, value) => {
      await ensureDir();
      const target = fileFor(dir, key);
      if (value === undefined) {
        await unlink(target).catch(() => undefined);
        return;
      }
      const temp = `${target}.${process.pid}.${randomBytes(TEMP_SUFFIX_BYTES).toString('hex')}.tmp`;
      try {
        await writeFile(temp, JSON.stringify(value), { mode: FILE_MODE, flag: 'wx' });
        await rename(temp, target);
      } catch (error) {
        await unlink(temp).catch(() => undefined);
        throw error;
      }
    },
  };
}
