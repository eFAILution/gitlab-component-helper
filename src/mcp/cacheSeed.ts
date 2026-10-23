/**
 * A copy of the extension's component cache for the MCP server it launches, so the server starts warm (ADR-372).
 * The extension can't share its cache directly: it lives in VS Code's global state, which only the extension can
 * read. So the extension rewrites one file in its private storage folder at each launch and whenever its cache changes,
 * and passes the path in `GCH_CACHE_SEED`. A running server re-reads the file when it changes. Specs aren't secret, so the file stays put. The server only reads it, bounded and shape-checked,
 * and sanitizes what it returns the same as any fetched spec.
 */

import { randomBytes } from 'node:crypto';
import { chmod, mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readBoundedTextFile } from '../adapters/node/readTextFile';
import type { CachedComponent } from '../types/cache';
import { isPinnedRef, specKey, toSpecComponent, type SeedSnapshot, type SeedSource, type SpecCacheEntry } from './specCache';

/** The variable holding the seed file's path. */
export const CACHE_SEED_ENV = 'GCH_CACHE_SEED';
/** The folder the extension writes the seed file to, under its global storage. */
export const CACHE_SEED_DIR_NAME = 'mcp-seed';

const SEED_FILE_NAME = 'components.json';
const SEED_SCHEMA = 1;
/** A few thousand specs is a few MB; anything bigger isn't ours. */
export const MAX_SEED_BYTES = 16 * 1024 * 1024;
export const MAX_SEED_ENTRIES = 5000;
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;
const TEMP_SUFFIX_BYTES = 6;
const POSIX = process.platform !== 'win32';

interface SeedComponent {
  gitlabInstance: string;
  sourcePath: string;
  name: string;
  version: string;
  description: string;
  parameters: CachedComponent['parameters'];
  source?: string;
  refType?: string;
  cachedAt?: number;
}

export interface CacheSeed {
  schema: number;
  /** Epoch ms the extension last reset its cache. The server drops what it fetched before then. */
  clearedAt?: number;
  components: SeedComponent[];
}

/** Only the spec fields of each entry: no raw template YAML, and nothing that isn't needed to answer a tool call. */
export function buildCacheSeed(components: readonly CachedComponent[], clearedAt = 0): CacheSeed {
  return {
    schema: SEED_SCHEMA,
    ...(clearedAt > 0 ? { clearedAt } : {}),
    components: components.slice(0, MAX_SEED_ENTRIES).map((component) => ({
      gitlabInstance: component.gitlabInstance,
      sourcePath: component.sourcePath,
      name: component.name,
      version: component.version,
      description: component.description,
      parameters: component.parameters,
      ...(component.source ? { source: component.source } : {}),
      ...(component.refType ? { refType: component.refType } : {}),
      ...(component.cachedAt ? { cachedAt: component.cachedAt } : {}),
    })),
  };
}

/** Replace the seed file in `dir` (atomically, 0600 in a 0700 folder). @returns Its path. */
export async function writeCacheSeed(dir: string, seed: CacheSeed): Promise<string> {
  await mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  if (POSIX) await chmod(dir, PRIVATE_DIR_MODE);
  const file = join(dir, SEED_FILE_NAME);
  const temp = `${file}.${process.pid}.${randomBytes(TEMP_SUFFIX_BYTES).toString('hex')}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(seed), { mode: PRIVATE_FILE_MODE, flag: 'wx' });
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  return file;
}

function toSeedEntry(value: unknown): [string, SpecCacheEntry] | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { gitlabInstance, sourcePath, name, version, refType, cachedAt } = value as Record<string, unknown>;
  if (typeof gitlabInstance !== 'string' || typeof sourcePath !== 'string' || typeof name !== 'string' || typeof version !== 'string') {
    return undefined;
  }
  const component = toSpecComponent(value);
  if (!component) return undefined;
  return [
    specKey({ gitlabInstance, sourcePath, name, version }),
    {
      component,
      // The extension only times branch entries. Without a time, a branch entry counts as stale and is fetched again.
      fetchedAt: typeof cachedAt === 'number' && Number.isFinite(cachedAt) ? cachedAt : 0,
      pinned: isPinnedRef(version, typeof refType === 'string' ? refType : undefined),
    },
  ];
}

/**
 * Read a seed file. A missing, oversized, or malformed file is no seed at all: the server just fetches.
 *
 * @param warn Told why a seed that exists was not used. Never given file contents.
 */
export async function readCacheSeed(file: string, warn: (message: string) => void): Promise<SeedSnapshot> {
  const none: SeedSnapshot = { entries: new Map(), clearedAt: 0 };
  const text = await readBoundedTextFile(file, MAX_SEED_BYTES);
  if (text === null) return none;
  let seed: unknown;
  try {
    seed = JSON.parse(text);
  } catch {
    warn(`${CACHE_SEED_ENV} is not valid JSON; not using it`);
    return none;
  }
  const { schema, components, clearedAt } = (seed ?? {}) as Partial<CacheSeed>;
  if (schema !== SEED_SCHEMA || !Array.isArray(components)) {
    warn(`${CACHE_SEED_ENV} is not a cache seed this server reads; not using it`);
    return none;
  }
  const entries = new Map(
    components.slice(0, MAX_SEED_ENTRIES).flatMap((value) => {
      const entry = toSeedEntry(value);
      return entry ? [entry] : [];
    })
  );
  return { entries, clearedAt: typeof clearedAt === 'number' && Number.isFinite(clearedAt) ? clearedAt : 0 };
}

/** The seed file as the spec cache reads it: its mtime says when to read it again. */
export function fileSeedSource(file: string, warn: (message: string) => void): SeedSource {
  return {
    read: () => readCacheSeed(file, warn),
    stamp: async () => {
      try {
        return (await stat(file)).mtimeMs;
      } catch {
        return undefined;
      }
    },
  };
}
