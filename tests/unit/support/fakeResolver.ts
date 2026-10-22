import type { ReferenceResolver, UnresolvedReason } from '../../../src/core/references';

/** Expands nothing: plain references get `https://`, references with variables stay unresolved for `reason`. */
export function resolverFor(reason: UnresolvedReason): ReferenceResolver {
  return async (reference) =>
    reference.includes('$') ? { resolved: false, reason } : { resolved: true, url: `https://${reference}` };
}
