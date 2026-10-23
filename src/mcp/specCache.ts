/**
 * The MCP server's cache of component specs, so a tool call doesn't go back to GitLab for a spec it already has
 * (ADR-372). A spec pinned to a tag is reused as long as it's cached, the same as the extension does. One pinned to
 * anything else (a branch, `~latest`, a partial version) can move, so it's only reused for `cacheTime`. Failed
 * fetches are never stored.
 */

import type { StoragePort } from '../core/ports';
import type { ComponentParameter } from '../types/git-component';
import { isCleanSemver } from '../utils/semver';
import type { SpecComponent } from './tools/getComponentSpec';

export const SPEC_CACHE_KEY = 'mcp-spec-cache';
const SPEC_CACHE_SCHEMA = 1;
/** Enough for a large monorepo's includes; the oldest entries go first past this. */
export const MAX_SPEC_ENTRIES = 500;

/** Where a spec lives: the parts of a component reference that pick one spec. */
export interface SpecIdentity {
  gitlabInstance: string;
  sourcePath: string;
  name: string;
  version: string;
}

export interface SpecCacheEntry {
  component: SpecComponent;
  /** Epoch ms the spec was fetched. 0 when unknown, which only a tag-pinned entry survives. */
  fetchedAt: number;
  /** The ref is a tag, so the spec is taken as fixed. */
  pinned: boolean;
}

export interface SpecCache {
  get(identity: SpecIdentity): Promise<SpecComponent | undefined>;
  set(identity: SpecIdentity, component: SpecComponent): void;
}

export interface SpecCacheOptions {
  storage: StoragePort;
  cacheTimeMs(): number;
  now?: () => number;
  /** Entries to fall back on when the server's own cache has none for a spec (the extension's cache). */
  seed?: SeedSource;
}

export interface SeedSnapshot {
  entries: ReadonlyMap<string, SpecCacheEntry>;
  /** Epoch ms the extension last reset its cache, or 0. */
  clearedAt: number;
}

export interface SeedSource {
  read(): Promise<SeedSnapshot>;
  /** Changes whenever the seed does (its file's mtime), or `undefined` when there's no seed. */
  stamp(): Promise<number | undefined>;
}

interface StoredSpecCache {
  schema: number;
  entries: Array<[string, unknown]>;
}

export function specKey({ gitlabInstance, sourcePath, name, version }: SpecIdentity): string {
  return `${gitlabInstance.toLowerCase()}/${sourcePath}/${name}@${version}`;
}

export const isPinnedRef = (version: string, refType?: string): boolean =>
  refType === undefined ? isCleanSemver(version) : refType === 'tag';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const optionalString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

function toParameter(value: unknown): ComponentParameter | undefined {
  if (!isRecord(value) || typeof value.name !== 'string') return undefined;
  const options = Array.isArray(value.options)
    ? value.options.filter((option): option is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof option))
    : undefined;
  return {
    name: value.name,
    description: optionalString(value.description) ?? '',
    required: value.required === true,
    type: optionalString(value.type) ?? 'string',
    ...(value.default !== undefined ? { default: value.default as ComponentParameter['default'] } : {}),
    ...(options ? { options } : {}),
  };
}

/** The spec fields of a stored or seeded component, or `undefined` when it isn't shaped like one. */
export function toSpecComponent(value: unknown): SpecComponent | undefined {
  if (!isRecord(value) || typeof value.name !== 'string' || !Array.isArray(value.parameters)) return undefined;
  const parameters = value.parameters.map(toParameter);
  if (parameters.some((parameter) => parameter === undefined)) return undefined;
  const version = optionalString(value.version);
  const source = optionalString(value.source);
  const documentationUrl = optionalString(value.documentationUrl);
  return {
    name: value.name,
    description: optionalString(value.description) ?? '',
    parameters: parameters as ComponentParameter[],
    ...(version ? { version } : {}),
    ...(source ? { source } : {}),
    ...(documentationUrl ? { documentationUrl } : {}),
  };
}

function toEntry(value: unknown): SpecCacheEntry | undefined {
  if (!isRecord(value) || typeof value.fetchedAt !== 'number' || typeof value.pinned !== 'boolean') return undefined;
  const component = toSpecComponent(value.component);
  return component && { component, fetchedAt: value.fetchedAt, pinned: value.pinned };
}

