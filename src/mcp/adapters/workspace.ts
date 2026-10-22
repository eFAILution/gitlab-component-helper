/**
 * The MCP server's file access: only regular files of at most 1 MB under the workspace roots given at startup.
 * Roots and targets are compared after `realpath`, so a symlink can't lead outside. A path outside the roots and a
 * missing path get the same answer.
 */

import { realpathSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import * as path from 'node:path';
import { isInsideRoot, type WorkspacePort } from '../../core/localInclude';
import { readBoundedTextFile } from '../../adapters/node/readTextFile';

export interface McpWorkspace extends WorkspacePort<string> {
  /**
   * Resolve a path from a tool argument (absolute, or relative to the first root) to its real path inside a root.
   *
   * @returns The real path, or `null` when it doesn't exist, isn't inside a root, or isn't a plain path.
   */
  resolve(userPath: string): Promise<string | null>;
  /** The root containing a real path. */
  rootOf(realPath: string): string | undefined;
}

/**
 * Reject NUL bytes, `..` segments (with `\` read as a separator), and UNC or `\\?\` device paths before touching the
 * filesystem.
 */
export function isPlainPath(userPath: string): boolean {
  if (userPath === '' || userPath.includes('\0')) return false;
  const slashed = userPath.replace(/\\/g, '/');
  if (slashed.startsWith('//')) return false;
  return !slashed.split('/').includes('..');
}

function containedRoot(roots: readonly string[], candidate: string): string | undefined {
  return roots.find((root) => candidate === root || isInsideRoot(root, candidate));
}

/**
 * @param rootPaths Roots from `--root`; each must exist. They are realpath'd once.
 * @throws When a root doesn't exist.
 */
export function createMcpWorkspace(rootPaths: readonly string[]): McpWorkspace {
  const roots = rootPaths.map((root) => realpathSync(path.resolve(root)));
  // A path must sit inside a root as written (before any filesystem call), as given or as realpath'd.
  const lexicalRoots = [...new Set([...rootPaths.map((root) => path.resolve(root)), ...roots])];

  const realInsideRoots = async (candidate: string): Promise<string | null> => {
    if (!isPlainPath(candidate) || !path.isAbsolute(candidate)) return null;
    if (!containedRoot(lexicalRoots, path.resolve(candidate))) return null;
    let real: string;
    try {
      real = await realpath(candidate);
    } catch {
      return null;
    }
    return containedRoot(roots, real) ? real : null;
  };

  return {
    roots: () => [...roots],
    rootOf: (realPath) => containedRoot(roots, realPath),
    resolutionRoot: async (forFile) => {
      const real = await realInsideRoots(forFile);
      return real ? containedRoot(roots, real) ?? null : null;
    },
    readText: async (absolutePath) => {
      const real = await realInsideRoots(absolutePath);
      return real ? readBoundedTextFile(real) : null;
    },
    resolve: async (userPath) => {
      if (!isPlainPath(userPath)) return null;
      return realInsideRoots(path.isAbsolute(userPath) ? userPath : path.join(roots[0], userPath));
    },
  };
}
