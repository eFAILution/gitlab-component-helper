// Import from the pure `errors/types` module, not the `../errors` barrel: the barrel re-exports
// `handler.ts`, which imports `vscode` and is therefore unloadable in the pure-Node unit-test context.
import { NetworkError } from '../errors/types';
import { HEADER_AUTHORIZATION, HEADER_PRIVATE_TOKEN, HEADER_COOKIE } from '../constants/api';

/**
 * HTTP status codes that represent a followable redirect. 304 (Not Modified) is deliberately excluded:
 * it is a 3xx response but not a redirect, and this client never sends conditional requests.
 */
export const REDIRECT_STATUS_CODES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * Outgoing request headers that carry credentials and must never be replayed to a different origin.
 * Stored lower-cased and compared case-insensitively against header names.
 */
export const SENSITIVE_HEADERS: readonly string[] = [
  HEADER_AUTHORIZATION.toLowerCase(),
  HEADER_PRIVATE_TOKEN.toLowerCase(),
  HEADER_COOKIE.toLowerCase(),
];

/** The decision produced by {@link planRedirect}: where to go next and whether credentials survive the hop. */
export interface RedirectPlan {
  /** Absolute URL to request next. */
  nextUrl: string;
  /** True when the redirect crosses origin, so credential headers must be dropped before following. */
  stripCredentials: boolean;
}

/**
 * Return a copy of `headers` with every credential-bearing header removed. Names are matched
 * case-insensitively, so a caller's `PRIVATE-TOKEN` and a server-echoed `private-token` are both dropped.
 *
 * @param headers The outgoing header map to sanitise.
 * @returns A new map containing only the non-credential headers.
 */
export function stripCredentialHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !SENSITIVE_HEADERS.includes(name.toLowerCase()))
  );
}

/**
 * Decide whether and how to follow an HTTP redirect under a credential-safe, same-origin-preferring policy.
 *
 * Policy:
 *  - Only 301/302/303/307/308 carrying a `Location` are followed; any other status (including the
 *    non-redirect 304) returns `null` so the caller handles the response normally.
 *  - A redirect status with a missing/empty `Location` is a malformed response and throws.
 *  - Downgrading the transport from HTTPS to HTTP is refused (throws): an attacker able to force a
 *    downgrade could strip TLS, so we fail closed rather than replay the request in the clear.
 *  - A cross-origin target is permitted but flagged `stripCredentials: true`, so the caller drops the
 *    `Authorization`/`PRIVATE-TOKEN`/`Cookie` headers before following. This prevents a malicious or
 *    compromised host from harvesting the user's GitLab token via an attacker-controlled `Location`.
 *
 * @param currentUrl  The URL that produced this redirect response.
 * @param statusCode  The redirect response's status code.
 * @param location    The raw `Location` header, absolute or relative to `currentUrl` (Node lower-cases the name).
 * @returns A {@link RedirectPlan}, or `null` when the response is not a followable redirect.
 * @throws NetworkError on a malformed redirect (no `Location`) or a refused HTTPS→HTTP downgrade.
 */
export function planRedirect(
  currentUrl: string,
  statusCode: number,
  location: string | undefined
): RedirectPlan | null {
  if (!REDIRECT_STATUS_CODES.has(statusCode)) {
    return null;
  }

  if (!location || location.trim() === '') {
    throw new NetworkError(
      `Redirect (HTTP ${statusCode}) from ${currentUrl} is missing a Location header`,
      { statusCode }
    );
  }

  const current = new URL(currentUrl);
  // Resolves an absolute Location as-is and a relative Location against the current URL.
  const next = new URL(location, current);

  if (current.protocol === 'https:' && next.protocol === 'http:') {
    throw new NetworkError(
      `Refusing to follow HTTPS→HTTP redirect from ${currentUrl} to ${next.toString()}`,
      { statusCode }
    );
  }

  return {
    nextUrl: next.toString(),
    stripCredentials: next.origin !== current.origin,
  };
}
