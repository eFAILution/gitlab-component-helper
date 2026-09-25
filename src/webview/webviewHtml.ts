import * as vscode from 'vscode';

/**
 * Webview-safe asset URIs and resource roots.
 *
 * VS Code webviews cannot load extension files by path: every `<link>`/`<script>` src must be passed through
 * `webview.asWebviewUri`, and the panel must declare the roots it may load from. The CSP and nonce helpers live in
 * `./csp` so they stay `vscode`-free and unit-testable; they are re-exported here so callers have one import.
 */

export { createNonce, cspMetaTag } from './csp';

/** Directory the webview build emits to, relative to the extension root. */
const ASSET_ROOT = ['out', 'webview'];

/**
 * Resolves an asset under the webview output directory to a webview-safe URI.
 *
 * @param webview      The webview the URI is being resolved for.
 * @param extensionUri The extension's root URI, from the activation context.
 * @param relativePath Path under `out/webview`, e.g. `styles/loading.css`. `.` and `..` segments are rejected so a
 *                     computed path cannot escape the asset root the panel declares.
 * @returns            A `vscode-webview://` URI the document can load the asset from.
 * @throws             If `relativePath` is empty or contains a `.` or `..` segment.
 */
export function assetUri(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  relativePath: string
): vscode.Uri {
  const parts = relativePath.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some(part => part === '.' || part === '..')) {
    throw new Error(`Invalid webview asset path: ${relativePath}`);
  }
  return webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, ...ASSET_ROOT, ...parts)
  );
}

/**
 * The `localResourceRoots` a panel needs to load anything {@link assetUri} resolves.
 *
 * A webview may only load local files from the roots its panel declares, and an empty array permits nothing. Every
 * panel rendering a document with a `<link>` or `<script>` asset must pass this.
 *
 * @param extensionUri The extension's root URI, from the activation context.
 * @returns            The roots to pass as a panel's `localResourceRoots`.
 */
export function assetRoots(extensionUri: vscode.Uri): vscode.Uri[] {
  return [vscode.Uri.joinPath(extensionUri, ...ASSET_ROOT)];
}
