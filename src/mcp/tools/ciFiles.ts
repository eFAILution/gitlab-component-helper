/**
 * Find the GitLab CI files a tool call covers: one file, every CI file under a directory, or every CI file under the
 * workspace roots. Matches the extension's globs, skips dependency, build, and VCS directories, never follows directory
 * symlinks, walks in name order, and stops at {@link MAX_CI_FILES} files or {@link MAX_DIRECTORIES} directories.
 */

import { readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { buildFileGlobs, matchesGitLabCIFile } from '../../utils/gitlabCiFileMatcherCore';
import { CONFIG_DEFAULTS } from '../../core/config/defaults';
import { getRuntime } from '../../core/runtime';
import { ToolError } from '../server';
import type { McpWorkspace } from '../adapters/workspace';

export const MAX_CI_FILES = 500;
/** Directories visited per call; a huge tree stops here even if it holds few CI files. */
export const MAX_DIRECTORIES = 5000;
const SKIPPED_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', 'target', 'dist', 'build', 'out', '.next', 'vendor', '.terraform', 'coverage',
]);
const MAX_DEPTH = 20;

export interface CiFileSet {
  files: string[];
  /** True when the walk stopped at a cap. */
  truncated: boolean;
}

export interface WalkLimits {
  maxFiles?: number;
  maxDirectories?: number;
}

function configuredGlobs(): string[] {
  return buildFileGlobs(getRuntime().config.get<string[]>('additionalFileGlobs', CONFIG_DEFAULTS.additionalFileGlobs));
}

interface WalkState {
  globs: readonly string[];
  found: string[];
  directories: number;
  maxFiles: number;
  maxDirectories: number;
}

/** Walk `dir` depth-first in name order. Resolves `true` when a cap stopped the walk. */
async function walk(dir: string, state: WalkState, depth: number): Promise<boolean> {
  if (depth > MAX_DEPTH) return false;
  if (state.directories >= state.maxDirectories) return true;
  state.directories++;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      if (await walk(full, state, depth + 1)) return true;
    } else if (entry.isFile() && matchesGitLabCIFile(full, 'yaml', state.globs)) {
      state.found.push(full);
      if (state.found.length >= state.maxFiles) return true;
    }
  }
  return false;
}

export const PATH_NOT_FOUND = 'not found under the workspace roots';

/**
 * @param userPath A file or directory, absolute or relative to the first root. Omitted: every root.
 * @throws ToolError when the path doesn't resolve inside a root.
 */
export async function collectCiFiles(workspace: McpWorkspace, userPath?: string, limits: WalkLimits = {}): Promise<CiFileSet> {
  const state: WalkState = {
    globs: configuredGlobs(),
    found: [],
    directories: 0,
    maxFiles: limits.maxFiles ?? MAX_CI_FILES,
    maxDirectories: limits.maxDirectories ?? MAX_DIRECTORIES,
  };
  const starts = userPath === undefined ? workspace.roots() : [await workspace.resolve(userPath)];
  let truncated = false;
  for (const start of starts) {
    if (start === null) throw new ToolError(`${userPath} is ${PATH_NOT_FOUND}.`);
    if ((await stat(start)).isFile()) {
      state.found.push(start);
    } else if (await walk(start, state, 0)) {
      truncated = true;
      break;
    }
  }
  // A symlinked file found by the walk can point anywhere; keep only those whose target is inside a root.
  const contained = await Promise.all(state.found.slice(0, state.maxFiles).map((file) => workspace.resolve(file)));
  return { files: [...new Set(contained.filter((file): file is string => file !== null))], truncated };
}
