import { accessSync, constants, statSync } from 'node:fs';
import * as path from 'node:path';

/**
 * Find the git executable on PATH as an absolute path, skipping relative PATH entries (a `.` entry would let a
 * repository plant its own `git`).
 *
 * @returns The absolute path, or `undefined` when git isn't installed.
 */
export function resolveGitPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string | undefined {
  const names = platform === 'win32' ? ['git.exe', 'git.cmd'] : ['git'];
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter((dir) => dir && path.isAbsolute(dir));
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (statSync(candidate).isFile()) {
          accessSync(candidate, constants.X_OK);
          return candidate;
        }
      } catch {
        // not here; keep looking
      }
    }
  }
  return undefined;
}
