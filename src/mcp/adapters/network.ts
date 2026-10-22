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

/** IPv4 addresses no GitLab instance lives on: cloud metadata endpoints outside link-local. */
const BLOCKED_IPV4 = new Set(['100.100.100.200']);
/** IPv6 metadata endpoints (AWS IMDS over IPv6). */
const BLOCKED_IPV6 = new Set(['fd00:0ec2:0000:0000:0000:0000:0000:0254']);

function parseIpv4(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  return address.split('.').map(Number);
}

/** Parse an IPv6 address (zone id allowed, dotted IPv4 tail allowed) into 16 bytes. */
export function parseIpv6(address: string): number[] | null {
  const bare = address.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  if (isIP(bare) !== 6) return null;
  let text = bare.toLowerCase();
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split('.').map(Number);
    text = `${text.slice(0, -dotted[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail = ''] = text.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = text.includes('::') ? (tail ? tail.split(':') : []) : [];
  const fill = text.includes('::') ? 8 - headGroups.length - tailGroups.length : 0;
  const groups = [...headGroups, ...Array(fill).fill('0'), ...tailGroups].map((group) => parseInt(group, 16));
  return groups.flatMap((group) => [group >> 8, group & 0xff]);
}

function isBlockedIpv4([a, b, c, d]: number[]): boolean {
  return a === 0 || a >= 224 || (a === 169 && b === 254) || BLOCKED_IPV4.has(`${a}.${b}.${c}.${d}`);
}

/** The IPv4 address an IPv6 address carries: mapped, compatible, NAT64 (64:ff9b::/96, 64:ff9b:1::/48), or 6to4. */
function embeddedIpv4(bytes: number[]): number[] | null {
  const zeros = (from: number, to: number) => bytes.slice(from, to).every((byte) => byte === 0);
  if (zeros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return bytes.slice(12);
  if (zeros(0, 12) && !zeros(12, 16) && !(zeros(12, 15) && bytes[15] === 1)) return bytes.slice(12);
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) return bytes.slice(12);
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return bytes.slice(2, 6);
  return null;
}

function ipv6Key(bytes: number[]): string {
  return Array.from({ length: 8 }, (_, index) => ((bytes[index * 2] << 8) | bytes[index * 2 + 1]).toString(16).padStart(4, '0')).join(':');
}

/**
 * Link-local (incl. the 169.254.169.254 cloud metadata endpoint), unspecified, multicast and reserved addresses, and
 * known metadata endpoints, also when an IPv6 address carries one of them as embedded IPv4. Private and loopback
 * addresses are allowed: self-managed GitLab lives there.
 */
export function isBlockedAddress(address: string): boolean {
  const ipv4 = parseIpv4(address);
  if (ipv4) return isBlockedIpv4(ipv4);
  const bytes = parseIpv6(address);
  if (!bytes) return false;
  if (bytes.every((byte) => byte === 0)) return true;
  if (bytes[0] === 0xff || (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80)) return true;
  if (BLOCKED_IPV6.has(ipv6Key(bytes))) return true;
  const embedded = embeddedIpv4(bytes);
  return embedded ? isBlockedIpv4(embedded) : false;
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
      if (isBlockedAddress(url.hostname)) {
        throw new HostNotAllowedError(`Refusing a request to the link-local or reserved address ${url.hostname}`);
      }
    },
    lookup: guardedLookup,
  };
}
