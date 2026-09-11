import * as vscode from 'vscode';

/**
 * Shared helpers for rendering webview HTML with a Content-Security-Policy,
 * a per-render nonce, and webview-safe asset URIs.
 *
 * VS Code webviews cannot load extension files by path: every <link>/<script>
 * src must be passed through webview.asWebviewUri, and a CSP restricts which
 * origins and inline content are allowed. A nonce permits exactly the scripts
 * we emit while still blocking arbitrary inline script injection.
 */

const NONCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const NONCE_LENGTH = 32;

/**
 * Generates a random nonce for the CSP `script-src 'nonce-...'` directive.
 * `crypto.getRandomValues` is available in the extension host runtime and is
 * preferred over Math.random for a value that gates script execution.
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
 * Resolves an asset under the webview output directory to a webview-safe URI.
 * `relativePath` is relative to `out/webview` (e.g. 'styles/loading.css').
 */
export function assetUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  relativePath: string
): vscode.Uri {
  const parts = relativePath.split('/').filter(Boolean);
  return webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', ...parts)
  );
}

/**
 * Builds the Content-Security-Policy meta tag for a webview document.
 *
 * Styles and scripts must come from files under the webview's own origin — no inline `<style>`, no `style=`
 * attribute, and scripts only with the supplied nonce. Theme colours reach an external stylesheet as CSS custom
 * properties (`var(--vscode-*)`), so nothing here needs inline style capability. A document that inlines a style
 * will be blocked, which is the signal to move it into a stylesheet.
 */
export function cspMetaTag(webview: vscode.Webview, nonce: string): string {
  const source = webview.cspSource;
  return [
    `<meta http-equiv="Content-Security-Policy" content="`,
    `default-src 'none'; `,
    `style-src ${source}; `,
    `img-src ${source} https: data:; `,
    `font-src ${source}; `,
    `script-src 'nonce-${nonce}';`,
    `">`,
  ].join('');
}
