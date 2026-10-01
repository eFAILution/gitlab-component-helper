import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { UrlParser } from '../services/component/urlParser';
import { createReferenceResolver } from './componentDetector';
import { getComponentCacheManager } from '../services/cache/componentCacheManager';
import { templateFileUrlForResolved } from '../utils/templateFileUrl';
import { isGitLabCIFile } from '../utils/gitlabCiFileMatcher';
import { matchComponentValue } from '../utils/componentReference';

export class ComponentDocumentLinkProvider implements vscode.DocumentLinkProvider, vscode.Disposable {
  private logger = Logger.getInstance();
  private urlParser = new UrlParser();

  // VS Code requests links once per document render and caches the result, re-asking only when the document changes or
  // this event fires. Without it, links resolved from the async cache never appear on first view — they only show up
  // after the first edit. We fire it when the component cache is populated/updated so VS Code re-requests then.
  private readonly _onDidChangeLinks = new vscode.EventEmitter<void>();
  public readonly onDidChangeLinks = this._onDidChangeLinks.event;
  private readonly cacheSubscription: vscode.Disposable;

  constructor() {
    this.cacheSubscription = getComponentCacheManager().onDidChangeComponents(() => {
      this._onDidChangeLinks.fire();
    });
  }

  // Re-request links against the current cache. Call after registration so an editor already open at activation
  // re-requests instead of keeping the (possibly empty) result from its first render.
  public refresh(): void {
    this._onDidChangeLinks.fire();
  }

  public dispose(): void {
    this.cacheSubscription.dispose();
    this._onDidChangeLinks.dispose();
  }

  public async provideDocumentLinks(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<vscode.DocumentLink[]> {
    if (!isGitLabCIFile(document)) {
      return [];
    }

    const links: vscode.DocumentLink[] = [];
    const cacheManager = getComponentCacheManager();
    const cachedComponents = await cacheManager.getComponents();
    const resolveReference = createReferenceResolver(document.uri);

    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
      const match = matchComponentValue(document.lineAt(lineIndex).text);
      if (!match) {
        continue;
      }

      const startCol = match.start;
      const endCol = startCol + match.value.length;

      const resolved = await resolveReference(match.value);
      if (!resolved.resolved) {
        continue;
      }

      const parsed = this.urlParser.parseCustomComponentUrl(resolved.url);
      if (!parsed) {
        continue;
      }

      const cached = cachedComponents.find(
        (c) =>
          c.gitlabInstance === parsed.gitlabInstance &&
          c.sourcePath === parsed.path &&
          c.name === parsed.name
      );

      // Only produce a link when the cache has a resolved templatePath for the component. Uncached components are
      // skipped: better no link than a misleading one. The catalog discovery populates templatePath for every entry
      // in a configured componentSource, so the only time this misses is for components from projects the user
      // hasn't configured (or before the first cache refresh completes).
      if (!cached?.templatePath) {
        continue;
      }

      const target = templateFileUrlForResolved({
        gitlabInstance: parsed.gitlabInstance,
        projectPath: parsed.path,
        version: parsed.version,
        templatePath: cached.templatePath,
      });

      const range = new vscode.Range(lineIndex, startCol, lineIndex, endCol);
      const link = new vscode.DocumentLink(range, vscode.Uri.parse(target));
      const refLabel = parsed.version && parsed.version !== 'main' ? parsed.version : 'main';
      link.tooltip = `Open ${parsed.name} template at ${refLabel} on ${parsed.gitlabInstance}/${parsed.path}`;
      links.push(link);
    }

    this.logger.debug(
      `[ComponentDocumentLinkProvider] Produced ${links.length} links for ${document.fileName}`,
      "ComponentDocumentLinkProvider",
    );
    return links;
  }

}
