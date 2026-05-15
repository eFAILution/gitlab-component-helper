"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenManager = void 0;
const logger_1 = require("../../utils/logger");
/**
 * Manages GitLab personal access tokens using VS Code's SecretStorage
 */
class TokenManager {
    constructor() {
        this.logger = logger_1.Logger.getInstance();
    }
    setSecretStorage(secretStorage) {
        this.secretStorage = secretStorage;
    }
    /**
     * Get token for a specific GitLab project
     * @param gitlabInstance The GitLab instance hostname (e.g., 'gitlab.com')
     * @param projectPath The project path (not currently used, but kept for API compatibility)
     */
    async getTokenForProject(gitlabInstance, projectPath) {
        if (!this.secretStorage) {
            this.logger.debug(`No secretStorage available for ${gitlabInstance}`);
            return undefined;
        }
        const key = `gitlab-token-${gitlabInstance}`;
        this.logger.debug(`Looking for token with key: ${key}`);
        const token = await this.secretStorage.get(key);
        this.logger.debug(`Found token for ${gitlabInstance}: ${token ? 'YES' : 'NO'}`);
        return token;
    }
    /**
     * Store token for a specific GitLab project
     * @param gitlabInstance The GitLab instance hostname
     * @param projectPath The project path (not currently used, but kept for API compatibility)
     * @param token The personal access token to store
     */
    async setTokenForProject(gitlabInstance, projectPath, token) {
        if (!this.secretStorage) {
            throw new Error('SecretStorage not available');
        }
        const key = `gitlab-token-${gitlabInstance}`;
        this.logger.debug(`Storing token with key: ${key}`);
        await this.secretStorage.store(key, token);
        this.logger.debug(`Token stored successfully for ${gitlabInstance}`);
    }
    /**
     * Get token for any GitLab instance (convenience method)
     * @param gitlabInstance The GitLab instance hostname
     */
    async getTokenForInstance(gitlabInstance) {
        if (!this.secretStorage) {
            return undefined;
        }
        const key = `gitlab-token-${gitlabInstance}`;
        return await this.secretStorage.get(key);
    }
}
exports.TokenManager = TokenManager;
//# sourceMappingURL=tokenManager.js.map