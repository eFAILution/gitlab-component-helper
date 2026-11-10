import { constants } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { MAX_LOCAL_INCLUDE_BYTES } from '../../core/localInclude';

// Opening a FIFO for reading blocks until a writer appears; O_NONBLOCK makes it return at once. Absent on Windows.
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0);

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
    // Check before opening, so a FIFO or device is never opened at all.
    const before = await stat(absolutePath);
    if (!before.isFile() || before.size > maxBytes) return null;
    const handle = await open(absolutePath, OPEN_FLAGS);
    try {
      // Re-check the opened file: the path could have been swapped between the stat and the open.
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
