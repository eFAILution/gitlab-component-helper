import type { RefType } from '../types/cache';

/** The cached freshness fields a staleness decision reads. */
export interface BranchFreshnessState {
  refType?: RefType;
  /** Epoch ms the entry was last fetched/revalidated. */
  cachedAt?: number;
  /** Branch HEAD SHA recorded when the entry was cached. */
  resolvedSha?: string;
}

/** Outcome of the cheap (pre-network) freshness check. */
export type FreshnessStep =
  /** Serve the cached entry without contacting the remote. */
  | { action: 'serve' }
  /** Resolve the live branch HEAD and compare it to `resolvedSha` before deciding. */
  | { action: 'check-head' };

/**
 * Cheap, pre-network half of the branch freshness decision — no I/O, no clock of its own.
 *
 * Returns `serve` when the entry can be used as-is (tag ref, still within the TTL window, or no recorded SHA to
 * compare against), and `check-head` when the TTL has elapsed and a live HEAD-SHA comparison is needed.
 *
 * @param state The cached entry's freshness fields.
 * @param ttlMs The branch TTL window in ms.
 * @param now Current epoch ms (injected for testability).
 */
export function evaluateBranchFreshness(
  state: BranchFreshnessState,
  ttlMs: number,
  now: number
): FreshnessStep {
  // Tags are taken as fixed (by convention) — never need the HEAD check.
  if (state.refType === 'tag') {
    return { action: 'serve' };
  }

  // Within the TTL window — serve without contacting the remote.
  if (typeof state.cachedAt === 'number' && now - state.cachedAt < ttlMs) {
    return { action: 'serve' };
  }

  // No recorded SHA to compare against — serve rather than re-fetch on every hover. A SHA is recorded on the next
  // genuine fetch.
  if (!state.resolvedSha) {
    return { action: 'serve' };
  }

  return { action: 'check-head' };
}

/**
 * Final half of the decision, once the live HEAD SHA has been resolved: is the cached branch entry stale?
 *
 * Stale only when both SHAs are known and differ. If either is missing (no recorded SHA, or the HEAD couldn't be
 * resolved — offline / no access) the cache is kept rather than forcing a re-fetch.
 *
 * @param recordedSha The SHA stored on the cache entry, if any.
 * @param currentSha The freshly resolved branch HEAD SHA, or undefined if it couldn't be resolved.
 * @returns `true` if the branch has demonstrably moved (both SHAs known and differ); `false` otherwise.
 */
export function isBranchHeadStale(
  recordedSha: string | undefined,
  currentSha: string | undefined
): boolean {
  if (!recordedSha || !currentSha) {
    return false;
  }
  return currentSha !== recordedSha;
}

/** The mutable freshness fields the orchestrator reads and updates in place. */
export interface BranchFreshnessEntry extends BranchFreshnessState {
  refType?: RefType;
  cachedAt?: number;
  resolvedSha?: string;
}

/** I/O the orchestrator depends on, injected so it can be driven without vscode or the network in tests. */
export interface BranchFreshnessDeps {
  /** Current epoch ms. */
  now: () => number;
  /** Classify the ref (uses the entry's existing verdict as a hint when present). */
  resolveRefType: (cached: RefType | undefined) => Promise<RefType>;
  /** Resolve the live branch HEAD SHA, or undefined if it can't be determined. */
  resolveHeadSha: () => Promise<string | undefined>;
}

/** Outcome of a freshness check. */
export interface BranchFreshnessResult {
  /** True when the cached data is stale and the caller should re-fetch. */
  stale: boolean;
  /** True when `refType`/`cachedAt` were mutated and the entry should be re-saved. */
  mutated: boolean;
}

/**
 * Resolve a cached branch entry's freshness, mutating `refType`/`cachedAt` in place.
 *
 * `cachedAt` is the "last verified against the remote" time — it is stamped ONLY after an actual HEAD comparison,
 * never on a plain within-TTL serve. This is what stops repeated within-TTL hovers from sliding the window forever and
 * starving the HEAD check (the realistic "hover the same include while editing" pattern).
 *
 * All I/O (clock, ref classification, HEAD lookup) is injected via `deps`, so this is unit-testable without vscode or
 * the network.
 *
 * @param entry The cached entry; its `refType`/`cachedAt` may be mutated.
 * @param ttlMs The branch TTL window in ms.
 * @param deps Injected clock and resolvers.
 * @returns Whether the entry is stale, and whether persistent fields were mutated (so the caller can re-save once).
 */
export async function resolveBranchFreshness(
  entry: BranchFreshnessEntry,
  ttlMs: number,
  deps: BranchFreshnessDeps
): Promise<BranchFreshnessResult> {
  const priorRefType = entry.refType;
  entry.refType = await deps.resolveRefType(priorRefType);
  let mutated = entry.refType !== priorRefType;

  const step = evaluateBranchFreshness(entry, ttlMs, deps.now());
  if (step.action === 'serve') {
    // Served without a remote check — do NOT touch `cachedAt`.
    return { stale: false, mutated };
  }

  const currentSha = await deps.resolveHeadSha();
  if (isBranchHeadStale(entry.resolvedSha, currentSha)) {
    return { stale: true, mutated };
  }

  // Verified fresh against the remote — record this as the new "last verified" time.
  entry.cachedAt = deps.now();
  mutated = true;
  return { stale: false, mutated };
}
