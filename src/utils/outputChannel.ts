/**
 * The output channel is created lazily on first use so that simply importing this module (transitively, via Logger)
 * does not require the `vscode` API to be available. Tests that exercise non-UI src modules from plain Node will hit
 * the in-memory fallback below; the real extension host hits the lazy `vscode.window.createOutputChannel` call.
 */

import { createRequire } from 'node:module';
import type { OutputChannel } from 'vscode';

const requireFn = createRequire(__filename);

/**
 * Subset of `vscode.OutputChannel` that the lazy proxy implements. `appendLine` is picked straight from the real
 * type so structural drift trips the compiler; `show` is narrowed by hand to the modern `(preserveFocus?: boolean)`
 * overload — `Pick` would keep both overloads and leave a single-arg forward ambiguous.
 */
type OutputChannelProxy = Pick<OutputChannel, 'appendLine'> & {
  show(preserveFocus?: boolean): void;
};

let channel: OutputChannelProxy | undefined;

/**
 * Resolves the underlying output channel on first use, caching the result.
 *
 * Under the extension host this returns a real `vscode.OutputChannel`; under plain Node (e.g. unit tests) it falls
 * back to a no-op stub so the exported `outputChannel` proxy is safe to call from any environment.
 */
function resolveChannel(): OutputChannelProxy {
  if (channel) return channel;
  try {
    const vscode = requireFn('vscode');
    return (channel = vscode.window.createOutputChannel('GitLab Component Helper'));
  } catch {
    return (channel = { appendLine: () => undefined, show: () => undefined });
  }
}

/**
 * Public proxy onto the lazily-resolved output channel. Forwards each call through `resolveChannel()` so importers
 * never touch the underlying `vscode.OutputChannel` directly, keeping module load free of `vscode` side effects.
 */
export const outputChannel: OutputChannelProxy = {
  appendLine: (value) => resolveChannel().appendLine(value),
  show: (preserveFocus) => resolveChannel().show(preserveFocus),
};
