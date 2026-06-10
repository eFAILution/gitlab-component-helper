// @mocha
/**
 * Tests src/utils/branchFreshness.ts — the pure two-phase branch-cache staleness decision that decides whether a
 * cached branch entry can be served or must be revalidated/re-fetched.
 *
 * Regression coverage for the bug where a repeat hover of `@branch` served stale metadata: once the TTL has elapsed,
 * a moved branch HEAD must resolve to `check-head` → stale → re-fetch.
 */

import * as assert from 'node:assert/strict';
import {
  evaluateBranchFreshness,
  isBranchHeadStale,
  resolveBranchFreshness,
  type BranchFreshnessEntry,
} from '../../src/utils/branchFreshness';

const TTL = 60_000; // 60s
const NOW = 1_000_000;

suite('evaluateBranchFreshness', () => {
  test('tag refs always serve (never need a HEAD check)', () => {
    // Even with an elapsed TTL and a recorded SHA, a tag short-circuits to serve.
    const step = evaluateBranchFreshness(
      { refType: 'tag', cachedAt: NOW - 10 * TTL, resolvedSha: 'abc' },
      TTL,
      NOW
    );
    assert.deepStrictEqual(step, { action: 'serve' });
  });

  test('branch within the TTL window serves without a HEAD check', () => {
    const step = evaluateBranchFreshness(
      { refType: 'branch', cachedAt: NOW - 30_000, resolvedSha: 'abc' },
      TTL,
      NOW
    );
    assert.deepStrictEqual(step, { action: 'serve' });
  });

  test('branch past the TTL with a recorded SHA needs a HEAD check', () => {
    const step = evaluateBranchFreshness(
      { refType: 'branch', cachedAt: NOW - 90_000, resolvedSha: 'abc' },
      TTL,
      NOW
    );
    assert.deepStrictEqual(step, { action: 'check-head' });
  });

  test('branch past the TTL with no recorded SHA serves (nothing to compare)', () => {
    const step = evaluateBranchFreshness(
      { refType: 'branch', cachedAt: NOW - 90_000, resolvedSha: undefined },
      TTL,
      NOW
    );
    assert.deepStrictEqual(step, { action: 'serve' });
  });

  test('branch with no timestamp but a recorded SHA needs a HEAD check', () => {
    // No cachedAt → not within any window → fall through to the SHA comparison.
    const step = evaluateBranchFreshness(
      { refType: 'branch', cachedAt: undefined, resolvedSha: 'abc' },
      TTL,
      NOW
    );
    assert.deepStrictEqual(step, { action: 'check-head' });
  });

  test('a ref with no resolved refType is treated as a branch', () => {
    const step = evaluateBranchFreshness(
      { refType: undefined, cachedAt: NOW - 90_000, resolvedSha: 'abc' },
      TTL,
      NOW
    );
    assert.deepStrictEqual(step, { action: 'check-head' });
  });
});

suite('isBranchHeadStale', () => {
  test('stale when the branch HEAD has moved (regression: repeat hover of a moved @branch)', () => {
    assert.strictEqual(isBranchHeadStale('abc123', 'def456'), true);
  });

  test('fresh when the branch HEAD is unchanged', () => {
    assert.strictEqual(isBranchHeadStale('abc123', 'abc123'), false);
  });

  test('keeps cache when the live HEAD could not be resolved (offline / no access)', () => {
    assert.strictEqual(isBranchHeadStale('abc123', undefined), false);
  });

  test('keeps cache when there is no recorded SHA', () => {
    assert.strictEqual(isBranchHeadStale(undefined, 'def456'), false);
  });
});

suite('resolveBranchFreshness (caller interaction)', () => {
  const TTL = 60_000;

  // A controllable clock + resolver stubs standing in for the GitLab service.
  function makeDeps(opts: { start: number; headSha?: string }) {
    let clock = opts.start;
    let headCalls = 0;
    return {
      advance: (ms: number) => { clock += ms; },
      headCalls: () => headCalls,
      deps: {
        now: () => clock,
        resolveRefType: async (cached?: 'branch' | 'tag') => cached ?? 'branch',
        resolveHeadSha: async () => { headCalls += 1; return opts.headSha; },
      },
    };
  }

  test('within-TTL serves do NOT advance cachedAt or hit the remote (window cannot slide)', async () => {
    const entry: BranchFreshnessEntry = { refType: 'branch', cachedAt: 1000, resolvedSha: 'abc' };
    const h = makeDeps({ start: 1000, headSha: 'abc' });

    // Repeat hovers at 20s and 50s — both still inside the 60s window relative to the ORIGINAL cachedAt (1000).
    for (const elapsed of [20_000, 50_000]) {
      h.advance(1000 + elapsed - h.deps.now());
      const r = await resolveBranchFreshness(entry, TTL, h.deps);
      assert.strictEqual(r.stale, false);
      assert.strictEqual(r.mutated, false);
    }
    // The serve path left cachedAt untouched, so the window is anchored to the original verification, not the hovers —
    // no HEAD check fired, and once real time passes 60s the next hover WILL check (covered by the regression test).
    assert.strictEqual(entry.cachedAt, 1000);
    assert.strictEqual(h.headCalls(), 0);
  });

  test('regression: repeat hovers within TTL still refetch once the TTL lapses and the HEAD has moved', async () => {
    // cachedAt fixed at 1000; HEAD has moved on the remote (recorded abc, live def).
    const entry: BranchFreshnessEntry = { refType: 'branch', cachedAt: 1000, resolvedSha: 'abc' };
    const h = makeDeps({ start: 1000, headSha: 'def' });

    // Hover within the window first — served, no HEAD check, window not slid.
    h.advance(30_000);
    let r = await resolveBranchFreshness(entry, TTL, h.deps);
    assert.strictEqual(r.stale, false);
    assert.strictEqual(h.headCalls(), 0);

    // Now past the TTL relative to the original cachedAt — HEAD check fires, sees the move, reports stale.
    h.advance(40_000); // now 70_000, i.e. 69s since cachedAt
    r = await resolveBranchFreshness(entry, TTL, h.deps);
    assert.strictEqual(r.stale, true);
    assert.strictEqual(h.headCalls(), 1);
  });

  test('verified-fresh HEAD check stamps cachedAt as the new "last verified" time', async () => {
    const entry: BranchFreshnessEntry = { refType: 'branch', cachedAt: 1000, resolvedSha: 'abc' };
    const h = makeDeps({ start: 90_000, headSha: 'abc' }); // past TTL, HEAD unchanged

    const r = await resolveBranchFreshness(entry, TTL, h.deps);
    assert.strictEqual(r.stale, false);
    assert.strictEqual(r.mutated, true);
    assert.strictEqual(entry.cachedAt, 90_000); // window restarts from the verification, not the serve
    assert.strictEqual(h.headCalls(), 1);
  });

  test('resolving an unset refType marks the entry mutated (so it gets persisted)', async () => {
    const entry: BranchFreshnessEntry = { refType: undefined, cachedAt: 90_000, resolvedSha: 'abc' };
    const h = makeDeps({ start: 90_000, headSha: 'abc' });

    const r = await resolveBranchFreshness(entry, TTL, h.deps);
    assert.strictEqual(entry.refType, 'branch');
    assert.strictEqual(r.mutated, true);
  });
});
