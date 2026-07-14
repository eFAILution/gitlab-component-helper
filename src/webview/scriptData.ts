/**
 * Safe serialization of data embedded directly into a webview `<script>` block.
 *
 * `vscode`-free and pure so the unit suite can drive it directly. `JSON.stringify` alone is unsafe inside a
 * `<script>` element: the HTML tokenizer terminates the script at the first literal `</script>` (or `<!--`)
 * regardless of JavaScript string context, so a value containing `</script>` could break out and inject
 * markup — reachable now that component descriptions come from third-party READMEs and version lists from
 * third-party git tags. Escaping `<` (the load-bearing one), plus `>` and `&` for good measure, to their
 * `\uXXXX` forms keeps the output valid JSON/JS while making breakout impossible.
 */

/**
 * Serialize `value` as JSON safe to embed directly in a webview `<script>` block.
 *
 * @param value Any JSON-serializable value.
 * @returns     `JSON.stringify(value)` with `<`, `>` and `&` replaced by `\uXXXX` escapes, or `'null'`
 *              when `value` is not serializable (e.g. `undefined`).
 */
export function serializeForScript(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) {
    return 'null';
  }
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}
