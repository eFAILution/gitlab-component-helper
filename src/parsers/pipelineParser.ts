import { parseYaml } from '../utils/yamlParser';
import { getComponentService } from '../services/component/componentService';
import { getComponentCacheManager } from '../services/cache/componentCacheManager';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { expandComponentUrl, expandGitLabVariables } from '../utils/gitlabVariables';

export interface PipelineJob {
    name: string;
    stage: string;
    source: string;
}

export interface PipelineStage {
    name: string;
    jobs: PipelineJob[];
    isImplicit: boolean;
}

export interface PipelineGraph {
    stages: PipelineStage[];
    includedSources: string[];
    errors: string[];
}

const DEFAULT_STAGES = ['.pre', 'build', 'test', 'deploy', '.post'];
const RESERVED_KEYWORDS = new Set([
    'image', 'services', 'stages', 'types', 'before_script', 'after_script',
    'variables', 'cache', 'include', 'pages', 'workflow', 'default', 'spec'
]);

export class PipelineParser {
    private maxDepth: number;
    private visitedSources = new Set<string>();
    private allJobs: PipelineJob[] = [];
    private customStages: string[] = [];
    private includedSources: string[] = [];
    private errors: string[] = [];

    constructor(maxDepth: number = 10) {
        this.maxDepth = maxDepth;
    }

    public async parse(content: string, sourceName: string, context?: any): Promise<PipelineGraph> {
        this.visitedSources.clear();
        this.allJobs = [];
        this.customStages = [];
        this.includedSources = [sourceName];
        this.errors = [];

        await this.parseRecursive(content, sourceName, 0, context);

        return this.buildGraph();
    }

