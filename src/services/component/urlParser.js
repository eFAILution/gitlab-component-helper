"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UrlParser = void 0;
const logger_1 = require("../../utils/logger");
/**
 * Utility for parsing GitLab component URLs
 */
class UrlParser {
    constructor() {
        this.logger = logger_1.Logger.getInstance();
    }
    /**
     * Parse a custom GitLab component URL
     * Handles URLs like: https://gitlab.com/components/proj/proj-template@1.0.0
     * @param url The GitLab component URL to parse
     * @returns Parsed URL components or null if invalid
     */
    parseCustomComponentUrl(url) {
        try {
            const urlObj = new URL(url);
            const gitlabInstance = urlObj.hostname;
            const pathParts = urlObj.pathname.split('/').filter(Boolean);
            if (pathParts.length < 2) {
                return null;
            }
            // The last part contains the component name and optional version in explicit URLs.
            const lastPart = pathParts[pathParts.length - 1];
            let name;
            let version;
            let path;
            if (lastPart.includes('@')) {
                // Split component name and version
                [name, version] = lastPart.split('@');
                path = pathParts.slice(0, pathParts.length - 1).join('/');
            }
            else if (pathParts.length >= 3) {
                name = lastPart;
                path = pathParts.slice(0, pathParts.length - 1).join('/');
            }
            else {
                // Project-only shorthand URL: default to main component on that project.
                name = 'main';
                version = 'main';
                path = pathParts.join('/');
            }
            this.logger.debug(`Parsed component URL: ${gitlabInstance}/${path}/${name}${version ? `@${version}` : ''}`, 'UrlParser');
            return { gitlabInstance, path, name, version };
        }
        catch (e) {
            this.logger.error(`Error parsing component URL: ${e}`, 'UrlParser');
            return null;
        }
    }
    /**
     * Clean GitLab instance URL by removing protocol prefix
     * @param gitlabInstance The GitLab instance URL (may contain protocol)
     * @returns Clean hostname without protocol
     */
    cleanGitLabInstance(gitlabInstance) {
        let clean = gitlabInstance;
        if (clean.startsWith('https://')) {
            clean = clean.replace('https://', '');
        }
        if (clean.startsWith('http://')) {
            clean = clean.replace('http://', '');
        }
        return clean;
    }
}
exports.UrlParser = UrlParser;
//# sourceMappingURL=urlParser.js.map