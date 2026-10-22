/**
 * The MCP server's outbound request policy: HTTPS only, and only to GitLab instances the user configured or holds a
 * token for. Private and loopback addresses are allowed for those hosts, because self-managed GitLab often lives on
 * an internal network. Link-local (cloud metadata), unspecified, and multicast addresses are always refused.
 */

import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import type { NetworkPolicyPort } from '../../core/ports';

export const DEFAULT_GITLAB_HOST = 'gitlab.com';

/** A request the policy refused. The message says how to allow the host. */
export class HostNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostNotAllowedError';
  }
}

function ipv4Parts(address: string): number[] {
  return address.split('.').map(Number);
}

/** Link-local (incl. the 169.254.169.254 cloud metadata endpoint), unspecified, multicast and reserved addresses. */
export function isBlockedAddress(address: string): boolean {
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const candidate = mapped ? mapped[1] : address;
  if (isIP(candidate) === 4) {
    const [a, b] = ipv4Parts(candidate);
    return a === 0 || a >= 224 || (a === 169 && b === 254);
  }
  const lower = candidate.toLowerCase();
  return lower === '::' || /^fe[89ab]/.test(lower) || /^ff/.test(lower);
}

/** A DNS lookup that fails when any resolved address is blocked. */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, '', 0);
    const blocked = addresses.find((entry) => isBlockedAddress(entry.address));
    if (blocked || addresses.length === 0) {
      return callback(new HostNotAllowedError(`${hostname} resolves to a link-local or reserved address`), '', 0);
    }
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
};

/**
 * A host as `URL.host` spells it: lower-case, with the default HTTPS port dropped (`GitLab.Example:443` →
 * `gitlab.example`). The allowlist and token binding both compare these, so they match what a request URL says.
 */
export function normalizeHost(host: string): string {
  const stripped = host.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/s, '');
  try {
    return new URL(`https://${stripped}`).host;
  } catch {
    return stripped.toLowerCase();
  }
}

export function hostNotAllowedMessage(host: string): string {
  return `The MCP server doesn't contact ${host}: it only talks to gitlab.com, hosts you have a token for, and the ` +
    `GitLab instances in your user settings. To allow it, add a source with "gitlabInstance": "${host}" to your USER ` +
    'settings gitlabComponentHelper.componentSources (not the workspace settings), or pass it with --config.';
}

/**
 * @param allowedHosts Hostnames (optionally `host:port`) the server may contact.
 */
export function createNetworkPolicy(allowedHosts: Iterable<string>): NetworkPolicyPort & { isAllowed(host: string): boolean } {
  const allowed = new Set([...allowedHosts].map(normalizeHost));
  const isAllowed = (host: string) => allowed.has(normalizeHost(host));
  return {
    isAllowed,
    checkRequest: (url) => {
      if (url.protocol !== 'https:') {
        throw new HostNotAllowedError(`Refusing a non-HTTPS request to ${url.host}`);
      }
      if (!isAllowed(url.host)) {
        throw new HostNotAllowedError(hostNotAllowedMessage(url.host));
      }
      if (isIP(url.hostname.replace(/^\[|\]$/g, '')) && isBlockedAddress(url.hostname.replace(/^\[|\]$/g, ''))) {
        throw new HostNotAllowedError(`Refusing a request to the link-local or reserved address ${url.hostname}`);
      }
    },
    lookup: guardedLookup,
  };
}
