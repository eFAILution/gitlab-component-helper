/**
 * Content-Security-Policy plumbing for webview documents.
 *
 * `vscode`-free and pure so the unit suite can drive it directly: `cspMetaTag` takes the webview's `cspSource` as a
 * string rather than the webview itself, leaving `src/webview/webviewHtml.ts` to hold the parts that need the API.
 */

const NONCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const NONCE_LENGTH = 32;

/**
 * Generates a random nonce for the CSP `script-src 'nonce-...'` directive.
 *
 * The alphabet is 64 characters so that indexing by a random byte (`byte % 64`) draws uniformly — a 62-character
 * alphabet would over-represent its first two characters. `crypto.getRandomValues` is available in the extension
 * host runtime and is preferred over `Math.random` for a value that gates script execution.
 *
 * @returns 32 characters drawn from `[A-Za-z0-9-_]`, unique per call.
 */
export function createNonce(): string {
  const bytes = new Uint8Array(NONCE_LENGTH);
  crypto.getRandomValues(bytes);
  let nonce = '';
  for (const byte of bytes) {
    nonce += NONCE_CHARS[byte % NONCE_CHARS.length];
  }
  return nonce;
}

/**
 * Builds the Content-Security-Policy meta tag for a webview document.
 *
 * Styles and scripts must come from files under the webview's own origin — no inline `<style>`, no `style=`
 * attribute, and scripts only with the supplied nonce. Theme colours reach an external stylesheet as CSS custom
 * properties (`var(--vscode-*)`), so nothing here needs inline style capability. A document that inlines a style
 * will be blocked, which is the signal to move it into a stylesheet.
 *
 * @param cspSource The webview's `cspSource`, naming the origin its own assets are served from.
 * @param nonce     The per-render nonce, as returned by {@link createNonce}.
 * @returns         A `<meta http-equiv="Content-Security-Policy">` tag, for the document's `<head>`.
 */
export function cspMetaTag(cspSource: string, nonce: string): string {
  return [
    `<meta http-equiv="Content-Security-Policy" content="`,
    `default-src 'none'; `,
    `style-src ${cspSource}; `,
    `img-src ${cspSource} https: data:; `,
    `font-src ${cspSource}; `,
    `script-src 'nonce-${nonce}';`,
    `">`,
  ].join('');
}
