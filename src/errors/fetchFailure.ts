/**
 * Classify why a GitLab request failed, so callers can say what to fix instead of "fetch failed".
 * Only Node error codes and HTTP statuses are read; messages and response bodies are never echoed.
 */

import { extractStatusCode } from './guards';

export type FetchFailureKind = 'tls' | 'dns' | 'connection' | 'timeout' | 'not-found' | 'rate-limit' | 'server' | 'unknown';

export interface FetchFailure {
  kind: FetchFailureKind;
  /** Node/OpenSSL error code, e.g. `UNABLE_TO_GET_ISSUER_CERT`. */
  code?: string;
  statusCode?: number;
}

const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'EAI_NONAME']);
const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EPIPE']);
const TLS_CODES = new Set([
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
  'CERT_REVOKED',
  'HOSTNAME_MISMATCH',
]);

/** The first well-formed `code` along the error's `cause` chain. */
function errorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && ERROR_CODE.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function classifyFetchFailure(error: unknown): FetchFailure {
  const statusCode = extractStatusCode(error);
  if (statusCode === 404) return { kind: 'not-found', statusCode };
  if (statusCode === 408) return { kind: 'timeout', statusCode };
  if (statusCode === 429) return { kind: 'rate-limit', statusCode };
  if (statusCode !== undefined && statusCode >= 500) return { kind: 'server', statusCode };

  const code = errorCode(error);
  if (code && (TLS_CODES.has(code) || code.startsWith('ERR_TLS'))) return { kind: 'tls', code };
  if (code && DNS_CODES.has(code)) return { kind: 'dns', code };
  if (code && CONNECTION_CODES.has(code)) return { kind: 'connection', code };
  return { kind: 'unknown', ...(code ? { code } : {}), ...(statusCode ? { statusCode } : {}) };
}

/** Fixed-text guidance for a failure on `host`. */
export function fetchFailureHint(failure: FetchFailure, host: string): string {
  const detail = failure.code ?? (failure.statusCode ? `HTTP ${failure.statusCode}` : undefined);
  const suffix = detail ? ` (${detail})` : '';
  switch (failure.kind) {
    case 'tls':
      return `Node could not verify the TLS certificate for ${host}${suffix}. curl or a browser may still work because they use the ` +
        'OS trust store. Put the issuing root CA (PEM) in a file, set NODE_EXTRA_CA_CERTS to that file in the environment VS Code ' +
        'starts from (for Remote/WSL: ~/.vscode-server/server-env-setup), and restart VS Code. Do not disable TLS verification.';
    case 'dns':
      return `${host} could not be resolved${suffix}. Check VPN and DNS.`;
    case 'connection':
      return `Could not connect to ${host}${suffix}. Check VPN, firewall, and HTTPS_PROXY.`;
    case 'timeout':
      return `${host} did not respond in time${suffix}. Check VPN or raise gitlabComponentHelper.httpTimeout.`;
    case 'not-found':
      return `${host} returned 404: the project path, component name, or version does not exist, or the project is private ` +
        'and needs a token. Call list_component_versions to see what exists.';
    case 'rate-limit':
      return `${host} rate-limited the request${suffix}. Wait and retry.`;
    case 'server':
      return `${host} returned a server error${suffix}. Retry later.`;
    default:
      return `The request to ${host} failed${suffix}.`;
  }
}
