/**
 * Repository context from the `git` CLI, for hosts without the VS Code Git extension (the MCP server). The extension
 * also falls back to {@link detectNonGitLabRemoteViaGit} when its Git extension knows no repository.
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { Logger } from '../../utils/logger';
import { classifyRemote, parseGitLabRemoteUrl, type NonGitLabRemote } from '../../core/gitRemote';
import type { RepoContextPort, RepoRemoteContext } from '../../core/referenceResolver';

const logger = Logger.getInstance();

/**
 * Run `git` in `cwd`.
 *
 * @returns Trimmed stdout when git exits 0, else `null` (not a repository, no such remote, git missing).
 */
function runGit(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const git = spawn('git', args, { cwd, stdio: 'pipe' });
    let output = '';
    git.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });
    git.on('exit', (code: number | null) => resolve(code === 0 ? output.trim() : null));
    git.on('error', () => resolve(null));
  });
}

/** The GitLab remote (`origin`) of the repository containing `cwd`, with its HEAD commit. */
async function gitLabRemoteViaGit(cwd: string): Promise<RepoRemoteContext> {
  const remoteUrl = await runGit(cwd, ['remote', 'get-url', 'origin']);
  const gitlabInfo = remoteUrl ? parseGitLabRemoteUrl(remoteUrl) : null;
  if (!gitlabInfo) {
    return {};
  }
  const commitSha = (await runGit(cwd, ['rev-parse', 'HEAD'])) || 'main';
  return { ...gitlabInfo, commitSha };
}

/** A {@link RepoContextPort} over the `git` CLI, run in the directory of the file being resolved. */
export function createGitCliRepoContext(): RepoContextPort<string> {
  return {
    remoteContext: (forFile) => gitLabRemoteViaGit(path.dirname(forFile)),
    nonGitLabRemote: (forFile) => detectNonGitLabRemoteViaGit(path.dirname(forFile)),
  };
}

/**
 * Use direct Git commands to detect repository information
 */
export async function detectNonGitLabRemoteViaGit(workspacePath: string): Promise<NonGitLabRemote | null> {
    try {
        // First, check if we're in a Git repository
        const isGitRepo = await new Promise<boolean>((resolve) => {
            const gitCheck = spawn('git', ['rev-parse', '--is-inside-work-tree'], {
                cwd: workspacePath,
                stdio: 'pipe'
            });

            gitCheck.on('exit', (code: number | null) => {
                resolve(code === 0);
            });

            gitCheck.on('error', () => {
                resolve(false);
            });
        });

        if (!isGitRepo) {
            logger.debug(`[ComponentDetector] Not inside a Git repository`, 'ComponentDetector');
            return null;
        }

        logger.debug(`[ComponentDetector] Confirmed we're in a Git repository`, 'ComponentDetector');

        // Get the remote origin URL
        const remoteUrl = await new Promise<string | null>((resolve) => {
            const gitRemote = spawn('git', ['remote', 'get-url', 'origin'], {
                cwd: workspacePath,
                stdio: 'pipe'
            });

            let output = '';
            gitRemote.stdout.on('data', (data: Buffer) => {
                output += data.toString();
            });

            gitRemote.on('exit', (code: number | null) => {
                if (code === 0 && output.trim()) {
                    resolve(output.trim());
                } else {
                    resolve(null);
                }
            });

            gitRemote.on('error', () => {
                resolve(null);
            });
        });

        if (!remoteUrl) {
            logger.debug(`[ComponentDetector] No origin remote found`, 'ComponentDetector');
            return null;
        }

        logger.debug(`[ComponentDetector] Found origin remote via Git command: ${remoteUrl}`, 'ComponentDetector');
        return classifyRemote(remoteUrl);

    } catch (error) {
        logger.debug(`[ComponentDetector] Error using Git commands: ${error}`, 'ComponentDetector');
        return null;
    }
}
