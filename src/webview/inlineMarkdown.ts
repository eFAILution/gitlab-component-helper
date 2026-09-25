/**
 * HTML-escaping and inline-Markdown rendering for text shown in webviews (component descriptions).
 *
 * `vscode`-free and pure so the unit suite can drive it directly. The webview scripts carry a client-side
 * twin of `renderInlineMarkdown` (as an injected string, since it runs in the browser); both must escape and
 * format identically, and this is the reference the twin mirrors.
 */

/**
 * Escape the five HTML-significant characters. Safe for both element text and double/single-quoted attributes.
 *
 * @param value The raw text to escape.
 * @returns     `value` with `&`, `<`, `>`, `"`, and `'` replaced by their HTML entities.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Encode a value as a JavaScript string argument inside a double-quoted HTML event-handler attribute, e.g.
 * `onclick="insertComponentById(${handlerArg(name)})"`.
 *
 * Two contexts, so two encodings, in order: `JSON.stringify` makes a JS string literal (escaping `"` and `\\`), then
 * {@link escapeHtml} makes that safe inside the attribute. `escapeHtml` alone is not enough, because the browser decodes
 * `&#39;` back to `'` before the handler runs, so a value containing a quote breaks out of `'...'` into code.
 *
 * @param value The value to pass; `undefined` becomes an empty string.
 * @returns     Attribute-safe text that the handler sees as exactly one string literal equal to `value`.
 */
export function handlerArg(value: string | undefined): string {
  return escapeHtml(JSON.stringify(value ?? ''));
}

/**
 * Render a single-paragraph description with inline Markdown (links, `code`, **bold**, *italic*).
 *
 * HTML is escaped first, so nothing in the source can inject markup; only the patterns below re-introduce
 * tags, and links accept `http(s)` URLs only (so `javascript:` / `data:` can't become an href).
 *
 * @param value The raw description text (may contain inline Markdown).
 * @returns     HTML-safe markup with inline Markdown converted to `<a>`/`<code>`/`<strong>`/`<em>` tags.
 */
export function renderInlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
}