    private async parseRecursive(content: string, sourceName: string, depth: number, context?: any, componentOrigin?: { gitlabInstance: string; projectPath: string; ref: string }) {
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

        const parsed = parseYaml(ciContent);
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
                await this.resolveInclude(inc, sourceName, depth + 1, context, componentOrigin);
            }
        }
    }

    private async resolveInclude(inc: any, currentSource: string, depth: number, context?: any, componentOrigin?: { gitlabInstance: string; projectPath: string; ref: string }) {
        if (!inc) return;

        let targetUrl = '';
        let targetName = '';

        try {
            if (typeof inc === 'string') {
                // simple local include or remote?
                if (inc.startsWith('http')) {
                    targetUrl = inc;
                    targetName = inc;
                } else {
                    await this.resolveLocalInclude(inc, currentSource, depth, context, componentOrigin);
                    return;
                }
            } else if (inc.local) {
                await this.resolveLocalInclude(inc.local, currentSource, depth, context, componentOrigin);
                return;
            } else if (inc.component) {
                // Component include
                // e.g., gitlab.com/my-group/my-project/my-component@1.0.0
                let componentUrl = inc.component;
                
                // Expand variables like $CI_SERVER_FQDN
                componentUrl = expandComponentUrl(componentUrl, {
                    gitlabInstance: context?.gitlabInstance || 'gitlab.com',
                    serverUrl: context?.serverUrl,
                    projectPath: context?.projectPath,
                    customVariables: context?.customVariables
                });
                // Strip protocol because logic expects domain/path
                componentUrl = componentUrl.replace(/^https?:\/\//, '');

                targetName = `component:${componentUrl}`;
                
                // Parse component URL to fetch the raw template
                const componentService = getComponentService();
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
                const cacheManager = getComponentCacheManager();
                
                for (const templatePath of combinations) {
                    try {
                        const content = await cacheManager.fetchAndCacheRawTemplate(parsedUrl.gitlabInstance, parsedUrl.path, templatePath, version);
                        if (content && typeof content === 'string' && !content.includes('{"message":"404 Project Not Found"}')) {
                            this.includedSources.push(targetName);
                            // Pass the component's origin so local: includes inside the template resolve via GitLab API
                            const origin: { gitlabInstance: string; projectPath: string; ref: string } = {
                                gitlabInstance: parsedUrl.gitlabInstance,
                                projectPath: parsedUrl.path,
                                ref: version
                            };
                            await this.parseRecursive(content, targetName, depth, context, origin);
                            fetched = true;
                            break;
                        }
                    } catch (e) {
                        // Continue trying next combination
                    }
                }
                
                if (!fetched) {
                    this.errors.push(`Could not fetch component ${componentUrl}`);
                }
                return;
            } else if (inc.project && inc.file) {
                // Project include
                let projectPath = inc.project;
                projectPath = expandGitLabVariables(projectPath, {
                    gitlabInstance: context?.gitlabInstance || 'gitlab.com',
                    projectPath: context?.projectPath,
                    customVariables: context?.customVariables
                });
                
                const files = Array.isArray(inc.file) ? inc.file : [inc.file];
                const gitlabInstance = context?.gitlabInstance || 'gitlab.com';
                const componentService = getComponentService();
                
                for (const file of files) {
                    let expandedFile = expandGitLabVariables(typeof file === 'string' ? file : String(file), {
                        gitlabInstance: context?.gitlabInstance || 'gitlab.com',
                        projectPath: context?.projectPath,
                        customVariables: context?.customVariables
                    });
                    
                    targetName = `project:${projectPath}:${expandedFile}`;
                    const ref = inc.ref || 'HEAD';
                    const cleanFile = expandedFile.replace(/^\//, '');
                    
                    try {
                        const cacheManager = getComponentCacheManager();
                        const content = await cacheManager.fetchAndCacheRawTemplate(gitlabInstance, projectPath, cleanFile, ref);
                        if (content && typeof content === 'string' && !content.includes('{"message":"404 Project Not Found"}')) {
                            if (!this.includedSources.includes(targetName)) {
                                this.includedSources.push(targetName);
                            }
                            // Pass the project origin so local: includes inside this file resolve via GitLab API
                            const origin: { gitlabInstance: string; projectPath: string; ref: string } = { gitlabInstance, projectPath, ref };
                            await this.parseRecursive(content, targetName, depth, context, origin);
                        } else {
                            this.errors.push(`Could not fetch project file ${inc.project}/${file}`);
                        }
                    } catch (e) {
                        this.errors.push(`Failed to fetch project file ${inc.project}/${file}: ${e}`);
                    }
                }
                return;
            } else if (inc.remote) {
                // Remote include
                let remoteUrl = inc.remote;
                remoteUrl = expandGitLabVariables(remoteUrl, {
                    gitlabInstance: context?.gitlabInstance || 'gitlab.com',
                    serverUrl: context?.serverUrl,
                    projectPath: context?.projectPath,
                    customVariables: context?.customVariables
                });
                targetUrl = remoteUrl;
                targetName = `remote:${remoteUrl}`;
            } else {
                return;
            }

            if (targetUrl) {
                if (!this.includedSources.includes(targetName)) {
                    this.includedSources.push(targetName);
                }
                const service = getComponentService();
                const content = await service.httpClient.fetchText(targetUrl);
                if (content) {
                    await this.parseRecursive(content, targetName, depth, context);
                }
            }
        } catch (e) {
            this.errors.push(`Failed to resolve include ${targetName}: ${e}`);
        }
    }

    private async resolveLocalInclude(inc: string, currentSource: string, depth: number, context?: any, componentOrigin?: { gitlabInstance: string; projectPath: string; ref: string }) {
        try {
            // If we're inside a fetched component/project template, resolve local: via GitLab API
            if (componentOrigin) {
                const cleanPath = inc.replace(/^\//, '');
                const targetName = `local:${inc}`;
                if (!this.includedSources.includes(targetName)) {
                    this.includedSources.push(targetName);
                }
                const cacheManager = getComponentCacheManager();
                const content = await cacheManager.fetchAndCacheRawTemplate(
                    componentOrigin.gitlabInstance,
                    componentOrigin.projectPath,
                    cleanPath,
                    componentOrigin.ref
                );
                if (content && typeof content === 'string' && !content.includes('{"message":"404 Project Not Found"}')) {
                    await this.parseRecursive(content, targetName, depth, context, componentOrigin);
                } else {
                    this.errors.push(`Could not fetch local file ${inc} from ${componentOrigin.projectPath}`);
                }
                return;
            }

            // Otherwise resolve relative to the workspace root (GitLab CI semantics: local: is always repo-root-relative)
            if (path.isAbsolute(currentSource)) {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) {
                    this.errors.push(`Cannot resolve local file ${inc}: no workspace open.`);
                    return;
                }

                // GitLab resolves local: paths from the repo root, not from the including file's directory
                const repoRoot = workspaceFolders[0].uri.fsPath;
                const cleanInc = inc.startsWith('/') ? inc.substring(1) : inc;
                const localPath = path.join(repoRoot, cleanInc);

                const isInsideWorkspace = workspaceFolders.some(f => {
                    const relative = path.relative(f.uri.fsPath, localPath);
                    return !relative.startsWith('..') && !path.isAbsolute(relative);
                });
                if (!isInsideWorkspace) {
                    this.errors.push(`Access denied: local include ${inc} resolves outside the workspace boundaries.`);
                    return;
                }
                
                const localContent = await fs.promises.readFile(localPath, 'utf8');
                const targetName = `local:${inc}`;
                this.includedSources.push(targetName);
                await this.parseRecursive(localContent, localPath, depth, context);
            } else {
                this.errors.push(`Cannot resolve local file ${inc} because current source is not a local file.`);
            }
        } catch (err) {
            this.errors.push(`Failed to read local file ${inc}`);
        }
    }

    private buildGraph(): PipelineGraph {
        // Build final list of stages. If customStages is empty, use DEFAULT_STAGES
        // Actually, GitLab merges custom stages with .pre and .post.
        const finalStages: PipelineStage[] = [];
        
        let orderedStages = [...this.customStages];
        if (orderedStages.length === 0) {
            orderedStages = [...DEFAULT_STAGES];
        } else {
            if (!orderedStages.includes('.pre')) orderedStages.unshift('.pre');
            if (!orderedStages.includes('.post')) orderedStages.push('.post');
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
