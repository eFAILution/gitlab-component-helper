/**
 * Find the GitLab CI files a tool call covers: one file, every CI file under a directory, or every CI file under the
 * workspace roots. Matches the extension's globs, skips `node_modules` and `.git`, never follows directory
 * symlinks, and stops at {@link MAX_CI_FILES}.
 */

import { opendir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { buildFileGlobs, matchesGitLabCIFile } from '../../utils/gitlabCiFileMatcherCore';
import { CONFIG_DEFAULTS } from '../../core/config/defaults';
import { getRuntime } from '../../core/runtime';
import { ToolError } from '../server';
import type { McpWorkspace } from '../adapters/workspace';

export const MAX_CI_FILES = 500;
const SKIPPED_DIRS = new Set(['node_modules', '.git']);
const MAX_DEPTH = 20;

export interface CiFileSet {
  files: string[];
  /** True when the walk stopped at the cap. */
  truncated: boolean;
}

function configuredGlobs(): string[] {
  return buildFileGlobs(getRuntime().config.get<string[]>('additionalFileGlobs', CONFIG_DEFAULTS.additionalFileGlobs));
}

async function walk(dir: string, globs: readonly string[], found: string[], depth: number): Promise<boolean> {
  if (depth > MAX_DEPTH) return false;
  let entries;
  try {
    entries = await opendir(dir);
  } catch {
    return false;
  }
  for await (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      if (await walk(full, globs, found, depth + 1)) return true;
    } else if (entry.isFile() && matchesGitLabCIFile(full, 'yaml', globs)) {
      found.push(full);
      if (found.length >= MAX_CI_FILES) return true;
    }
  }
  return false;
}

export const PATH_NOT_FOUND = 'not found under the workspace roots';

/**
 * @param userPath A file or directory, absolute or relative to the first root. Omitted: every root.
 * @throws ToolError when the path doesn't resolve inside a root.
 */
export async function collectCiFiles(workspace: McpWorkspace, userPath?: string): Promise<CiFileSet> {
  const globs = configuredGlobs();
  const starts = userPath === undefined ? workspace.roots() : [await workspace.resolve(userPath)];
  const found: string[] = [];
  let truncated = false;
  for (const start of starts) {
    if (start === null) throw new ToolError(`${userPath} is ${PATH_NOT_FOUND}.`);
    if ((await stat(start)).isFile()) {
      found.push(start);
    } else if (await walk(start, globs, found, 0)) {
      truncated = true;
      break;
    }
  }
  // A symlinked file found by the walk can point anywhere; keep only those whose target is inside a root.
  const contained = await Promise.all(found.slice(0, MAX_CI_FILES).map((file) => workspace.resolve(file)));
  return { files: [...new Set(contained.filter((file): file is string => file !== null))], truncated };
}
