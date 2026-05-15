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
exports.ComponentFetcher = void 0;
const vscode = __importStar(require("vscode"));
const logger_1 = require("../../utils/logger");
const specParser_1 = require("../../parsers/specParser");
/**
 * Helper function to prompt user for token if needed
 */
async function promptForTokenIfNeeded(context, tokenManager, gitlabInstance, projectPath) {
    const tokenPrompt = `This project/group requires a GitLab personal access token for ${gitlabInstance}. Please enter one to continue.`;
    const token = await vscode.window.showInputBox({
        prompt: tokenPrompt,
        password: true,
        ignoreFocusOut: true
    });
    if (token && token.trim()) {
        await tokenManager.setTokenForProject(gitlabInstance, projectPath, token.trim());
        vscode.window.showInformationMessage(`Token saved for ${gitlabInstance}`);
        return token.trim();
    }
    else if (token === '') {
        vscode.window.showInformationMessage('No token entered. Public access will be used.');
        return undefined;
    }
    return undefined;
}
/**
 * Handles fetching component metadata and catalog data from GitLab
 */
class ComponentFetcher {
    constructor(httpClient, tokenManager, urlParser) {
        this.logger = logger_1.Logger.getInstance();
        this.catalogCache = new Map();
        this.httpClient = httpClient;
        this.tokenManager = tokenManager;
        this.urlParser = urlParser;
    }
    /**
     * Fetch component metadata from a GitLab URL
     * Tries catalog API first, then falls back to repository API
     */
    async fetchComponentMetadata(url, context) {
        const startTime = Date.now();
        try {
            // Parse the GitLab component URL
            const urlObj = new URL(url);
            const gitlabInstance = urlObj.hostname;
            // Extract project path, component name, and version.
            // Supports:
            // 1) /group/project/component@version
            // 2) /group/project/component
            // 3) /group/project (project-only shorthand -> default component selection)
            const pathParts = urlObj.pathname.split('/').filter(Boolean);
            let componentName;
            let version;
            let projectPath;
            let projectOnlyUrl = false;
            const lastPart = pathParts[pathParts.length - 1];
            if (lastPart.includes('@')) {
                [componentName, version] = lastPart.split('@');
                projectPath = pathParts.slice(0, pathParts.length - 1).join('/');
            }
            else if (pathParts.length >= 3) {
                componentName = lastPart;
                version = 'main';
                projectPath = pathParts.slice(0, pathParts.length - 1).join('/');
            }
            else {
                // Project-only URL (e.g. /components/dependency-scanning).
                // Default to "main" and let catalog selection refine it if available.
                componentName = 'main';
                version = 'main';
                projectPath = pathParts.join('/');
                projectOnlyUrl = true;
            }
            this.logger.debug(`Parsed URL: Project=${projectPath}, Component=${componentName}, Version=${version}`);
            const encodedProjectPath = encodeURIComponent(projectPath);
            const apiBaseUrl = `https://${gitlabInstance}/api/v4`;
            let templateContent = '';
            let parameters = [];
            // Try GitLab CI/CD Catalog first
            try {
                const namespaceProject = projectPath;
                const catalogApiUrl = `https://${gitlabInstance}/api/v4/ci/catalog/${encodeURIComponent(namespaceProject)}`;
                const token = await this.tokenManager.getTokenForProject(gitlabInstance, projectPath);
                const catalogFetchOptions = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;
                this.logger.debug(`Trying to fetch from GitLab Catalog API: ${catalogApiUrl}`);
                this.logger.debug(`Using token for catalog API: ${token ? 'YES' : 'NO'}`);
                const catalogData = (await this.httpClient.fetchJson(catalogApiUrl, catalogFetchOptions));
                if (catalogData && catalogData.components) {
                    let catalogComponent = catalogData.components.find((c) => c.name === componentName);
                    // For project-only shorthand URLs, try to auto-select a sensible component.
                    if (!catalogComponent && projectOnlyUrl) {
                        const projectBaseName = projectPath.split('/').pop() || '';
                        catalogComponent =
                            catalogData.components.find((c) => c.name === 'main') ||
                                catalogData.components.find((c) => c.name === projectBaseName) ||
                                (catalogData.components.length === 1 ? catalogData.components[0] : undefined);
                        if (catalogComponent) {
                            componentName = catalogComponent.name;
                            this.logger.debug(`Project-only URL resolved to component: ${componentName}`, 'ComponentFetcher');
                        }
                    }
                    if (catalogComponent) {
                        this.logger.info(`Found component in catalog: ${componentName}`);
                        let extractedParameters = catalogComponent.variables?.map((v) => ({
                            name: v.name,
                            description: v.description || `Parameter: ${v.name}`,
                            required: v.required || false,
                            type: v.type || 'string',
                            default: v.default
                        })) || [];
                        // Some catalog entries omit variable details. Try parsing the template directly.
                        if (extractedParameters.length === 0) {
                            const templateResult = await this.fetchTemplate(apiBaseUrl, encodedProjectPath, componentName, version, catalogFetchOptions);
                            if (templateResult?.parameters?.length) {
                                extractedParameters = templateResult.parameters;
                            }
                        }
                        const component = {
                            name: componentName,
                            description: `# ${componentName}\n\n${catalogComponent.description || ''}\n\n` +
                                `**From GitLab CI/CD Catalog**\n` +
                                `**Project:** [${projectPath}](https://${gitlabInstance}/${projectPath})\n` +
                                `**Version:** ${version}\n\n` +
                                (catalogComponent.documentation_url
                                    ? `[Full Documentation](${catalogComponent.documentation_url})`
                                    : ''),
                            parameters: extractedParameters,
                            version,
                            source: `${gitlabInstance}/${projectPath}`,
                            documentationUrl: catalogComponent.documentation_url
                        };
                        this.logger.logPerformance('fetchComponentMetadata (catalog)', Date.now() - startTime);
                        return component;
                    }
                }
            }
            catch (catalogError) {
                this.logger.debug(`Could not fetch from catalog: ${catalogError}`);
            }
            // Fall back to API + repository approach with parallel requests
            const projectApiUrl = `${apiBaseUrl}/projects/${encodedProjectPath}`;
            this.logger.debug(`Fetching project info from: ${projectApiUrl}`);
            let token = await this.tokenManager.getTokenForProject(gitlabInstance, projectPath);
            let fetchOptions = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;
            this.logger.debug(`Using token for ${gitlabInstance}: ${token ? 'YES' : 'NO'}`);
            // Fetch project info and template in parallel
            let projectInfo;
            let templateResult;
            try {
                [projectInfo, templateResult] = await Promise.allSettled([
                    this.httpClient.fetchJson(projectApiUrl, fetchOptions),
                    this.fetchTemplate(apiBaseUrl, encodedProjectPath, componentName, version, fetchOptions)
                ]);
            }
            catch (err) {
                if (err && (err.status === 401 || err.status === 403)) {
                    // Prompt for token and retry
                    token = await promptForTokenIfNeeded(context, this.tokenManager, gitlabInstance, projectPath);
                    if (token) {
                        fetchOptions = { headers: { 'PRIVATE-TOKEN': token } };
                        [projectInfo, templateResult] = await Promise.allSettled([
                            this.httpClient.fetchJson(projectApiUrl, fetchOptions),
                            this.fetchTemplate(apiBaseUrl, encodedProjectPath, componentName, version, fetchOptions)
                        ]);
                    }
                    else {
                        throw err;
                    }
                }
                else {
                    throw err;
                }
            }
            if (projectInfo.status === 'rejected') {
                throw new Error(`Failed to fetch project info: ${projectInfo.reason}`);
            }
            const project = projectInfo.value;
            // Process template result
            if (templateResult.status === 'fulfilled' && templateResult.value) {
                const { content, parameters: extractedParams } = templateResult.value;
                templateContent = content;
                parameters = extractedParams;
                this.logger.debug(`Found component template with ${parameters.length} parameters`);
            }
            // Build component description with proper fallbacks
            let cleanDescription = '';
            if (project.description && project.description.trim()) {
                cleanDescription = project.description.trim();
            }
            else {
                cleanDescription = `Component/Project does not have a description`;
            }
            // Construct the component
            const component = {
                name: componentName,
                description: cleanDescription,
                parameters,
                version,
                source: `${gitlabInstance}/${projectPath}`
            };
            this.logger.logPerformance('fetchComponentMetadata (full)', Date.now() - startTime, {
                hasTemplate: !!templateContent,
                paramCount: parameters.length
            });
            return component;
        }
        catch (error) {
            this.logger.error(`Error fetching component metadata: ${error}`);
            // Still provide a minimal component rather than failing
            const urlParts = url.split('/');
            const lastPart = urlParts[urlParts.length - 1];
            const componentName = lastPart.includes('@') ? lastPart.split('@')[0] : lastPart;
            return {
                name: componentName,
                description: `Component from ${url}\n\nCould not fetch detailed information: ${error}`,
                parameters: []
            };
        }
    }
    /**
     * Helper method for parallel template fetching
     */
    async fetchTemplate(apiBaseUrl, projectId, componentName, version, fetchOptions) {
        try {
            const templatePathCandidates = [
                `templates/${componentName}.yml`,
                `templates/${componentName}.yaml`,
                `templates/${componentName}/template.yml`,
                `templates/${componentName}/template.yaml`
            ];
            let templateContent = null;
            let resolvedTemplatePath = '';
            for (const templatePath of templatePathCandidates) {
                const templateUrl = `${apiBaseUrl}/projects/${projectId}/repository/files/${encodeURIComponent(templatePath)}/raw?ref=${version}`;
                this.logger.debug(`[ComponentFetcher] Trying template path: ${templatePath}`);
                try {
                    templateContent = await this.httpClient.fetchText(templateUrl, fetchOptions);
                    resolvedTemplatePath = templatePath;
                    break;
                }
                catch {
                    // try next candidate
                }
            }
            if (!templateContent) {
                this.logger.debug(`[ComponentFetcher] No template found for ${componentName} at known paths`);
                return null;
            }
            this.logger.debug(`[ComponentFetcher] Template content received from ${resolvedTemplatePath}, length: ${templateContent.length} chars`);
            // Use unified parser to extract parameters
            const parsedSpec = specParser_1.GitLabSpecParser.parse(templateContent, componentName);
            this.logger.debug(`[ComponentFetcher] Template ${componentName}: Extracted ${parsedSpec.variables.length} parameters`);
            parsedSpec.variables.forEach((param) => {
                this.logger.debug(`[ComponentFetcher] Template ${componentName}: Parameter: ${param.name} (${param.type}, required: ${param.required})`);
            });
            return { content: templateContent, parameters: parsedSpec.variables };
        }
        catch (error) {
            this.logger.debug(`Could not fetch component template: ${error}`);
            return null;
        }
    }
    /**
     * Fetch component catalog data from GitLab with optimizations
     */
    async fetchCatalogData(gitlabInstance, projectPath, forceRefresh = false, version, context) {
        const startTime = Date.now();
        const versionSuffix = version ? `@${version}` : '';
        const cacheKey = `catalog:${gitlabInstance}:${projectPath}${versionSuffix}`;
        this.logger.info(`fetchCatalogData called for ${gitlabInstance}/${projectPath}${versionSuffix}`);
        this.logger.debug(`Force refresh: ${forceRefresh}`);
        // Clean up GitLab instance URL if it contains protocol
        const cleanGitlabInstance = this.urlParser.cleanGitLabInstance(gitlabInstance);
        // Check cache first
        if (!forceRefresh && this.catalogCache.has(cacheKey)) {
            this.logger.info(`Returning cached catalog data for ${cacheKey}`);
            this.logger.logPerformance('fetchCatalogData (cached)', Date.now() - startTime);
            return this.catalogCache.get(cacheKey);
        }
        this.logger.info(`Fetching fresh catalog data from ${cleanGitlabInstance}`);
        try {
            const apiBaseUrl = `https://${cleanGitlabInstance}/api/v4`;
            let ref = version || 'main';
            let token = await this.tokenManager.getTokenForProject(cleanGitlabInstance, projectPath);
            let fetchOptions = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;
            // **PARALLEL OPTIMIZATION with GRACEFUL DEGRADATION** - Fetch project info and templates in parallel
            const [projectInfoResult, templatesResult] = await Promise.allSettled([
                this.httpClient.fetchJson(`${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}`, fetchOptions),
                this.httpClient.fetchJson(`${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}/repository/tree?path=templates&ref=${ref}`, fetchOptions)
            ]);
            let projectInfo;
            let templates;
            // Handle authentication errors and retry if needed
            if (projectInfoResult.status === 'rejected') {
                const err = projectInfoResult.reason;
                if (err && (err.status === 401 || err.status === 403)) {
                    // Prompt for token and retry
                    token = await promptForTokenIfNeeded(context, this.tokenManager, cleanGitlabInstance, projectPath);
                    if (token) {
                        fetchOptions = { headers: { 'PRIVATE-TOKEN': token } };
                        const [retryProjectInfo, retryTemplates] = await Promise.allSettled([
                            this.httpClient.fetchJson(`${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}`, fetchOptions),
                            this.httpClient.fetchJson(`${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}/repository/tree?path=templates&ref=${ref}`, fetchOptions)
                        ]);
                        if (retryProjectInfo.status === 'rejected') {
                            throw retryProjectInfo.reason;
                        }
                        projectInfo = retryProjectInfo.value;
                        templates = retryTemplates.status === 'fulfilled' ? retryTemplates.value : [];
                    }
                    else {
                        throw err;
                    }
                }
                else {
                    throw err;
                }
            }
            else {
                projectInfo = projectInfoResult.value;
                templates = templatesResult.status === 'fulfilled' ? templatesResult.value : [];
            }
            // Use the project's default branch if available
            if (projectInfo && projectInfo.default_branch) {
                ref = projectInfo.default_branch;
            }
            this.logger.debug(`Found project: ${projectInfo.name} (ID: ${projectInfo.id}), using ref: ${ref}`);
            // Re-fetch templates with correct ref and include one subdirectory level.
            const yamlFiles = await this.fetchAllTemplateFiles(apiBaseUrl, projectPath, ref, fetchOptions);
            this.logger.debug(`Found ${yamlFiles.length} YAML template files`);
            if (yamlFiles.length === 0) {
                this.logger.info(`No YAML templates found in ${projectPath}`);
                const catalogData = { components: [] };
                this.catalogCache.set(cacheKey, catalogData);
                return catalogData;
            }
            // Process components in batches
            const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
            const batchSize = config.get('batchSize', 5);
            const componentResults = await this.httpClient.processBatch(yamlFiles, async (file) => {
                const relativePath = file.path.replace(/^templates\//, '');
                const name = relativePath.includes('/')
                    ? relativePath.split('/')[0]
                    : relativePath.replace(/\.ya?ml$/, '');
                this.logger.debug(`Processing component: ${name} (${relativePath})`);
                // Fetch template content
                const templateResult = await this.fetchTemplateContent(apiBaseUrl, projectInfo.id, relativePath, ref, fetchOptions);
                let description = '';
                let variables = [];
                // Process template content - skip files that don't have a spec section
                if (templateResult) {
                    const { extractedVariables, extractedDescription, isValidComponent } = templateResult;
                    // Skip non-component templates
                    if (!isValidComponent) {
                        this.logger.debug(`[ComponentFetcher] Skipping ${name}: not a valid GitLab CI/CD component (no spec section)`);
                        return null;
                    }
                    variables = extractedVariables;
                    description = extractedDescription || `${name} component`;
                }
                else {
                    // If we couldn't fetch the template, skip it
                    this.logger.debug(`[ComponentFetcher] Skipping ${name}: could not fetch template content`);
                    return null;
                }
                return {
                    name,
                    description,
                    variables,
                    latest_version: ref
                };
            }, batchSize);
            // Filter out null results (non-component templates)
            const components = componentResults.filter((c) => c !== null);
            this.logger.debug(`[ComponentFetcher] ${components.length} of ${yamlFiles.length} templates are valid components`);
            const catalogData = { components };
            // Cache the result
            this.catalogCache.set(cacheKey, catalogData);
            this.logger.info(`Successfully processed ${components.length} components`);
            this.logger.logPerformance('fetchCatalogData (fresh)', Date.now() - startTime, {
                componentCount: components.length,
                batchSize,
                projectPath
            });
            return catalogData;
        }
        catch (error) {
            this.logger.error(`Error fetching catalog data for ${projectPath}: ${error}`);
            throw error;
        }
    }
    /**
     * Fetch YAML template files from templates/ including one nested directory level.
     */
    async fetchAllTemplateFiles(apiBaseUrl, projectPath, ref, fetchOptions) {
        const treeUrl = `${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}/repository/tree?path=templates&ref=${ref}`;
        const topLevel = await this.httpClient.fetchJson(treeUrl, fetchOptions).catch(() => []);
        const yamlFiles = topLevel.filter((item) => item.type === 'blob' && (item.name.endsWith('.yml') || item.name.endsWith('.yaml')));
        const subdirs = topLevel.filter((item) => item.type === 'tree');
        for (const subdir of subdirs) {
            const subdirUrl = `${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}/repository/tree?path=${encodeURIComponent('templates/' + subdir.name)}&ref=${ref}`;
            const subdirContents = await this.httpClient.fetchJson(subdirUrl, fetchOptions).catch(() => []);
            const subdirYaml = subdirContents.filter((item) => item.type === 'blob' && (item.name.endsWith('.yml') || item.name.endsWith('.yaml')));
            yamlFiles.push(...subdirYaml);
        }
        return yamlFiles;
    }
    /**
     * Helper method for parallel template content fetching
     */
    async fetchTemplateContent(apiBaseUrl, projectId, relativePath, ref, fetchOptions) {
        try {
            const contentUrl = `${apiBaseUrl}/projects/${projectId}/repository/files/${encodeURIComponent('templates/' + relativePath)}/raw?ref=${ref}`;
            const content = await this.httpClient.fetchText(contentUrl, fetchOptions);
            // Use unified parser to extract spec information
            const parsedSpec = specParser_1.GitLabSpecParser.parse(content, relativePath);
            return {
                content,
                extractedVariables: parsedSpec.variables,
                extractedDescription: parsedSpec.description,
                isValidComponent: parsedSpec.isValidComponent
            };
        }
        catch (error) {
            this.logger.debug(`Could not fetch template content: ${error}`);
            return null;
        }
    }
    /**
     * Fetch project information from GitLab API
     */
    async fetchProjectInfo(gitlabInstance, projectPath) {
        const apiBaseUrl = `https://${gitlabInstance}/api/v4`;
        const token = await this.tokenManager.getTokenForProject(gitlabInstance, projectPath);
        const fetchOptions = token ? { headers: { 'PRIVATE-TOKEN': token } } : undefined;
        return this.httpClient.fetchJson(`${apiBaseUrl}/projects/${encodeURIComponent(projectPath)}`, fetchOptions);
    }
    /**
     * Clear the catalog cache
     */
    clearCache() {
        this.catalogCache.clear();
    }
    /**
     * Get catalog cache statistics
     */
    getCatalogCacheStats() {
        return {
            size: this.catalogCache.size,
            keys: Array.from(this.catalogCache.keys())
        };
    }
}
exports.ComponentFetcher = ComponentFetcher;
//# sourceMappingURL=componentFetcher.js.map