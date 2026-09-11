/**
 * Client-side twin of {@link import('./inlineMarkdown').renderInlineMarkdown}, as source text.
 *
 * The webviews render descriptions in the browser, where they cannot import the server module, so the function is
 * injected into each `<script>` as a string. `vscode`-free so the unit suite can evaluate the emitted source and
 * check it against the real implementation.
 */

/**
 * Source for a browser-side `renderInlineMarkdown`, matching the server module's escaping and formatting.
 *
 * Patterns must stay regex literals. Routing one through `new RegExp('...')` unescapes it twice — once evaluating
 * this template literal, once when the browser parses the string literal — leaving `\[` as a bare `[`, which throws
 * `Invalid regular expression` on construction and so fails every call whatever text is passed.
 *
 * @returns JavaScript source declaring `function renderInlineMarkdown(text)`, for embedding in a webview script.
 */
export function clientRenderInlineMarkdownSource(): string {
  return `
      function renderInlineMarkdown(text) {
        const escaped = String(text || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
        return escaped
          .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
          .replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\s)]+)\\)/g, '<a href="$2">$1</a>')
          .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
          .replace(/(^|[^*])\\*([^*]+)\\*/g, '$1<em>$2</em>');
      }
    `;
}
