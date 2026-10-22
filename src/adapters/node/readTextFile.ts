import { open } from 'node:fs/promises';
import { MAX_LOCAL_INCLUDE_BYTES } from '../../core/localInclude';

/**
 * Read a regular file as UTF-8, refusing anything that isn't a file or is larger than `maxBytes`.
 *
 * @returns The text, or `null` when the path is missing, not a regular file, too large, or unreadable.
 */
export async function readBoundedTextFile(
  absolutePath: string,
  maxBytes: number = MAX_LOCAL_INCLUDE_BYTES
): Promise<string | null> {
  try {
    const handle = await open(absolutePath, 'r');
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size > maxBytes) {
        return null;
      }
      return await handle.readFile({ encoding: 'utf8' });
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}
