/**
 * The MCP server's file access: only regular files of at most 1 MB under the workspace roots given at startup.
 * Roots and targets are compared after `realpath`, so a symlink can't lead outside. A path outside the roots and a
 * missing path get the same answer.
 */

import { realpathSync } from 'node:fs';
import { lstat, readlink, realpath } from 'node:fs/promises';
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

/** Most symlinks followed while resolving one path, like the kernel's ELOOP limit. */
const MAX_LINK_HOPS = 40;

function isAbsoluteLinkTarget(target: string): boolean {
  return path.isAbsolute(target) || path.win32.isAbsolute(target) || /^[\\/]{2}/.test(target);
}

/**
 * Follow the symlinks in `candidate` one component at a time, before anything calls `realpath`. A link may only be
 * relative and must land lexically inside a root; an absolute target (which could be `/net/...` autofs or a UNC
 * share, so realpath would reach the network) or one that leaves the roots is refused.
 *
 * @returns The path with every link replaced by its target, or `null` when a link is refused or a component is
 *   missing.
 */
async function resolveLinksInsideRoots(roots: readonly string[], candidate: string): Promise<string | null> {
  let current = path.resolve(candidate);
  for (let hops = 0; hops <= MAX_LINK_HOPS; hops++) {
    const root = containedRoot(roots, current);
    if (!root) return null;
    const parts = path.relative(root, current).split(path.sep).filter(Boolean);
    let prefix = root;
    let followed = false;
    for (let index = 0; index < parts.length; index++) {
      prefix = path.join(prefix, parts[index]);
      let info;
      try {
        info = await lstat(prefix);
      } catch {
        return null;
      }
      if (!info.isSymbolicLink()) continue;
      const target = await readlink(prefix);
      if (isAbsoluteLinkTarget(target)) return null;
      current = path.resolve(path.dirname(prefix), target, ...parts.slice(index + 1));
      followed = true;
      break;
    }
    if (!followed) return current;
  }
  return null;
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
    const linkFree = await resolveLinksInsideRoots(lexicalRoots, candidate);
    if (!linkFree) return null;
    let real: string;
    try {
      real = await realpath(linkFree);
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
