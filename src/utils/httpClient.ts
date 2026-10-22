import * as https from 'https';
import * as http from 'http';
import { createHash } from 'crypto';
import { Logger } from './logger';
import { getRequestDeduplicator, RequestDeduplicator } from './requestDeduplicator';
import { getPerformanceMonitor } from './performanceMonitor';
import { GitLabComponentError, NetworkError, extractStatusCode } from '../errors';
import { API_PER_PAGE_LIMIT, MAX_PAGINATION_PAGES, MAX_REDIRECTS } from '../constants/timing';
import { planRedirect, stripCredentialHeaders } from './redirectPolicy';
import { CONFIG_DEFAULTS } from '../core/config/defaults';
import { getRuntime, isRuntimeLocked } from '../core/runtime';
import { RequestRefusedError } from '../core/ports';

/** Largest response body read; a bigger one is aborted. */
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 60000;
const MAX_RETRY_ATTEMPTS = 5;
/** The whole request (headers and body) must finish within this many socket timeouts... */
const DEADLINE_TIMEOUTS = 3;
/** ...and never take longer than this. */
const MAX_DEADLINE_MS = 180000;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(Math.max(number, min), max);
}

/** Whether a request was refused by the network policy (directly, or wrapped in a NetworkError). */
function isRefused(error: unknown): boolean {
  return error instanceof RequestRefusedError || (error instanceof GitLabComponentError && error.cause instanceof RequestRefusedError);
}

interface RequestOptions {
  timeout?: number;
  retryAttempts?: number;
  headers?: Record<string, string>;
  retryDelay?: number;
}

/**
 * Extract a log-friendly message from an unknown thrown value.
 *
 * @param error  The value caught in a `try`/`catch` block.
 * @returns      `Error.message` when `error` is an `Error`, otherwise `String(error)`.
 */
function extractMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Coerce an unknown thrown value to a real `Error`, preserving the original (and its stack) when
 * possible. Use this at API boundaries that require an `Error` (e.g. `NetworkError`'s `cause` option)
 * instead of an `as Error` assertion, which would lie about non-Error throws like strings or numbers.
 *
 * @param error  The value caught in a `try`/`catch` block.
 * @returns      The original `Error` if `error` already is one, otherwise a new `Error` wrapping `String(error)`.
 */
function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

export class HttpClient {
  private logger = Logger.getInstance();
  private performanceMonitor = getPerformanceMonitor();
  private deduplicator: RequestDeduplicator;

  constructor() {
    this.deduplicator = getRequestDeduplicator();
  }

  private getConfig() {
    const { config } = getRuntime();
    return {
      timeout: config.get<number>('httpTimeout', CONFIG_DEFAULTS.httpTimeout),
      retryAttempts: config.get<number>('retryAttempts', CONFIG_DEFAULTS.retryAttempts)
    };
  }

  /** The timeout and retry count for one call: the caller's, else the settings, clamped to sane bounds. */
  private limitsFor(options: RequestOptions): { timeout: number; retryAttempts: number } {
    const config = this.getConfig();
    return {
      timeout: clamp(options.timeout || config.timeout, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS, CONFIG_DEFAULTS.httpTimeout),
      retryAttempts: clamp(options.retryAttempts || config.retryAttempts, 0, MAX_RETRY_ATTEMPTS, CONFIG_DEFAULTS.retryAttempts),
    };
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private shouldRetry(statusCode: number): boolean {
    // Don't retry client errors (4xx), only server errors (5xx) and network issues
    return statusCode >= 500 || statusCode === 429; // Include rate limiting
  }

  private buildCacheKey(url: string, headers: Record<string, string>): string {
    // Key on the auth token so authenticated and unauthenticated responses never mix. Hash it so the raw token
    // never sits in the key, which getDeduplicationStats() hands out.
    const authToken = headers['Authorization'] || headers['PRIVATE-TOKEN'] || '';
    const authDigest = authToken ? createHash('sha256').update(authToken).digest('hex') : '';
    return `${url}|${authDigest}`;
  }

  async fetchJson<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
    return this.performanceMonitor.track(
      'httpClient.fetchJson',
      async () => {
        return this.fetchJsonInternal<T>(url, options);
      },
      { url: new URL(url).hostname + new URL(url).pathname }
    );
  }

  private async fetchJsonInternal<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
    const { timeout, retryAttempts } = this.limitsFor(options);
    const headers = {
      'User-Agent': 'VSCode-GitLabComponentHelper',
      ...options.headers
    };

    const cacheKey = this.buildCacheKey(url, headers);

    return this.deduplicator.fetch<T>(cacheKey, async () => {
      for (let attempt = 0; attempt <= retryAttempts; attempt++) {
        try {
          this.logger.debug(`HTTP Request attempt ${attempt + 1}/${retryAttempts + 1}: ${url}`);

          const data = await this.makeRequest(url, { timeout, headers });

          try {
            const jsonData = JSON.parse(data) as T;
            this.logger.debug(`HTTP Request successful: ${url} (${data.length} chars)`);
            return jsonData;
          } catch (parseError) {
            // JSON parse error - don't retry
            throw new NetworkError(
              `Invalid JSON response from ${url}`,
              { statusCode: 0, cause: toError(parseError) }
            );
          }
        } catch (error: unknown) {
          const isLastAttempt = attempt === retryAttempts;

          const statusCode = extractStatusCode(error);
          const message = extractMessage(error);

          if (isRefused(error)) {
            throw error;
          }

          if (statusCode && !this.shouldRetry(statusCode)) {
            this.logger.warn(`HTTP Request failed with client error ${statusCode}: ${url}`);
            throw error;
          }

          if (isLastAttempt) {
            this.logger.error(`HTTP Request failed after ${retryAttempts + 1} attempts: ${url} - ${message}`);
            throw error;
          }

          // Exponential backoff with jitter
          const baseDelay = options.retryDelay || 1000;
          const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;

          this.logger.warn(`HTTP Request failed (attempt ${attempt + 1}), retrying in ${delay}ms: ${url} - ${message}`);
          await this.delay(delay);
        }
      }

      throw new NetworkError('Unexpected error in retry loop');
    });
  }

  async fetchText(url: string, options: RequestOptions = {}): Promise<string> {
    return this.performanceMonitor.track(
      'httpClient.fetchText',
      async () => {
        return this.fetchTextInternal(url, options);
      },
      { url: new URL(url).hostname + new URL(url).pathname }
    );
  }

  private async fetchTextInternal(url: string, options: RequestOptions = {}): Promise<string> {
    const { timeout, retryAttempts } = this.limitsFor(options);
    const headers = {
      'User-Agent': 'VSCode-GitLabComponentHelper',
      ...options.headers
    };

    const cacheKey = this.buildCacheKey(url, headers);

    return this.deduplicator.fetch(cacheKey, async () => {
      for (let attempt = 0; attempt <= retryAttempts; attempt++) {
        try {
          this.logger.debug(`HTTP Text Request attempt ${attempt + 1}/${retryAttempts + 1}: ${url}`);

          const data = await this.makeRequest(url, { timeout, headers });

          this.logger.debug(`HTTP Text Request successful: ${url} (${data.length} chars)`);
          return data;
        } catch (error: unknown) {
          const isLastAttempt = attempt === retryAttempts;

          const statusCode = extractStatusCode(error);
          const message = extractMessage(error);

          if (isRefused(error)) {
            throw error;
          }

          if (statusCode && !this.shouldRetry(statusCode)) {
            this.logger.warn(`HTTP Text Request failed with client error ${statusCode}: ${url}`);
            throw error;
          }

          if (isLastAttempt) {
            this.logger.error(`HTTP Text Request failed after ${retryAttempts + 1} attempts: ${url} - ${message}`);
            throw error;
          }

          // Exponential backoff with jitter
          const baseDelay = options.retryDelay || 1000;
          const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;

          this.logger.warn(`HTTP Text Request failed (attempt ${attempt + 1}), retrying in ${delay}ms: ${url} - ${message}`);
          await this.delay(delay);
        }
      }

      throw new NetworkError('Unexpected error in retry loop');
    });
  }

  /**
   * Perform a GET request and resolve with the response body only.
   *
   * A thin wrapper over {@link makeRequestWithHeaders} for the common case where callers don't need response headers.
   *
   * @param url The fully-qualified request URL.
   * @param options Request timeout (ms) and headers to send.
   * @returns The response body as a string.
   */
  private async makeRequest(
    url: string,
    options: { timeout: number; headers: Record<string, string> }
  ): Promise<string> {
    const { body } = await this.makeRequestWithHeaders(url, options);
    return body;
  }

  /**
   * Perform a GET request and resolve with both the response body and headers.
   *
   * `makeRequest` discards headers; this sibling preserves them so callers that need pagination metadata (GitLab's
   * `x-next-page` / `x-total-pages`) can read it. Header names are lower-cased by Node's HTTP layer.
   *
   * Redirects are followed under the credential-safe policy in {@link planRedirect}: same-origin hops keep the
   * request headers, cross-origin hops drop the `Authorization`/`PRIVATE-TOKEN`/`Cookie` headers first (so a moved
   * project whose old path was reclaimed can't harvest the user's token), HTTPS→HTTP downgrades are refused, and the
   * chain is capped at `redirectsRemaining` hops.
   *
   * @param url The fully-qualified request URL.
   * @param options Request timeout (ms) and headers to send.
   * @param redirectsRemaining Remaining redirect hops before the chain is rejected (defaults to {@link MAX_REDIRECTS}).
   * @returns The response body string and a lower-cased header map.
   */
  private makeRequestWithHeaders(
    url: string,
    options: { timeout: number; headers: Record<string, string> },
    redirectsRemaining: number = MAX_REDIRECTS
  ): Promise<{ body: string; headers: Record<string, string> }> {
    return new Promise((resolve, reject) => {
      try {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const client = isHttps ? https : http;
        const { network } = getRuntime();
        // A locked runtime is the MCP server's; without its policy, fail closed instead of contacting anything.
        if (!network && isRuntimeLocked()) {
          throw new RequestRefusedError('Refusing the request: no network policy is installed');
        }
        network?.checkRequest(urlObj);

        const requestOptions = {
          hostname: urlObj.hostname,
          port: urlObj.port || (isHttps ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method: 'GET',
          headers: options.headers,
          timeout: options.timeout,
          ...(network?.lookup ? { lookup: network.lookup } : {})
        };

        // Socket idle timeouts don't bound a server that trickles bytes, so the whole request also has a deadline.
        const deadlineMs = Math.min(options.timeout * DEADLINE_TIMEOUTS, MAX_DEADLINE_MS);
        const settle = (finish: () => void) => {
          clearTimeout(deadline);
          finish();
        };
        const deadline = setTimeout(() => {
          req.destroy();
          reject(new NetworkError(`Request to ${url} passed its ${deadlineMs}ms deadline`, { statusCode: 408 }));
        }, deadlineMs);

        const req = client.request(requestOptions, (res) => {
          const statusCode = res.statusCode ?? 0;

          // Resolve redirects before reading the body. `planRedirect` enforces the credential-safe,
          // same-origin-preferring policy; a malformed redirect or a refused HTTPS→HTTP downgrade throws.
          let redirect;
          try {
            redirect = planRedirect(url, statusCode, res.headers.location);
          } catch (policyError) {
            res.resume(); // drain so the socket can be released
            settle(() => reject(policyError));
            return;
          }

          if (redirect) {
            res.resume(); // discard the redirect response body
            if (redirectsRemaining <= 0) {
              settle(() => reject(new NetworkError(`Too many redirects while fetching ${url}`, { statusCode })));
              return;
            }
            const nextHeaders = redirect.stripCredentials
              ? stripCredentialHeaders(options.headers)
              : options.headers;
            clearTimeout(deadline);
            this.makeRequestWithHeaders(
              redirect.nextUrl,
              { timeout: options.timeout, headers: nextHeaders },
              redirectsRemaining - 1
            ).then(resolve, reject);
            return;
          }

          let data = '';
          let receivedBytes = 0;
          let tooLarge = false;

          res.on('data', (chunk: Buffer | string) => {
            if (tooLarge) return;
            receivedBytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
            if (receivedBytes > MAX_RESPONSE_BYTES) {
              tooLarge = true;
              req.destroy();
              settle(() => reject(new NetworkError(`Response from ${urlObj.host} is too large (over ${MAX_RESPONSE_BYTES} bytes)`)));
              return;
            }
            data += chunk;
          });

          res.on('end', () => {
            if (tooLarge) return;
            clearTimeout(deadline);
            if (statusCode >= 200 && statusCode < 300) {
              const headers: Record<string, string> = {};
              for (const [key, value] of Object.entries(res.headers)) {
                if (typeof value === 'string') {
                  headers[key] = value;
                } else if (Array.isArray(value)) {
                  headers[key] = value.join(', ');
                }
              }
              resolve({ body: data, headers });
            } else {
              const message = `HTTP ${statusCode}: ${data.substring(0, 200)}`;
              reject(new NetworkError(message, { statusCode }));
            }
          });
        });

        req.on('timeout', () => {
          req.destroy();
          settle(() => reject(new NetworkError(`Request timeout after ${options.timeout}ms for ${url}`, { statusCode: 408 })));
        });

        req.on('error', (error) => {
          settle(() => reject(new NetworkError(error.message, { cause: error })));
        });

        req.end();
      } catch (error) {
        reject(new NetworkError(extractMessage(error), { cause: toError(error) }));
      }
    });
  }

  /**
   * Fetch every page of a paginated GitLab collection endpoint, following the `x-next-page` response header until it
   * is empty. Each request appends `per_page`/`page` query parameters (preserving any already present on `url`).
   *
   * Use this for list endpoints that can exceed one page (tags, branches, project listings).
   *
   * A safety cap prevents an unbounded loop if a server misreports
   * pagination headers; hitting it is logged.
   *
   * @param url The collection endpoint URL (without `page`; `per_page` is appended).
   * @param options Standard request options (headers, timeout, retry).
   * @param perPage Items per page (defaults to {@link API_PER_PAGE_LIMIT}; GitLab caps at 100).
   * @param maxPages Hard cap on pages fetched, as a runaway-loop backstop (defaults to {@link MAX_PAGINATION_PAGES}).
   * @returns A flat array of all items across every page.
   */
  async fetchAllPages<T = unknown>(
    url: string,
    options: RequestOptions = {},
    perPage: number = API_PER_PAGE_LIMIT,
    maxPages: number = MAX_PAGINATION_PAGES
  ): Promise<T[]> {
    const headers = {
      'User-Agent': 'VSCode-GitLabComponentHelper',
      ...options.headers
    };
    const timeout = options.timeout || this.getConfig().timeout;

    const all: T[] = [];
    let page = 1;

    while (page <= maxPages) {
      const pageUrl = new URL(url);
      pageUrl.searchParams.set('per_page', String(perPage));
      pageUrl.searchParams.set('page', String(page));

      const { body, headers: responseHeaders } = await this.makeRequestWithHeaders(pageUrl.toString(), {
        timeout,
        headers
      });

      let items: T[];
      try {
        const parsed = JSON.parse(body);
        items = Array.isArray(parsed) ? parsed : [];
      } catch (parseError) {
        throw new NetworkError(
          `Invalid JSON response from ${pageUrl.toString()}`,
          { statusCode: 0, cause: toError(parseError) }
        );
      }

      all.push(...items);

      const nextPage = responseHeaders['x-next-page'];
      if (!nextPage || nextPage.trim() === '') {
        return all;
      }
      page += 1;
    }

    this.logger.warn(
      `fetchAllPages hit the ${maxPages}-page safety cap for ${url}; results may be truncated (${all.length} items)`
    );
    return all;
  }

  // Parallel request utility
  async fetchParallel<T>(
    requests: Array<{ url: string; options?: RequestOptions }>,
    parser: (data: string, url: string) => T = (data) => JSON.parse(data) as T
  ): Promise<Array<{ result?: T; error?: Error; url: string }>> {
    const promises = requests.map(async ({ url, options = {} }) => {
      try {
        const data = await this.makeRequest(url, {
          timeout: options.timeout || this.getConfig().timeout,
          headers: {
            'User-Agent': 'VSCode-GitLabComponentHelper',
            ...options.headers
          }
        });
        const result = parser(data, url);
        return { result, url };
      } catch (error) {
        return { error: toError(error), url };
      }
    });

    return Promise.all(promises);
  }

  // Batch processing utility
  async processBatch<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    batchSize: number = 5
  ): Promise<R[]> {
    const results: R[] = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      this.logger.debug(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)} (${batch.length} items)`);

      const batchResults = await Promise.all(
        batch.map(item => processor(item))
      );

      results.push(...batchResults);
    }

    return results;
  }

  // Get request deduplication statistics
  getDeduplicationStats(): { pendingCount: number; pendingKeys: string[] } {
    return this.deduplicator.getStats();
  }

  // Clear all pending deduplicated requests
  clearDeduplicatedRequests(): void {
    this.deduplicator.clear();
  }
}