async function loadStored(storage: StoragePort): Promise<Map<string, SpecCacheEntry>> {
  const stored = await storage.get<StoredSpecCache>(SPEC_CACHE_KEY).catch(() => undefined);
  if (!isRecord(stored) || stored.schema !== SPEC_CACHE_SCHEMA || !Array.isArray(stored.entries)) return new Map();
  return new Map(
    stored.entries.flatMap((pair): Array<[string, SpecCacheEntry]> => {
      const entry = Array.isArray(pair) && typeof pair[0] === 'string' ? toEntry(pair[1]) : undefined;
      return entry ? [[pair[0] as string, entry]] : [];
    })
  );
}

/** The newest `MAX_SPEC_ENTRIES` entries. */
function newest(entries: Map<string, SpecCacheEntry>): Array<[string, SpecCacheEntry]> {
  return [...entries].sort(([, a], [, b]) => b.fetchedAt - a.fetchedAt).slice(0, MAX_SPEC_ENTRIES);
}

export function createSpecCache({ storage, cacheTimeMs, now = Date.now, seed }: SpecCacheOptions): SpecCache {
  let own: Promise<Map<string, SpecCacheEntry>> | undefined;
  const loadOwn = () => (own ??= loadStored(storage));
  // Writes go one at a time, so a slow write never lands after a newer one.
  let writing: Promise<void> = Promise.resolve();
  const persist = (entries: Map<string, SpecCacheEntry>) => {
    const kept = newest(entries);
    entries.clear();
    kept.forEach(([key, entry]) => entries.set(key, entry));
    const snapshot: StoredSpecCache = { schema: SPEC_CACHE_SCHEMA, entries: kept };
    // A failed write only costs a refetch next session.
    writing = writing.then(() => storage.update(SPEC_CACHE_KEY, snapshot)).catch(() => undefined);
  };

  const seeded = createSeedView(seed, now, async (clearedAt) => {
    // The extension's cache was reset: what this server fetched before then goes too.
    const entries = await loadOwn();
    const before = entries.size;
    [...entries].filter(([, entry]) => entry.fetchedAt < clearedAt).forEach(([key]) => entries.delete(key));
    if (entries.size !== before) persist(entries);
  });
  const isFresh = (entry: SpecCacheEntry) => entry.pinned || now() - entry.fetchedAt < cacheTimeMs();

  return {
    get: async (identity) => {
      const seedEntries = await seeded();
      const key = specKey(identity);
      const entry = [(await loadOwn()).get(key), seedEntries.get(key)].find((candidate) => candidate && isFresh(candidate));
      return entry?.component;
    },
    set: (identity, component) => {
      // Only the spec fields: a fetched component also carries its raw template and other bulk.
      const spec = toSpecComponent(component);
      if (!spec) return;
      void loadOwn().then((entries) => {
        entries.set(specKey(identity), { component: spec, fetchedAt: now(), pinned: isPinnedRef(identity.version) });
        persist(entries);
      });
    },
  };
}

/** How often a running server looks for a newer seed: at most one `stat` per lookup burst. */
export const SEED_CHECK_INTERVAL_MS = 1000;

/**
 * The seed's entries, re-read when its file changes, so a running server sees what the extension caches later. Calls
 * `onCleared` when the seed reports a cache reset newer than the last one seen.
 */
function createSeedView(
  seed: SeedSource | undefined,
  now: () => number,
  onCleared: (clearedAt: number) => Promise<void>
): () => Promise<ReadonlyMap<string, SpecCacheEntry>> {
  let entries: ReadonlyMap<string, SpecCacheEntry> = new Map();
  let stamp: number | undefined;
  let clearedAt = 0;
  let checkedAt = Number.NEGATIVE_INFINITY;
  let checking: Promise<void> | undefined;

  const check = async () => {
    if (!seed) return;
    const current = await seed.stamp().catch(() => undefined);
    if (current === undefined || current === stamp) return;
    stamp = current;
    const snapshot = await seed.read().catch(() => ({ entries: new Map<string, SpecCacheEntry>(), clearedAt: 0 }));
    entries = snapshot.entries;
    if (snapshot.clearedAt > clearedAt) {
      clearedAt = snapshot.clearedAt;
      await onCleared(clearedAt);
    }
  };

  return async () => {
    if (now() - checkedAt >= SEED_CHECK_INTERVAL_MS) {
      checkedAt = now();
      checking ??= check().finally(() => {
        checking = undefined;
      });
    }
    await checking;
    return entries;
  };
}
