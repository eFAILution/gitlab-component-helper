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
exports.PipelineParser = void 0;
const yamlParser_1 = require("../utils/yamlParser");
const componentService_1 = require("../services/component/componentService");
const componentCacheManager_1 = require("../services/cache/componentCacheManager");
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const gitlabVariables_1 = require("../utils/gitlabVariables");
const DEFAULT_STAGES = ['.pre', 'build', 'test', 'deploy', '.post'];
const RESERVED_KEYWORDS = new Set([
    'image', 'services', 'stages', 'types', 'before_script', 'after_script',
    'variables', 'cache', 'include', 'pages', 'workflow', 'default', 'spec'
]);
class PipelineParser {
    constructor(maxDepth = 10) {
        this.visitedSources = new Set();
        this.allJobs = [];
        this.customStages = [];
        this.includedSources = [];
        this.errors = [];
        this.maxDepth = maxDepth;
    }
    async parse(content, sourceName, context) {
        this.visitedSources.clear();
        this.allJobs = [];
        this.customStages = [];
        this.includedSources = [sourceName];
        this.errors = [];
        await this.parseRecursive(content, sourceName, 0, context);
        return this.buildGraph();
    }
    async parseRecursive(content, sourceName, depth, context) {
        if (depth >= this.maxDepth) {
            this.errors.push(`Max recursion depth (${this.maxDepth}) reached at ${sourceName}`);
            return;
        }
        if (this.visitedSources.has(sourceName)) {
            // Circular dependency or already visited
            return;
        }
        this.visitedSources.add(sourceName);
        // Strip out the `spec:` block and split by --- to handle components
        const parts = content.split(/^---\s*$/m);
        let ciContent = content;
        if (parts.length > 1) {
            // Usually spec is before ---, and jobs are after.
            ciContent = parts.slice(1).join('\n');
        }
        const parsed = (0, yamlParser_1.parseYaml)(ciContent);
        if (!parsed || typeof parsed !== 'object') {
            this.errors.push(`Failed to parse YAML for ${sourceName}`);
            return;
        }
        // 1. Extract stages
        if (parsed.stages && Array.isArray(parsed.stages)) {
            for (const stage of parsed.stages) {
                if (!this.customStages.includes(stage)) {
                    this.customStages.push(stage);
                }
            }
        }
        // 2. Extract jobs
        for (const key of Object.keys(parsed)) {
            if (RESERVED_KEYWORDS.has(key) || key.startsWith('.')) {
                // Skip reserved keywords and hidden jobs/anchors
                continue;
            }
            const jobObj = parsed[key];
            if (jobObj && typeof jobObj === 'object') {
                const stage = jobObj.stage || 'test'; // default stage is test in GitLab CI
                this.allJobs.push({
                    name: key,
                    stage: stage,
                    source: sourceName
                });
            }
        }
        // 3. Extract includes
        if (parsed.include) {
            const includes = Array.isArray(parsed.include) ? parsed.include : [parsed.include];
            for (const inc of includes) {
                await this.resolveInclude(inc, sourceName, depth + 1, context);
            }
        }
    }
    async resolveInclude(inc, currentSource, depth, context) {
        if (!inc)
            return;
        let targetUrl = '';
        let targetName = '';
        try {
            if (typeof inc === 'string') {
                // simple local include or remote?
                if (inc.startsWith('http')) {
                    targetUrl = inc;
                    targetName = inc;
                }
                else {
                    await this.resolveLocalInclude(inc, currentSource, depth, context);
                    return;
                }
            }
            else if (inc.local) {
                await this.resolveLocalInclude(inc.local, currentSource, depth, context);
                return;
            }
            else if (inc.component) {
                // Component include
                // e.g., gitlab.com/my-group/my-project/my-component@1.0.0
                let componentUrl = inc.component;
                // Expand variables like $CI_SERVER_FQDN
                componentUrl = (0, gitlabVariables_1.expandComponentUrl)(componentUrl, {
                    gitlabInstance: context?.gitlabInstance || 'gitlab.com',
                    serverUrl: context?.serverUrl,
                    projectPath: context?.projectPath,
                    customVariables: context?.customVariables
                });
                // Strip protocol because logic expects domain/path
                componentUrl = componentUrl.replace(/^https?:\/\//, '');
                targetName = `component:${componentUrl}`;
                // Parse component URL to fetch the raw template
                const componentService = (0, componentService_1.getComponentService)();
                const parsedUrl = componentService.parseCustomComponentUrl(`https://${componentUrl}`);
                if (!parsedUrl) {
                    this.errors.push(`Could not parse component URL ${componentUrl}`);
                    return;
                }
                let version = parsedUrl.version || 'main';
                if (version === '[current-branch-or-sha]') {
                    version = 'HEAD';
                    this.errors.push(`Replaced missing variable $CI_COMMIT_SHA with HEAD for component ${inc.component}. <a href="command:workbench.action.openSettings?%22gitlabComponentHelper.customVariables%22">Click here to set custom variables</a>`);
                }
                const combinations = [
                    `templates/${parsedUrl.name}/template.yml`,
                    `templates/${parsedUrl.name}.yml`,
                    `templates/template.yml`
                ];
                let fetched = false;
                const cacheManager = (0, componentCacheManager_1.getComponentCacheManager)();
                for (const templatePath of combinations) {
                    try {
                        const content = await cacheManager.fetchAndCacheRawTemplate(parsedUrl.gitlabInstance, parsedUrl.path, templatePath, version);
                        if (content && typeof content === 'string' && !content.includes('{"message":"404 Project Not Found"}')) {
                            this.includedSources.push(targetName);
                            await this.parseRecursive(content, targetName, depth, context);
                            fetched = true;
                            break;
                        }
                    }
                    catch (e) {
                        // Continue trying next combination
                    }
                }
                if (!fetched) {
                    this.errors.push(`Could not fetch component ${componentUrl}`);
                }
                return;
            }
            else if (inc.project && inc.file) {
                // Project include
                let projectPath = inc.project;
                projectPath = (0, gitlabVariables_1.expandGitLabVariables)(projectPath, {
                    gitlabInstance: context?.gitlabInstance || 'gitlab.com',
                    projectPath: context?.projectPath,
                    customVariables: context?.customVariables
                });
                const files = Array.isArray(inc.file) ? inc.file : [inc.file];
                const gitlabInstance = context?.gitlabInstance || 'gitlab.com';
                const componentService = (0, componentService_1.getComponentService)();
                for (const file of files) {
                    let expandedFile = (0, gitlabVariables_1.expandGitLabVariables)(typeof file === 'string' ? file : String(file), {
                        gitlabInstance: context?.gitlabInstance || 'gitlab.com',
                        projectPath: context?.projectPath,
                        customVariables: context?.customVariables
                    });
                    targetName = `project:${projectPath}:${expandedFile}`;
                    const ref = inc.ref || 'HEAD';
                    const cleanFile = expandedFile.replace(/^\//, '');
                    try {
                        const cacheManager = (0, componentCacheManager_1.getComponentCacheManager)();
                        const content = await cacheManager.fetchAndCacheRawTemplate(gitlabInstance, projectPath, cleanFile, ref);
                        if (content && typeof content === 'string' && !content.includes('{"message":"404 Project Not Found"}')) {
                            if (!this.includedSources.includes(targetName)) {
                                this.includedSources.push(targetName);
                            }
                            await this.parseRecursive(content, targetName, depth, context);
                        }
                        else {
                            this.errors.push(`Could not fetch project file ${inc.project}/${file}`);
                        }
                    }
                    catch (e) {
                        this.errors.push(`Failed to fetch project file ${inc.project}/${file}: ${e}`);
                    }
                }
                return;
            }
            else if (inc.remote) {
                // Remote include
                let remoteUrl = inc.remote;
                remoteUrl = (0, gitlabVariables_1.expandGitLabVariables)(remoteUrl, {
                    gitlabInstance: context?.gitlabInstance || 'gitlab.com',
                    serverUrl: context?.serverUrl,
                    projectPath: context?.projectPath,
                    customVariables: context?.customVariables
                });
                targetUrl = remoteUrl;
                targetName = `remote:${remoteUrl}`;
            }
            else {
                return;
            }
            if (targetUrl) {
                if (!this.includedSources.includes(targetName)) {
                    this.includedSources.push(targetName);
                }
                const service = (0, componentService_1.getComponentService)();
                const content = await service.httpClient.fetchText(targetUrl);
                if (content) {
                    await this.parseRecursive(content, targetName, depth, context);
                }
            }
        }
        catch (e) {
            this.errors.push(`Failed to resolve include ${targetName}: ${e}`);
        }
    }
    async resolveLocalInclude(inc, currentSource, depth, context) {
        try {
            if (path.isAbsolute(currentSource)) {
                const dir = path.dirname(currentSource);
                const localPath = inc.startsWith('/') ? path.join(dir, inc.substring(1)) : path.resolve(dir, inc);
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders) {
                    const isInsideWorkspace = workspaceFolders.some(f => {
                        const relative = path.relative(f.uri.fsPath, localPath);
                        return !relative.startsWith('..') && !path.isAbsolute(relative);
                    });
                    if (!isInsideWorkspace) {
                        this.errors.push(`Access denied: local include ${inc} resolves outside the workspace boundaries.`);
                        return;
                    }
                }
                const localContent = await fs.promises.readFile(localPath, 'utf8');
                const targetName = `local:${inc}`;
                this.includedSources.push(targetName);
                await this.parseRecursive(localContent, localPath, depth, context);
            }
            else {
                this.errors.push(`Cannot resolve local file ${inc} because current source is not a local file.`);
            }
        }
        catch (err) {
            this.errors.push(`Failed to read local file ${inc}`);
        }
    }
    buildGraph() {
        // Build final list of stages. If customStages is empty, use DEFAULT_STAGES
        // Actually, GitLab merges custom stages with .pre and .post.
        const finalStages = [];
        let orderedStages = [...this.customStages];
        if (orderedStages.length === 0) {
            orderedStages = [...DEFAULT_STAGES];
        }
        else {
            if (!orderedStages.includes('.pre'))
                orderedStages.unshift('.pre');
            if (!orderedStages.includes('.post'))
                orderedStages.push('.post');
        }
        // Ensure all jobs have their stages created, even if they defined a stage that isn't in `stages`
        const jobStages = new Set(this.allJobs.map(j => j.stage));
        for (const s of jobStages) {
            if (!orderedStages.includes(s)) {
                orderedStages.push(s);
            }
        }
        for (const stageName of orderedStages) {
            const jobsInStage = this.allJobs.filter(j => j.stage === stageName);
            finalStages.push({
                name: stageName,
                jobs: jobsInStage,
                isImplicit: DEFAULT_STAGES.includes(stageName) && !this.customStages.includes(stageName)
            });
        }
        return {
            stages: finalStages,
            includedSources: this.includedSources,
            errors: this.errors
        };
    }
}
exports.PipelineParser = PipelineParser;
//# sourceMappingURL=pipelineParser.js.map