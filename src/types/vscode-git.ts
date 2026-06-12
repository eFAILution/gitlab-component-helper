/**
 * Minimal subset of the VS Code Git extension API used by this extension.
 *
 * The full Git API is defined in `vscode.git`'s `git.d.ts` (shipped with VS Code, but not exported as a
 * package). Rather than redistribute the full type, this file declares only the fields and methods we
 * actually call. The shape is stable across recent VS Code versions; if a new field is needed, add it
 * here.
 *
 * Obtain a typed instance via:
 *   const gitExtension = vscode.extensions.getExtension('vscode.git');
 *   const git: GitApi | undefined = gitExtension?.exports.getAPI(1);
 */

import type * as vscode from 'vscode';

/** A Git remote configured on a repository (e.g. `origin`). */
export interface GitRemote {
  /** Remote name, e.g. `'origin'`. */
  name: string;
  /** URL configured for `git fetch`. May be `undefined` if no fetch URL is set. */
  fetchUrl?: string;
  /** URL configured for `git push`. Often the same as `fetchUrl`. */
  pushUrl?: string;
}

/** A pointer to the current branch/commit in a repository's `HEAD`. */
export interface GitHead {
  /** Branch name when `HEAD` is on a branch (e.g. `'main'`). */
  name?: string;
  /** Current commit SHA. */
  commit?: string;
}

/** Live state of a single repository, as exposed by the Git extension. */
export interface GitRepositoryState {
  /** Remotes configured on this repository. */
  remotes: GitRemote[];
  /** Current HEAD pointer; may be detached or unset. */
  HEAD?: GitHead;
}

/** A single Git repository tracked by VS Code. */
export interface GitRepository {
  /** Filesystem root of the repository (the directory containing `.git/`). */
  rootUri: vscode.Uri;
  /** Live state — updated reactively as the repo changes on disk. */
  state: GitRepositoryState;
}

/** The Git extension API surface returned by `gitExtension.exports.getAPI(1)`. */
export interface GitApi {
  /** All repositories currently tracked by VS Code. */
  repositories: GitRepository[];
  /** Look up the repository that contains the given URI, or `null` if none does. */
  getRepository(uri: vscode.Uri): GitRepository | null;
}
