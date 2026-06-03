/**
 * Pure markdown builder for the component-hover popup. Given a resolved `Component` plus the cursor's hover
 * context (used to build the "Open in Detailed View" command URL), returns the markdown body the provider feeds
 * into `vscode.MarkdownString.appendMarkdown(...)`.
 */

import type { Component } from './componentDetector';
import { templateFileUrlForResolved } from '../utils/templateFileUrl';

/**
 * The position context the "Open in Detailed View" command needs to round-trip the cursor location back to the
 * detached-hover panel.
 */
export interface HoverContext {
  documentUri: string;
  position: { line: number; character: number };
}

/**
 * Build the full markdown body for a component-hover popup.
 *
 * Emits, in order:
 *  1. `## <name>` title.
 *  2. `[🔗 Open in Detailed View](command:…)` link with the component + cursor context encoded as JSON.
 *  3. The component description (empty string if absent — the trailing newlines are still emitted to match the
 *     production layout, where downstream sections always sit two blank lines below the previous).
 *  4. `**Source:**` line — a clickable `templateFileUrlForResolved` link when `templatePath` is present, otherwise
 *     `<gitlabInstance>/<path>` plain text, otherwise the bare `component.source` string. Skipped entirely if
 *     none of those are present.
 *  5. `**Version:** <version>` when set.
 *  6. Parameters table (header + separator + one row per `parameters[]`), or omitted when there are no parameters.
 *
 * @param component The resolved component to render.
 * @param context   Cursor + document location used to build the detach-command URL.
 */
export function buildComponentHoverMarkdown(component: Component, context: HoverContext): string {
  let md = '';

  md += `## ${component.name}\n\n`;

  const componentWithContext = { ...component, _hoverContext: context };
  // Matches `vscode.Uri.parse(...).toString()`'s extra escaping of `!'()*`. The `)` escape is load-bearing:
  // markdown link syntax terminates at the first literal `)`, so an unbalanced `)` anywhere in the JSON payload
  // (e.g. a description containing "(see note 1)" or ":)") would otherwise cut the link short and break "Open in
  // Detailed View".
  const detachCommandUrl = `command:gitlab-component-helper.detachHover?${encodeURIComponent(
    JSON.stringify(componentWithContext),
  ).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`;
  md += `[🔗 Open in Detailed View](${detachCommandUrl})\n\n`;

  const description = component.description || '';
  md += `${description}\n\n`;

  if (component.context && component.templatePath) {
    const sourceUrl = templateFileUrlForResolved({
      gitlabInstance: component.context.gitlabInstance,
      projectPath: component.context.path,
      version: component.version,
      templatePath: component.templatePath,
    });
    md += `**Source:** [${sourceUrl}](${sourceUrl})\n\n`;
  } else if (component.context) {
    md += `**Source:** ${component.context.gitlabInstance}/${component.context.path}\n\n`;
  } else if (component.source) {
    md += `**Source:** ${component.source}\n\n`;
  }

  if (component.version) {
    md += `**Version:** ${component.version}\n\n`;
  }

  if (component.parameters && component.parameters.length > 0) {
    md += `### Parameters\n\n`;
    md += `| Name | Description | Required | Default |\n`;
    md += `| ---- | ----------- | -------- | ------- |\n`;
    for (const param of component.parameters) {
      const defaultCell = param.default !== undefined ? `\`${param.default}\`` : '-';
      md += `| ${param.name} | ${param.description} | ${param.required ? 'Yes' : 'No'} | ${defaultCell} |\n`;
    }
    md += `\n`;
  }

  return md;
}
