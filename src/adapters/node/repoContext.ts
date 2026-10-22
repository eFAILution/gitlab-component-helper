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

const GIT_TIMEOUT_MS = 5000;
const MAX_GIT_OUTPUT_BYTES = 64 * 1024;

export interface CommandLimits {
  timeoutMs?: number;
  maxOutputBytes?: number;
}

/**
 * The environment for child git processes: no variables that point git at another repository or config, and no
 * credential prompts.
 */
function childEnv(): NodeJS.ProcessEnv {
  const inherited = Object.entries(process.env).filter(
    ([name]) => name !== 'GIT_DIR' && name !== 'GIT_WORK_TREE' && !name.startsWith('GIT_CONFIG')
  );
  return { ...Object.fromEntries(inherited), GIT_TERMINAL_PROMPT: '0' };
}

/**
 * Run a fixed command (no shell) in `cwd` with a timeout and an output cap.
 *
 * @returns Trimmed stdout when the command exits 0 within the limits, else `null`.
 */
export function runCommand(command: string, cwd: string, args: string[], limits: CommandLimits = {}): Promise<string | null> {
  const { timeoutMs = GIT_TIMEOUT_MS, maxOutputBytes = MAX_GIT_OUTPUT_BYTES } = limits;
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    });
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let overflowed = false;
    child.stdout.on('data', (data: Buffer) => {
      outputBytes += data.length;
      if (outputBytes > maxOutputBytes) {
        overflowed = true;
        child.kill('SIGKILL');
        return;
      }
      chunks.push(data);
    });
    // `close` waits for stdout to drain; `exit` can fire before the last chunk arrives.
    child.on('close', (code: number | null) => {
      resolve(code === 0 && !overflowed ? Buffer.concat(chunks).toString().trim() : null);
    });
    child.on('error', () => resolve(null));
  });
}

/** Run `git` in `cwd`; see {@link runCommand}. */
function runGit(cwd: string, args: string[]): Promise<string | null> {
  return runCommand('git', cwd, args);
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
        const isGitRepo = (await runGit(workspacePath, ['rev-parse', '--is-inside-work-tree'])) !== null;

        if (!isGitRepo) {
            logger.debug(`[ComponentDetector] Not inside a Git repository`, 'ComponentDetector');
            return null;
        }

        logger.debug(`[ComponentDetector] Confirmed we're in a Git repository`, 'ComponentDetector');

        // Get the remote origin URL
        const remoteUrl = (await runGit(workspacePath, ['remote', 'get-url', 'origin'])) || null;

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
