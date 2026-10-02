/**
 * Shared type-guard for "is this value usable as an input's `default:`?".
 *
 * `vscode`-free and pure so the Mocha unit suite (and `specParser`, which must load under plain Node) can import it
 * directly. Both spec parsers narrow the same union, so they share one definition rather than a copy each.
 */

import type { ParameterDefault } from '../types/git-component';

/**
 * Narrow an unknown value to {@link ParameterDefault}, the union accepted by an input's `default:` field.
 *
 * Guards the boundary where a parsed spec becomes a typed parameter: YAML and the catalog API both hand back
 * `unknown`, and anything outside the union (a mapping, a nested array) is rejected rather than carried forward as
 * a default no consumer can render.
 *
 * @param value - A value of unknown shape, typically straight from a YAML parse or an API response.
 * @returns `true` when `value` is a string, number, boolean, `null`, or an array of those primitives.
 */
export function isParameterDefault(value: unknown): value is ParameterDefault {
  if (value === null) return true;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return true;
  if (Array.isArray(value)) {
    return value.every(v => {
      const vt = typeof v;
      return vt === 'string' || vt === 'number' || vt === 'boolean';
    });
  }
  return false;
}
