/**
 * The one check a URL from component metadata passes before the details panel shows it as a link.
 *
 * `vscode`-free and pure so the unit suite can drive it directly, and shared by the HTML builder and the extension-host
 * message handler, so the first render and every later update apply the same rule.
 *
 * These URLs are attacker-influenced: `documentationUrl` comes straight from a catalog project's `documentation_url`,
 * which whoever publishes the component controls.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Accept a URL only if it is an absolute `http(s)` URL with no embedded credentials.
 *
 * Returns the *parsed* `href`, not the input, so what is displayed and opened is exactly what was validated: the URL
 * parser strips the tabs and newlines that would otherwise let `java\nscript:` through a string comparison.
 *
 * Userinfo is rejected because it is a phishing shape rather than a real use: `https://gitlab.com@evil.example/`
 * reads as a gitlab.com link and resolves to evil.example.
 *
 * @param value Candidate URL, typically from a component's metadata.
 * @returns     The normalised URL when acceptable, otherwise `undefined`.
 */
export function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return undefined;
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol) || parsed.username || parsed.password) {
    return undefined;
  }
  return parsed.href;
}
