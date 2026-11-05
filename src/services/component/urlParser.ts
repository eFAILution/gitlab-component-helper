import { parseComponentIdentity } from '../../utils/cachedComponentLookup';
import { Logger } from '../../utils/logger';

export interface ParsedComponentUrl {
  gitlabInstance: string;
  path: string;
  name: string;
  version?: string;
  /** `true` for the project-only shorthand (`https://host/group/project`), which defaults `name` and `version` to `main`. */
  projectOnly: boolean;
}

/**
 * Utility for parsing GitLab component URLs
 */
export class UrlParser {
  private logger = Logger.getInstance();

  /**
   * Parse an expanded component URL. Everything after the first `@` is the version, so branch refs containing `/`
   * (`…/knip-check@chore/DEVOPS-6655-knip-check`) keep their full name.
   *
   * Supports:
   * 1) `https://host/group/project/component@version`
   * 2) `https://host/group/project/component` (no version)
   * 3) `https://host/group/project` (project-only shorthand, resolved to the `main` component at `main`)
   *
   * @param url The GitLab component URL to parse
   * @returns Parsed URL components or null if invalid
   */
  public parseCustomComponentUrl(url: string): ParsedComponentUrl | null {
    const identity = parseComponentIdentity(url);
    if (!identity) {
      this.logger.error(`Error parsing component URL: ${url}`, 'UrlParser');
      return null;
    }

    // Two path segments and no `@` is the project-only shorthand.
    const projectOnly = identity.version === undefined && !identity.sourcePath.includes('/');
    const parsed: ParsedComponentUrl = projectOnly
      ? {
          gitlabInstance: identity.gitlabInstance,
          path: `${identity.sourcePath}/${identity.name}`,
          name: 'main',
          version: 'main',
          projectOnly
        }
      : {
          gitlabInstance: identity.gitlabInstance,
          path: identity.sourcePath,
          name: identity.name,
          version: identity.version,
          projectOnly
        };

    this.logger.debug(
      `Parsed component URL: ${parsed.gitlabInstance}/${parsed.path}/${parsed.name}${parsed.version ? `@${parsed.version}` : ''}`,
      'UrlParser'
    );

    return parsed;
  }

  /**
   * Clean GitLab instance URL by removing protocol prefix
   * @param gitlabInstance The GitLab instance URL (may contain protocol)
   * @returns Clean hostname without protocol
   */
  public cleanGitLabInstance(gitlabInstance: string): string {
    let clean = gitlabInstance;
    if (clean.startsWith('https://')) {
      clean = clean.replace('https://', '');
    }
    if (clean.startsWith('http://')) {
      clean = clean.replace('http://', '');
    }
    return clean;
  }
}
