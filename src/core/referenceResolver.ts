/**
 * Turn `component:` values into URLs `new URL()` can parse, expanding GitLab CI variables (`$CI_SERVER_FQDN`,
 * `$CI_PROJECT_PATH`, …) from the document's repository. The host supplies the repository lookup.
 */

import { getRuntime } from './runtime';
import { containsGitLabVariables, expandComponentUrl } from '../utils/gitlabVariables';
import { referenceToUrl } from '../utils/componentReference';
import type { NonGitLabRemote } from './gitRemote';
import type { ReferenceResolver, ResolvedReference, UnresolvedReason } from './references';

export type { ReferenceResolver, ResolvedReference, UnresolvedReason };

/** What a repository's GitLab remote says about where a file lives. Empty when it has no GitLab remote. */
export interface RepoRemoteContext {
  gitlabInstance?: string;
  projectPath?: string;
  commitSha?: string;
}

/**
 * How the resolver learns about the repository a file belongs to. `F` is however the host names a file (a path for
 * the MCP server, a `vscode.Uri` in the extension).
 */
export interface RepoContextPort<F = string> {
  /** The GitLab remote of the repository containing `forFile`. */
  remoteContext(forFile: F): Promise<RepoRemoteContext>;
  /** The workspace's repository when it's hosted outside GitLab (GitHub, Bitbucket, …), else `null`. */
  nonGitLabRemote(forFile: F): Promise<NonGitLabRemote | null>;
}

/** Context GitLab variables in a `component:` value are expanded from. */
interface ExpansionContext {
  gitlabInstance: string;
  projectPath: string;
  serverUrl: string;
  commitSha?: string;
}

/**
 * Find what GitLab variables expand from for a document: its repository's GitLab remote; failing that — unless the
 * workspace is a non-GitLab repository — the first configured component source (from the runtime config port).
 */
async function lookupExpansionContext<F>(forFile: F, repo: RepoContextPort<F>): Promise<ExpansionContext | UnresolvedReason> {
  const gitContext = await repo.remoteContext(forFile);
  if (gitContext.gitlabInstance && gitContext.projectPath) {
    return {
      gitlabInstance: gitContext.gitlabInstance,
      projectPath: gitContext.projectPath,
      serverUrl: `https://${gitContext.gitlabInstance}`,
      commitSha: gitContext.commitSha || 'main',
    };
  }

  const nonGitlab = await repo.nonGitLabRemote(forFile);
  if (nonGitlab) {
    return { kind: 'non-gitlab-repo', hostname: nonGitlab.hostname, type: nonGitlab.type };
  }

  const [source] = getRuntime().config
    .get<Array<{ path: string; gitlabInstance?: string }>>('componentSources', []);
  if (!source) {
    return { kind: 'no-context' };
  }
  const gitlabInstance = source.gitlabInstance || 'gitlab.com';
  return { gitlabInstance, projectPath: source.path, serverUrl: `https://${gitlabInstance}` };
}

/**
 * Create the resolver every reader uses to turn `component:` values written in one document into URLs `new URL()` can
 * parse. References without variables get `https://` prefixed; variables expand from {@link lookupExpansionContext},
 * which runs at most once per resolver — create one per document pass, not per line.
 */
export function createReferenceResolver<F>(forFile: F, repo: RepoContextPort<F>): ReferenceResolver {
  let context: Promise<ExpansionContext | UnresolvedReason> | undefined;

  return async reference => {
    if (!containsGitLabVariables(reference)) {
      return { resolved: true, url: referenceToUrl(reference) };
    }

    context ??= lookupExpansionContext(forFile, repo);
    const resolvedContext = await context;
    if ('kind' in resolvedContext) {
      return { resolved: false, reason: resolvedContext };
    }

    const expandedUrl = expandComponentUrl(reference, resolvedContext);
    if (containsGitLabVariables(expandedUrl) || expandedUrl.includes('undefined')) {
      return { resolved: false, reason: { kind: 'incomplete', expandedUrl } };
    }
    return { resolved: true, url: expandedUrl };
  };
}
