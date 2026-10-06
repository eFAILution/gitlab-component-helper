import type { ComponentChildren } from 'preact';
import { cspPolicy } from '../csp';
import { renderInlineMarkdown } from '../inlineMarkdown';
import { serializeForScript } from '../scriptData';

/** What every view needs from its builder to load its own assets under the document's CSP. */
export interface PageAssets {
  cspSource: string;
  nonce: string;
  styleUri: string;
  /** Omitted for a view with no client script. */
  scriptUri?: string;
}

interface PageProps extends PageAssets {
  title: string;
  children: ComponentChildren;
}

/**
 * The document shell every view renders into: head with CSP and stylesheet, the view's content, then its nonce'd
 * client script.
 *
 * @param props The page title, the assets from {@link PageAssets}, and the body content as `children`.
 * @returns      The `<html>` element; `renderDocument` prepends the doctype.
 */
export function Page({ title, cspSource, nonce, styleUri, scriptUri, children }: PageProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="Content-Security-Policy" content={cspPolicy(cspSource, nonce)} />
        <link rel="stylesheet" href={styleUri} />
        <title>{title}</title>
      </head>
      <body>
        {children}
        {scriptUri && <script nonce={nonce} src={scriptUri}></script>}
      </body>
    </html>
  );
}

/**
 * State handed to a client script, which reads it back with `JSON.parse(element.textContent)`.
 *
 * Script content is raw text: the browser does not decode entities in it, so JSX's escaping would corrupt the JSON.
 * {@link serializeForScript} makes it safe to emit verbatim instead. The nonce is required even though the block is
 * not executable, because `default-src 'none'` covers it.
 *
 * @param props.id    The element id the client script looks the block up by.
 * @param props.nonce The document's CSP nonce.
 * @param props.data  Any JSON-serializable value.
 * @returns           A `<script type="application/json">` element.
 */
export function JsonScript({ id, nonce, data }: { id: string; nonce: string; data: unknown }) {
  return (
    <script
      type="application/json"
      id={id}
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: serializeForScript(data) }}
    ></script>
  );
}

/**
 * A publisher's description with inline Markdown, which {@link renderInlineMarkdown} escapes before formatting.
 *
 * @param props.id    Optional element id.
 * @param props.class The wrapping `<div>`'s class.
 * @param props.text  The raw description text.
 * @returns           A `<div>` holding the formatted markup.
 */
export function InlineMarkdown({ id, class: className, text }: { id?: string; class: string; text: string }) {
  return <div class={className} id={id} dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(text) }}></div>;
}
