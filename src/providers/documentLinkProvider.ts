import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { UrlParser } from '../services/component/urlParser';
import { containsGitLabVariables, expandComponentUrl } from '../utils/gitlabVariables';
import { getGitRepositoryContext } from './componentDetector';
import { getComponentCacheManager } from '../services/cache/componentCacheManager';
import { templateFileUrlForResolved } from '../utils/templateFileUrl';
import { isGitLabCIFile } from '../utils/gitlabCiFileMatcher';

const COMPONENT_LINE = /^(\s*-?\s*component:\s*)(\S+)/;

export class ComponentDocumentLinkProvider implements vscode.DocumentLinkProvider {
  private logger = Logger.getInstance();
  private urlParser = new UrlParser();

  public async provideDocumentLinks(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): Promise<vscode.DocumentLink[]> {
    if (!isGitLabCIFile(document)) {
      return [];
    }

    const links: vscode.DocumentLink[] = [];
    let gitContext: Awaited<ReturnType<typeof getGitRepositoryContext>> | null = null;
    const cacheManager = getComponentCacheManager();
    const cachedComponents = await cacheManager.getComponents();

    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
      const lineText = document.lineAt(lineIndex).text;
      const match = COMPONENT_LINE.exec(lineText);
      if (!match) {
        continue;
      }

      const prefix = match[1];
      const rawUrl = match[2];
      const startCol = prefix.length;
      const endCol = startCol + rawUrl.length;

      let expandedUrl = rawUrl;
      if (containsGitLabVariables(rawUrl)) {
        if (gitContext === null) {
          gitContext = await getGitRepositoryContext();
        }
        if (gitContext.gitlabInstance) {
          expandedUrl = expandComponentUrl(rawUrl, {
            gitlabInstance: gitContext.gitlabInstance,
            projectPath: gitContext.projectPath || '',
            serverUrl: `https://${gitContext.gitlabInstance}`,
            commitSha: gitContext.commitSha || 'main',
          });
        } else {
          continue;
        }
      }

      const parsed = this.urlParser.parseCustomComponentUrl(expandedUrl);
      if (!parsed) {
        continue;
      }

      const cached = cachedComponents.find(
        (c) =>
          c.gitlabInstance === parsed.gitlabInstance &&
          c.sourcePath === parsed.path &&
          c.name === parsed.name &&
          (!parsed.version || c.version === parsed.version)
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
