/**
 * Runtime predicates over caught error values.
 *
 * These narrow the error classes declared in `./types` — kept separate so `types.ts` stays purely
 * declarative (enum, classes, type aliases) and behaviour lives here.
 */

import { ErrorCode, GitLabComponentError, NetworkError } from './types';

/**
 * Extract an HTTP status code from an unknown thrown value.
 *
 * Prefers the typed `NetworkError.details.statusCode`, then falls back to a `statusCode` property on
 * any error-shaped object so non-`NetworkError` throws (e.g. raw fetch errors) are still recognised.
 *
 * @param error  The caught value (typed `unknown` at catch sites).
 * @returns      The HTTP status code if one can be safely extracted, otherwise `undefined`.
 */
export function extractStatusCode(error: unknown): number | undefined {
  if (error instanceof NetworkError && error.details?.statusCode) {
    return error.details.statusCode;
  }
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const candidate = (error as { statusCode: unknown }).statusCode;
    if (typeof candidate === 'number') {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Whether a caught value represents a GitLab authentication failure (expired/invalid/missing token).
 *
 * Recognises both the typed `UNAUTHORIZED` error code and a raw 401/403 status, so callers don't have
 * to special-case how deep in the stack the error was constructed.
 *
 * @param error  The caught value (typed `unknown` at catch sites).
 * @returns      `true` if the error is an `UNAUTHORIZED` GitLab error or carries a 401/403 status,
 *               otherwise `false`.
 */
export function isAuthError(error: unknown): boolean {
  if (error instanceof GitLabComponentError && error.code === ErrorCode.UNAUTHORIZED) {
    return true;
  }
  const status = extractStatusCode(error);
  return status === 401 || status === 403;
}
