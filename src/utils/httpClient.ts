import * as https from 'https';
import * as http from 'http';
import * as vscode from 'vscode';
import { Logger } from './logger';

interface RequestOptions {
  timeout?: number;
  retryAttempts?: number;
  headers?: Record<string, string>;
  retryDelay?: number;
}

export class HttpClient {
  private logger = Logger.getInstance();

  constructor() {}

  private getConfig() {
    const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
    return {
      timeout: config.get<number>('httpTimeout', 10000),
      retryAttempts: config.get<number>('retryAttempts', 3)
    };
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private shouldRetry(statusCode: number): boolean {
    // Don't retry client errors (4xx), only server errors (5xx) and network issues
    return statusCode >= 500 || statusCode === 429; // Include rate limiting
  }

  async fetchJson(url: string, options: RequestOptions = {}): Promise<any> {
    const config = this.getConfig();
    const timeout = options.timeout || config.timeout;
    const retryAttempts = options.retryAttempts || config.retryAttempts;
    const headers = {
      'User-Agent': 'VSCode-GitLabComponentHelper',
      ...options.headers
    };

    for (let attempt = 0; attempt <= retryAttempts; attempt++) {
      try {
        this.logger.debug(`HTTP Request attempt ${attempt + 1}/${retryAttempts + 1}: ${url}`);

        const data = await this.makeRequest(url, { timeout, headers });
        const jsonData = JSON.parse(data);

        this.logger.debug(`HTTP Request successful: ${url} (${data.length} chars)`);
        return jsonData;
      } catch (error: any) {
        const isLastAttempt = attempt === retryAttempts;

        if (error.statusCode && !this.shouldRetry(error.statusCode)) {
          this.logger.warn(`HTTP Request failed with client error ${error.statusCode}: ${url}`);
          throw error;
        }

        if (isLastAttempt) {
          this.logger.error(`HTTP Request failed after ${retryAttempts + 1} attempts: ${url} - ${error.message}`);
          throw error;
        }

        // Exponential backoff with jitter
        const baseDelay = options.retryDelay || 1000;
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;

        this.logger.warn(`HTTP Request failed (attempt ${attempt + 1}), retrying in ${delay}ms: ${url} - ${error.message}`);
        await this.delay(delay);
      }
    }

    throw new Error('Unexpected error in retry loop');
  }

  async fetchText(url: string, options: RequestOptions = {}): Promise<string> {
    const config = this.getConfig();
    const timeout = options.timeout || config.timeout;
    const retryAttempts = options.retryAttempts || config.retryAttempts;
    const headers = {
      'User-Agent': 'VSCode-GitLabComponentHelper',
      ...options.headers
    };

    for (let attempt = 0; attempt <= retryAttempts; attempt++) {
      try {
        this.logger.debug(`HTTP Text Request attempt ${attempt + 1}/${retryAttempts + 1}: ${url}`);

        const data = await this.makeRequest(url, { timeout, headers });

        this.logger.debug(`HTTP Text Request successful: ${url} (${data.length} chars)`);
        return data;
      } catch (error: any) {
        const isLastAttempt = attempt === retryAttempts;

        if (error.statusCode && !this.shouldRetry(error.statusCode)) {
          this.logger.warn(`HTTP Text Request failed with client error ${error.statusCode}: ${url}`);
          throw error;
        }

        if (isLastAttempt) {
          this.logger.error(`HTTP Text Request failed after ${retryAttempts + 1} attempts: ${url} - ${error.message}`);
          throw error;
        }

        // Exponential backoff with jitter
        const baseDelay = options.retryDelay || 1000;
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;

        this.logger.warn(`HTTP Text Request failed (attempt ${attempt + 1}), retrying in ${delay}ms: ${url} - ${error.message}`);
        await this.delay(delay);
      }
    }

    throw new Error('Unexpected error in retry loop');
  }

  private makeRequest(url: string, options: { timeout: number; headers: Record<string, string> }): Promise<string> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const client = isHttps ? https : http;

      const requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'GET',
        headers: options.headers,
        timeout: options.timeout
      };

      const req = client.request(requestOptions, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            const error = new Error(`HTTP ${res.statusCode}: ${data}`);
            (error as any).statusCode = res.statusCode;
            reject(error);
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timeout after ${options.timeout}ms`));
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.end();
    });
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
        return { error: error as Error, url };
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
}
