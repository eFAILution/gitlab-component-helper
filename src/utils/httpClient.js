"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpClient = void 0;
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const vscode = __importStar(require("vscode"));
const logger_1 = require("./logger");
const requestDeduplicator_1 = require("./requestDeduplicator");
const performanceMonitor_1 = require("./performanceMonitor");
const errors_1 = require("../errors");
class HttpClient {
    constructor() {
        this.logger = logger_1.Logger.getInstance();
        this.performanceMonitor = (0, performanceMonitor_1.getPerformanceMonitor)();
        this.deduplicator = (0, requestDeduplicator_1.getRequestDeduplicator)();
    }
    getConfig() {
        const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
        return {
            timeout: config.get('httpTimeout', 10000),
            retryAttempts: config.get('retryAttempts', 3)
        };
    }
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    shouldRetry(statusCode) {
        // Don't retry client errors (4xx), only server errors (5xx) and network issues
        return statusCode >= 500 || statusCode === 429; // Include rate limiting
    }
    buildCacheKey(url, headers) {
        // Include auth tokens in cache key to avoid mixing authenticated/unauthenticated responses
        const authToken = headers['Authorization'] || headers['PRIVATE-TOKEN'] || '';
        return `${url}|${authToken}`;
    }
    async fetchJson(url, options = {}) {
        return this.performanceMonitor.track('httpClient.fetchJson', async () => {
            return this.fetchJsonInternal(url, options);
        }, { url: new URL(url).hostname + new URL(url).pathname });
    }
    async fetchJsonInternal(url, options = {}) {
        const config = this.getConfig();
        const timeout = options.timeout || config.timeout;
        const retryAttempts = options.retryAttempts || config.retryAttempts;
        const headers = {
            'User-Agent': 'VSCode-GitLabComponentHelper',
            ...options.headers
        };
        const cacheKey = this.buildCacheKey(url, headers);
        return this.deduplicator.fetch(cacheKey, async () => {
            for (let attempt = 0; attempt <= retryAttempts; attempt++) {
                try {
                    this.logger.debug(`HTTP Request attempt ${attempt + 1}/${retryAttempts + 1}: ${url}`);
                    const data = await this.makeRequest(url, { timeout, headers });
                    try {
                        const jsonData = JSON.parse(data);
                        this.logger.debug(`HTTP Request successful: ${url} (${data.length} chars)`);
                        return jsonData;
                    }
                    catch (parseError) {
                        // JSON parse error - don't retry
                        throw new errors_1.NetworkError(`Invalid JSON response from ${url}`, { statusCode: 0, cause: parseError });
                    }
                }
                catch (error) {
                    const isLastAttempt = attempt === retryAttempts;
                    // Check if error is NetworkError with statusCode
                    const statusCode = error instanceof errors_1.NetworkError && error.details?.statusCode
                        ? error.details.statusCode
                        : error.statusCode;
                    if (statusCode && !this.shouldRetry(statusCode)) {
                        this.logger.warn(`HTTP Request failed with client error ${statusCode}: ${url}`);
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
            throw new errors_1.NetworkError('Unexpected error in retry loop');
        });
    }
    async fetchText(url, options = {}) {
        return this.performanceMonitor.track('httpClient.fetchText', async () => {
            return this.fetchTextInternal(url, options);
        }, { url: new URL(url).hostname + new URL(url).pathname });
    }
    async fetchTextInternal(url, options = {}) {
        const config = this.getConfig();
        const timeout = options.timeout || config.timeout;
        const retryAttempts = options.retryAttempts || config.retryAttempts;
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
                }
                catch (error) {
                    const isLastAttempt = attempt === retryAttempts;
                    // Check if error is NetworkError with statusCode
                    const statusCode = error instanceof errors_1.NetworkError && error.details?.statusCode
                        ? error.details.statusCode
                        : error.statusCode;
                    if (statusCode && !this.shouldRetry(statusCode)) {
                        this.logger.warn(`HTTP Text Request failed with client error ${statusCode}: ${url}`);
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
            throw new errors_1.NetworkError('Unexpected error in retry loop');
        });
    }
    makeRequest(url, options) {
        return new Promise((resolve, reject) => {
            try {
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
                        }
                        else {
                            const message = `HTTP ${res.statusCode}: ${data.substring(0, 200)}`;
                            reject(new errors_1.NetworkError(message, { statusCode: res.statusCode }));
                        }
                    });
                });
                req.on('timeout', () => {
                    req.destroy();
                    const handler = (0, errors_1.getErrorHandler)();
                    reject(handler.createHttpError(408, `Request timeout after ${options.timeout}ms for ${url}`));
                });
                req.on('error', (error) => {
                    reject(new errors_1.NetworkError(error.message, { cause: error }));
                });
                req.end();
            }
            catch (error) {
                reject(new errors_1.NetworkError(error instanceof Error ? error.message : String(error), { cause: error }));
            }
        });
    }
    // Parallel request utility
    async fetchParallel(requests, parser = (data) => JSON.parse(data)) {
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
            }
            catch (error) {
                return { error: error, url };
            }
        });
        return Promise.all(promises);
    }
    // Batch processing utility
    async processBatch(items, processor, batchSize = 5) {
        const results = [];
        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            this.logger.debug(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)} (${batch.length} items)`);
            const batchResults = await Promise.all(batch.map(item => processor(item)));
            results.push(...batchResults);
        }
        return results;
    }
    // Get request deduplication statistics
    getDeduplicationStats() {
        return this.deduplicator.getStats();
    }
    // Clear all pending deduplicated requests
    clearDeduplicatedRequests() {
        this.deduplicator.clear();
    }
}
exports.HttpClient = HttpClient;
//# sourceMappingURL=httpClient.js.map