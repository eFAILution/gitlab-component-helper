/**
 * Map parsed include entries back to the document lines they were written on, so findings anchor where the user
 * wrote the include or input.
 */

import { Logger } from '../../utils/logger';
import { findIncludeLine, includeKeyAndUrl, includeLineMatches, type IncludeEntry } from '../../utils/includeMatcher';
import { splitDocumentLines } from './findings';

const logger = Logger.getInstance();

/**
 * Locate the document line of the include entry at {@link includeIndex}.
 *
 * Two include entries can share an identical key+URL (e.g. the same component included twice with different
 * inputs). Matching on key+URL alone returns the first occurrence for both, mis-anchoring the second entry's
 * diagnostics onto the first. To disambiguate, this counts how many earlier entries in the parsed `includes`
 * array carry the same key+URL and returns the correspondingly-numbered occurrence in the document — relying
 * on the array being built in document order.
 *
 * @param text         The document text; scanned line by line for the include.
 * @param includes     The full parsed include list, in document order.
 * @param includeIndex The position in `includes` of the entry to locate.
 * @returns The 0-based line number of the matching include declaration, or `0` when no matching line is found
 *          (e.g. the URL doesn't appear literally on a single line — folded scalar, alias). Callers use the
 *          returned line as the anchor for a diagnostic range.
 */
export function findLineForComponent(text: string, includes: IncludeEntry[], includeIndex: number): number {
  const { key, url } = includeKeyAndUrl(includes[includeIndex]);

  // The occurrence ordinal: how many entries at-or-before includeIndex share this exact key+URL.
  let targetOccurrence = 0;
  for (let k = 0; k <= includeIndex; k++) {
    const prior = includeKeyAndUrl(includes[k]);
    if (prior.key === key && prior.url === url) {
      targetOccurrence++;
    }
  }

  logger.debug(`[ValidationProvider] Looking for include URL: ${url} (occurrence ${targetOccurrence})`, 'ValidationProvider');

  const lines = text.split('\n');
  const line = findIncludeLine(lines, key, url, targetOccurrence);
  if (line !== -1) {
    logger.debug(`[ValidationProvider] Found include at line ${line}: ${lines[line].trim()}`, 'ValidationProvider');
    return line;
  }
  logger.debug(`[ValidationProvider] Include URL not found, returning 0`, 'ValidationProvider');
  return 0;
}

/**
 * The line where the include entry *after* {@link includeIndex} begins, used as an exclusive upper bound when
 * scanning an include's inputs. Returns the document's line count when this is the last include, so the scan runs to
 * end-of-file. `searchFrom` is the current include's own line — the next entry is found by scanning past it.
 *
 * @param text         The document text; scanned line by line for the next include.
 * @param includes     The full parsed include list, in document order.
 * @param includeIndex The position in `includes` of the *current* entry; the next entry is `includeIndex + 1`.
 * @param searchFrom   The current include's own line; scanning starts at the line after it.
 * @returns The 0-based line number where the next include begins, or the line count when there is no next include
 *          or its line can't be found — either way an exclusive upper bound that runs to end-of-file.
 */
export function findLineForNextInclude(
  text: string,
  includes: IncludeEntry[],
  includeIndex: number,
  searchFrom: number
): number {
  const lineCount = splitDocumentLines(text).length;
  if (includeIndex + 1 >= includes.length) {
    return lineCount;
  }
  const { key, url } = includeKeyAndUrl(includes[includeIndex + 1]);
  const lines = text.split('\n');
  for (let i = searchFrom + 1; i < lines.length; i++) {
    if (includeLineMatches(lines[i], key, url)) {
      return i;
    }
  }
  return lineCount;
}

/**
 * Locate the line of `inputName` inside the inputs block of the include at {@link includeIndex}, falling back to the
 * include's own line when the input isn't written on a line of its own (e.g. flow-style `inputs: { … }`).
 */
export function findLineForInput(
  text: string,
  includes: IncludeEntry[],
  includeIndex: number,
  inputName: string
): number {
  const lines = text.split('\n');
  const componentLine = findLineForComponent(text, includes, includeIndex);
  const nextIncludeLine = findLineForNextInclude(text, includes, includeIndex, componentLine);

  logger.debug(`[ValidationProvider] Finding line for input '${inputName}', component line: ${componentLine}, bounded by next include at ${nextIncludeLine}`, 'ValidationProvider');

  // Two bounds keep the scan inside this include's own inputs block:
  //  - nextIncludeLine caps it before a sibling that may share input names (two includes of one component).
  //  - the indent break ends it at the first non-indented line, so it can't bleed into a top-level section
  //    (a job, `variables:`, etc.) below the last include, where nextIncludeLine is just end-of-file.
  for (let i = componentLine + 1; i < nextIncludeLine; i++) {
    if (lines[i].includes('inputs:')) {
      logger.debug(`[ValidationProvider] Found inputs section at line ${i}`, 'ValidationProvider');
      for (let j = i + 1; j < nextIncludeLine; j++) {
        if (lines[j].includes(`${inputName}:`)) {
          logger.debug(`[ValidationProvider] Found input '${inputName}' at line ${j}`, 'ValidationProvider');
          return j;
        }
        if (!/^\s/.test(lines[j]) && lines[j].trim() !== '') {
          break;
        }
      }
      break;
    }
  }
  logger.debug(`[ValidationProvider] Input '${inputName}' not found, returning component line ${componentLine}`, 'ValidationProvider');
  return componentLine;
}
