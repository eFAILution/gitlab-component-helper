/**
 * Client script for the "no component sources configured" view.
 *
 * Runs in the webview, not the extension host. Handlers are bound here rather than with `onclick` attributes, which
 * the document's nonce-based CSP blocks.
 */

const vscode = acquireVsCodeApi();

document.querySelector('[data-action="openSettings"]')?.addEventListener('click', () => {
  vscode.postMessage({ command: 'openSettings' });
});

export {};
