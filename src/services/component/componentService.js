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
exports.ComponentService = void 0;
exports.getComponentService = getComponentService;
const vscode = __importStar(require("vscode"));
const httpClient_1 = require("../../utils/httpClient");
const logger_1 = require("../../utils/logger");
const performanceMonitor_1 = require("../../utils/performanceMonitor");
const tokenManager_1 = require("./tokenManager");
const urlParser_1 = require("./urlParser");
const versionManager_1 = require("./versionManager");
const componentFetcher_1 = require("./componentFetcher");
const sourceCache = new Map();
const backgroundUpdateInProgress = false;
/**
 * Main component service that orchestrates fetching and managing GitLab components
 * Delegates to specialized services for specific functionality
 */
class ComponentService {
    constructor() {
        this.httpClient = new httpClient_1.HttpClient();
        this.logger = logger_1.Logger.getInstance();
        this.performanceMonitor = (0, performanceMonitor_1.getPerformanceMonitor)();
        this.componentCache = new Map();
        // Legacy methods for backward compatibility
        this.legacyTokenWarningLogged = false;
        this.tokenManager = new tokenManager_1.TokenManager();
        this.urlParser = new urlParser_1.UrlParser();
        this.versionManager = new versionManager_1.VersionManager(this.httpClient, this.tokenManager);
        this.componentFetcher = new componentFetcher_1.ComponentFetcher(this.httpClient, this.tokenManager, this.urlParser);
    }
    // Token management delegation
    setSecretStorage(secretStorage) {
        this.tokenManager.setSecretStorage(secretStorage);
    }
    async getTokenForProject(gitlabInstance, projectPath) {
        return this.tokenManager.getTokenForProject(gitlabInstance, projectPath);
    }
    async setTokenForProject(gitlabInstance, projectPath, token) {
        return this.tokenManager.setTokenForProject(gitlabInstance, projectPath, token);
    }
    async getTokenForInstance(gitlabInstance) {
        return this.tokenManager.getTokenForInstance(gitlabInstance);
    }
    // Component retrieval
    async getComponents() {
        return this.getLocalComponents();
    }
    async getComponent(name) {
        const components = await this.getComponents();
        return components.find((c) => c.name === name);
    }
    // Component fetching delegation
    async getComponentFromUrl(url, context) {
        try {
            const component = await this.componentFetcher.fetchComponentMetadata(url, context);
            if (component) {
                // Parse the URL for context info
                const parsed = this.urlParser.parseCustomComponentUrl(url);
                if (parsed) {
                    component.context = {
                        gitlabInstance: parsed.gitlabInstance,
                        path: parsed.path
                    };
                }
            }
            return component;
        }
        catch (error) {
            this.logger.error(`Error fetching component from URL: ${error}`);
            throw error;
        }
    }
    // URL parsing delegation
    parseCustomComponentUrl(url) {
        return this.urlParser.parseCustomComponentUrl(url);
    }
    // Version management delegation
    async fetchProjectVersions(gitlabInstance, projectPath) {
        return this.versionManager.fetchProjectVersions(gitlabInstance, projectPath);
    }
    async fetchProjectTags(gitlabInstance, projectPath) {
        return this.versionManager.fetchProjectTags(gitlabInstance, projectPath);
    }
    // Catalog data delegation
    async fetchCatalogData(gitlabInstance, projectPath, forceRefresh = false, version, context) {
        return this.componentFetcher.fetchCatalogData(gitlabInstance, projectPath, forceRefresh, version, context);
    }
    // HTTP client delegation
    async fetchJson(url, options) {
        return this.httpClient.fetchJson(url, options);
    }
    async fetchRawFile(gitlabInstance, projectPath, filePath, ref = 'main') {
        const cleanGitlabInstance = this.urlParser.cleanGitLabInstance(gitlabInstance);
        const url = `https://${cleanGitlabInstance}/api/v4/projects/${encodeURIComponent(projectPath)}/repository/files/${encodeURIComponent(filePath)}/raw?ref=${ref}`;
        const token = await this.getTokenForProject(cleanGitlabInstance, projectPath);
        const headers = token ? { 'PRIVATE-TOKEN': token } : undefined;
        return this.httpClient.fetchText(url, { headers });
    }
    async fetchText(url) {
        return this.httpClient.fetchText(url);
    }
    // Local mock components (for fallback/testing)
    getLocalComponents() {
        return [
            {
                name: 'deploy-component',
                description: 'Deploys the application to the specified environment',
                parameters: [
                    {
                        name: 'environment',
                        description: 'Target environment for deployment',
                        required: true,
                        type: 'string'
                    },
                    {
                        name: 'version',
                        description: 'Version to deploy',
                        required: false,
                        type: 'string',
                        default: 'latest'
                    }
                ]
            },
            {
                name: 'test-component',
                description: 'Runs tests for the application',
                parameters: [
                    {
                        name: 'test_type',
                        description: 'Type of tests to run',
                        required: true,
                        type: 'string'
                    },
                    {
                        name: 'coverage',
                        description: 'Whether to collect coverage information',
                        required: false,
                        type: 'boolean',
                        default: false
                    }
                ]
            }
        ];
    }
    async resolveLegacyGitlabToken(gitlabHost) {
        const secretToken = await this.tokenManager.getTokenForInstance(gitlabHost);
        if (secretToken) {
            return secretToken;
        }
        const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
        const settingToken = config.get('gitlabToken', '');
        if (settingToken && !this.legacyTokenWarningLogged) {
            this.logger.warn('[ComponentService] Using gitlabComponentHelper.gitlabToken from settings.json (plain text). ' +
                'Run the "GitLab CI: Add Component Project/Group" command to migrate this token to encrypted SecretStorage, then clear the setting.');
            this.legacyTokenWarningLogged = true;
        }
        return settingToken;
    }
    async fetchFromGitLab() {
        const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
        const gitlabUrl = config.get('gitlabUrl', '');
        const projectId = config.get('gitlabProjectId', '');
        const filePath = config.get('gitlabComponentsFilePath', 'components.json');
        if (!gitlabUrl || !projectId) {
            throw new Error('GitLab URL or project ID not configured');
        }
        const gitlabHost = (() => {
            try {
                return new URL(gitlabUrl).hostname;
            }
            catch {
                return gitlabUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
            }
        })();
        const token = await this.resolveLegacyGitlabToken(gitlabHost);
        if (!token) {
            throw new Error(`No GitLab token configured for ${gitlabHost}. Run the "GitLab CI: Add Component Project/Group" command to add one.`);
        }
        const apiUrl = `${gitlabUrl}/api/v4/projects/${encodeURIComponent(projectId)}/repository/files/${encodeURIComponent(filePath)}/raw`;
        try {
            const components = await this.httpClient.fetchJson(apiUrl, {
                headers: {
                    'PRIVATE-TOKEN': token
                }
            });
            this.logger.info(`Successfully fetched ${components.length} components from GitLab`);
            return components;
        }
        catch (error) {
            this.logger.error(`GitLab fetch failed: ${error}`);
            throw error;
        }
    }
    async fetchFromUrl() {
        const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
        const url = config.get('componentsUrl', '');
        if (!url) {
            throw new Error('Components URL not configured');
        }
        try {
            const components = await this.httpClient.fetchJson(url);
            this.logger.info(`Successfully fetched ${components.length} components from URL`);
            return components;
        }
        catch (error) {
            this.logger.error(`URL fetch failed: ${error}`);
            throw error;
        }
    }
    // Cache management
    updateCache() {
        this.logger.info('[ComponentService] Updating cache - forcing refresh of all data');
        this.componentFetcher.clearCache();
        this.componentCache.clear();
        sourceCache.clear();
        this.logger.info('[ComponentService] Cache update completed - all cached data will be refreshed on next request');
    }
    resetCache() {
        this.logger.info('[ComponentService] Resetting cache - clearing all cached data');
        this.componentFetcher.clearCache();
        this.componentCache.clear();
        sourceCache.clear();
        this.logger.info('[ComponentService] Cache reset completed - all cached data cleared');
    }
    getCacheStats() {
        const catalogStats = this.componentFetcher.getCatalogCacheStats();
        return {
            catalogCacheSize: catalogStats.size,
            componentCacheSize: this.componentCache.size,
            sourceCacheSize: sourceCache.size,
            catalogKeys: catalogStats.keys,
            componentKeys: Array.from(this.componentCache.keys()),
            sourceKeys: Array.from(sourceCache.keys())
        };
    }
}
exports.ComponentService = ComponentService;
// Singleton instance
let serviceInstance = null;
function getComponentService() {
    if (!serviceInstance) {
        serviceInstance = new ComponentService();
    }
    return serviceInstance;
}
//# sourceMappingURL=componentService.js.map