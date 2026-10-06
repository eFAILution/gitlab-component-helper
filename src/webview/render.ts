/**
 * Renders a webview view component to the document string `webview.html` expects.
 *
 * `vscode`-free and pure so the unit suite can drive it directly. Text and attribute values are escaped by
 * preact-render-to-string, so a view never calls `escapeHtml` itself.
 */

import { ComponentType, h } from 'preact';
import { renderToString } from 'preact-render-to-string';

/** JSX has no syntax for a doctype, so it is prepended here rather than written in each view. */
const DOCTYPE = '<!doctype html>';

/**
 * Renders a view to a complete HTML document.
 *
 * @param view  The view component, whose root must be a `Page`.
 * @param props The view's props.
 * @returns     The document string, doctype first, ready to assign to `webview.html`.
 */
export function renderDocument<P extends object>(view: ComponentType<P>, props: P): string {
  return DOCTYPE + renderToString(h(view, props));
}
