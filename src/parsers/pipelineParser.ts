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

export interface IncludeNode {
    name: string;
    children: IncludeNode[];
}

export interface PipelineGraph {
    stages: PipelineStage[];
    includedSources: string[];
    includeTree: IncludeNode;
    errors: string[];
}

export interface ComponentOrigin {
    gitlabInstance: string;
    projectPath: string;
    ref: string;
}

export interface ParserContext {
    gitlabInstance?: string;
    projectPath?: string;
    customVariables?: Record<string, string>;
    serverUrl?: string;
    [key: string]: any;
}

export interface IncludeDirective {
    local?: string;
    file?: string | string[];
    project?: string;
    ref?: string;
    remote?: string;
    component?: string;
    template?: string;
}

const DEFAULT_STAGES = ['.pre', 'build', 'test', 'deploy', '.post'];
const RESERVED_KEYWORDS = new Set([
    'image', 'services', 'stages', 'types', 'before_script', 'after_script',
    'variables', 'cache', 'include', 'pages', 'workflow', 'default', 'spec',
    'pipeline_execution_policy', 'content'
]);

export class PipelineParser {
    private maxDepth: number;
    private visitedSources = new Set<string>();
    private allJobs: PipelineJob[] = [];
    private customStages: string[] = [];
    private includedSources: string[] = [];
    private includeTree: IncludeNode = { name: 'root', children: [] };
    private errors: string[] = [];
    private allowedRoots: string[] | null = null;

    constructor(maxDepth: number = 10) {
        this.maxDepth = maxDepth;
    }

    public async parse(content: string, sourceName: string, context?: ParserContext, extraIncludes?: IncludeDirective[]): Promise<PipelineGraph> {
        this.visitedSources.clear();
        this.allJobs = [];
        this.customStages = [];
        this.includedSources = [sourceName];
        this.includeTree = { name: sourceName, children: [] };
        this.errors = [];
        this.allowedRoots = null; // Clear cached allowed roots for the new parsing run

        // Resolve any always-include entries first, before the main file.
        if (extraIncludes && extraIncludes.length > 0) {
            for (const inc of extraIncludes) {
                await this.resolveInclude(inc, sourceName, 1, this.includeTree, context);
            }
        }

        await this.parseRecursive(content, sourceName, 0, this.includeTree, context);

        return this.buildGraph();
    }

    private async parseRecursive(content: string, sourceName: string, depth: number, parentNode: IncludeNode, context?: ParserContext, componentOrigin?: ComponentOrigin) {
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
                await this.resolveInclude(inc, sourceName, depth + 1, parentNode, context, componentOrigin);
            }
        }

        // 4. Handle GitLab Pipeline Execution Policies (PEP).
        // A PEP file has a top-level `pipeline_execution_policy` array. Each entry
        // has a `pipeline` key which is an embedded CI document with its own
        // stages, jobs, and includes. We extract them all here so they appear in
        // the visualizer alongside the rest of the pipeline.
        if (parsed.pipeline_execution_policy && Array.isArray(parsed.pipeline_execution_policy)) {
            for (const policy of parsed.pipeline_execution_policy) {
                if (!policy) continue;

                // GitLab PEPs use 'content' for the embedded pipeline, but we support
                // 'pipeline' as a fallback (used in some documentation/earlier versions).
                const pipelineDoc = policy.content || policy.pipeline;
                if (!pipelineDoc || typeof pipelineDoc !== 'object') {
                    continue;
                }
                const policyLabel = policy.name
                    ? `PEP: ${policy.name} (${sourceName})`
                    : `PEP (${sourceName})`;

                // Register the policy so it appears in the "Included Sources" panel
                if (!this.includedSources.includes(policyLabel)) {
                    this.includedSources.push(policyLabel);
                }

                // Extract stages declared inside the policy pipeline
                if (pipelineDoc.stages && Array.isArray(pipelineDoc.stages)) {
                    for (const stage of pipelineDoc.stages) {
                        if (!this.customStages.includes(stage)) {
                            this.customStages.push(stage);
                        }
                    }
                }

                // Extract inline jobs from the policy pipeline
                for (const key of Object.keys(pipelineDoc)) {
                    if (RESERVED_KEYWORDS.has(key) || key.startsWith('.') || key === 'stages') {
                        continue;
                    }
                    const jobObj = pipelineDoc[key];
                    if (jobObj && typeof jobObj === 'object') {
                        const stage = jobObj.stage || 'test';
                        this.allJobs.push({ name: key, stage, source: policyLabel });
                    }
                }

                // Resolve includes declared inside the policy pipeline
                if (pipelineDoc.include) {
                    const pepIncludes = Array.isArray(pipelineDoc.include) ? pipelineDoc.include : [pipelineDoc.include];
                    for (const inc of pepIncludes) {
                        await this.resolveInclude(inc, sourceName, depth + 1, parentNode, context, componentOrigin);
                    }
                }
            }
        }
    }

    private async resolveInclude(inc: IncludeDirective | string, currentSource: string, depth: number, parentNode: IncludeNode, context?: ParserContext, componentOrigin?: ComponentOrigin) {
        if (!inc) return;

        let targetUrl = '';
        let targetName = '';

        try {
            if (typeof inc === 'string') {
                if (inc.startsWith('http')) {
                    targetUrl = inc;
                    targetName = inc;
                } else if (!path.isAbsolute(inc) && inc.includes('@')) {
                    // String shorthand for component: 'group/project/component@1.0.0'
                    inc = { component: inc };
                } else if (!path.isAbsolute(inc) && inc.includes(':')) {
                    // String shorthand for project: 'group/project:file.yml'
                    const [project, file] = inc.split(':');
                    inc = { project, file };
                } else {
                    await this.resolveLocalInclude(inc, currentSource, depth, parentNode, context, componentOrigin);
                    return;
                }
            }

            const directive = inc as IncludeDirective;

            if (directive.local) {
                // Local include
                await this.resolveLocalInclude(directive.local, currentSource, depth, parentNode, context, componentOrigin);
                return;
            } else if (directive.component) {
                // Component include
                // e.g., gitlab.com/my-group/my-project/my-component@1.0.0
                let componentUrl = directive.component;

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
                    this.errors.push(`Replaced missing variable $CI_COMMIT_SHA with HEAD for component ${directive.component}. Click here to set custom variables [action:openCustomVariables]`);
                }

                const combinations = [
                    `templates/${parsedUrl.name}/template.yml`,
                    `templates/${parsedUrl.name}.yml`,
                    `templates/template.yml`
                ];

                // Local Redirect: If this component is in the current project, try resolving locally first.
                // We also try this if the parent file is local (no componentOrigin) to allow local experimentation.
                const normalizedParsedPath = parsedUrl.path.toLowerCase().replace(/\.git$/, '').replace(/^\//, '').replace(/\/$/, '');
                const normalizedContextPath = context?.projectPath?.toLowerCase().replace(/\.git$/, '').replace(/^\//, '').replace(/\/$/, '');

                const isCurrentProject = context?.projectPath && normalizedParsedPath === normalizedContextPath &&
                    parsedUrl.gitlabInstance.toLowerCase() === (context.gitlabInstance || 'gitlab.com').toLowerCase();

                if (isCurrentProject || !componentOrigin) {
                    for (const templatePath of combinations) {
                        const resolved = await this.tryResolveLocal(templatePath, currentSource, context);
                        if (resolved) {
                            if (!this.includedSources.includes(resolved.path)) {
                                this.includedSources.push(resolved.path);
                            }
                            const node = { name: resolved.path, children: [] };
                            parentNode.children.push(node);
                            await this.parseRecursive(resolved.content, resolved.path, depth, node, context);
                            return;
                        }
                    }
                }

                let fetched = false;
                const cacheManager = getComponentCacheManager();

                for (const templatePath of combinations) {
                    try {
                        const content = await cacheManager.fetchAndCacheRawTemplate(parsedUrl.gitlabInstance, parsedUrl.path, templatePath, version);
                        if (content && typeof content === 'string') {
                            this.includedSources.push(targetName);
                            const origin: ComponentOrigin = {
                                gitlabInstance: parsedUrl.gitlabInstance,
                                projectPath: parsedUrl.path,
                                ref: version
                            };
                            const node = { name: targetName, children: [] };
                            parentNode.children.push(node);
                            await this.parseRecursive(content, targetName, depth, node, context, origin);
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
            } else if (directive.project && directive.file) {
                // Project include
                let projectPath = directive.project;
                projectPath = expandGitLabVariables(projectPath, {
                    gitlabInstance: context?.gitlabInstance || 'gitlab.com',
                    projectPath: context?.projectPath,
                    customVariables: context?.customVariables
                });

                const files = Array.isArray(directive.file) ? directive.file : [directive.file];
                const gitlabInstance = context?.gitlabInstance || 'gitlab.com';
                const componentService = getComponentService();

                for (const file of files) {
                    let expandedFile = expandGitLabVariables(typeof file === 'string' ? file : String(file), {
                        gitlabInstance: context?.gitlabInstance || 'gitlab.com',
                        projectPath: context?.projectPath,
                        customVariables: context?.customVariables
                    });

                    targetName = `project:${projectPath}:${expandedFile}`;
                    const ref = directive.ref || 'HEAD';
                    const cleanFile = expandedFile.replace(/^\//, '');

                    // Local Redirect: If this project include is in the current project, try resolving locally first.
                    // We also try this if the parent file is local (no componentOrigin) to allow local experimentation.
                    const normalizedProjPath = projectPath.toLowerCase().replace(/\.git$/, '').replace(/^\//, '').replace(/\/$/, '');
                    const normalizedContextPath = context?.projectPath?.toLowerCase().replace(/\.git$/, '').replace(/^\//, '').replace(/\/$/, '');

                    const isCurrentProject = context?.projectPath && normalizedProjPath === normalizedContextPath &&
                        gitlabInstance.toLowerCase() === (context.gitlabInstance || 'gitlab.com').toLowerCase();

                    if (isCurrentProject || !componentOrigin) {
                        const resolved = await this.tryResolveLocal(cleanFile, currentSource, context);
                        if (resolved) {
                            if (!this.includedSources.includes(resolved.path)) {
                                this.includedSources.push(resolved.path);
                            }
                            const node = { name: resolved.path, children: [] };
                            parentNode.children.push(node);
                            await this.parseRecursive(resolved.content, resolved.path, depth, node, context);
                            continue; // Move to next file in directive.file array
                        }
                    }

                    try {
                        const cacheManager = getComponentCacheManager();
                        const content = await cacheManager.fetchAndCacheRawTemplate(gitlabInstance, projectPath, cleanFile, ref);
                        if (content && typeof content === 'string') {
                            if (!this.includedSources.includes(targetName)) {
                                this.includedSources.push(targetName);
                            }
                            // Pass the project origin so local: includes inside this file resolve via GitLab API
                            const origin: ComponentOrigin = { gitlabInstance, projectPath, ref };
                            const node = { name: targetName, children: [] };
                            parentNode.children.push(node);
                            await this.parseRecursive(content, targetName, depth, node, context, origin);
                        } else {
                            this.errors.push(`Could not fetch project file ${directive.project}/${file}`);
                        }
                    } catch (e) {
                        this.errors.push(`Failed to fetch project file ${directive.project}/${file}: ${this.formatError(e)}`);
                    }
                }
                return;
            } else if (directive.remote) {
                // Remote include
                let remoteUrl = directive.remote;
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
                    const node = { name: targetName, children: [] };
                    parentNode.children.push(node);
                    await this.parseRecursive(content, targetName, depth, node, context);
                }
            }
        } catch (e) {
            this.errors.push(`Failed to resolve include ${targetName}: ${this.formatError(e)}`);
        }
    }

    private formatError(e: unknown): string {
        return e instanceof Error ? e.message : String(e);
    }

    private getAllowedRoots(): string[] {
        if (this.allowedRoots !== null) {
            return this.allowedRoots;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
        const trustedRootsConfig = config.get<string | string[]>('trustedIncludeRoot', []);
        const extraRoots = Array.isArray(trustedRootsConfig) ? trustedRootsConfig : [trustedRootsConfig];

        this.allowedRoots = [
            ...(workspaceFolders?.map(f => f.uri.fsPath) || []),
            ...extraRoots.filter(r => r && typeof r === 'string').map(r => path.resolve(r))
        ];

        return this.allowedRoots;
    }

    private isPathAllowed(candidate: string): boolean {
        const allowed = this.getAllowedRoots();
        return allowed.some(root => {
            const relative = path.relative(root, candidate);
            return !relative.startsWith('..') && !path.isAbsolute(relative);
        });
    }

    /**
     * Helper to try resolving a path locally without side-effects (errors)
     */
    private async tryResolveLocal(inc: string, currentSource: string, context?: ParserContext): Promise<{ path: string, content: string } | undefined> {
        const cleanInc = inc.startsWith('/') ? inc.substring(1) : inc;
        const workspaceFolders = vscode.workspace.workspaceFolders;

        const candidates: string[] = [];
        // Absolute path
        if (path.isAbsolute(inc)) {
            candidates.push(path.normalize(inc));
        } else {
            // Workspace relative
            if (workspaceFolders && workspaceFolders.length > 0) {
                candidates.push(path.normalize(path.join(workspaceFolders[0].uri.fsPath, cleanInc)));
            }
            // currentSource relative
            if (path.isAbsolute(currentSource)) {
                candidates.push(path.normalize(path.join(path.dirname(currentSource), cleanInc)));
            }
        }

        for (const candidate of candidates) {
            try {
                // Resolve symlinks to prevent path traversal and local file inclusion
                let realCandidate = candidate;
                try {
                    realCandidate = await fs.promises.realpath(candidate);
                } catch {
                    // File may not exist yet, access checks below will handle it
                }

                if (!this.isPathAllowed(realCandidate)) {
                    continue;
                }

                await fs.promises.access(realCandidate, fs.constants.R_OK);
                const content = await fs.promises.readFile(realCandidate, 'utf8');
                return { path: realCandidate, content };
            } catch {
                continue;
            }
        }
        return undefined;
    }

    private async resolveLocalInclude(inc: string, currentSource: string, depth: number, parentNode: IncludeNode, context?: ParserContext, componentOrigin?: ComponentOrigin) {
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
                    const node = { name: targetName, children: [] };
                    parentNode.children.push(node);
                    await this.parseRecursive(content, targetName, depth, node, context, componentOrigin);
                } else {
                    this.errors.push(`Could not fetch local file ${inc} from ${componentOrigin.projectPath}`);
                }
                return;
            }

            const resolved = await this.tryResolveLocal(inc, currentSource, context);
            if (resolved) {
                if (!this.includedSources.includes(resolved.path)) {
                    this.includedSources.push(resolved.path);
                }
                const node = { name: resolved.path, children: [] };
                parentNode.children.push(node);
                await this.parseRecursive(resolved.content, resolved.path, depth, node, context);
            } else {
                this.errors.push(`Cannot find local file ${inc} (checked workspace root and relative to ${path.basename(currentSource)})`);
            }
        } catch (err) {
            this.errors.push(`Failed to read local file ${inc}: ${err instanceof Error ? err.message : String(err)}`);
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

        // Ensure all jobs have their stages created, even if they defined a stage that isn't in `stages`.
        // Insert before .post so .post always remains last, matching GitLab CI behaviour.
        const jobStages = new Set(this.allJobs.map(j => j.stage));
        const postIdx = orderedStages.indexOf('.post');
        for (const s of jobStages) {
            if (!orderedStages.includes(s)) {
                if (postIdx >= 0) {
                    orderedStages.splice(postIdx, 0, s);
                } else {
                    orderedStages.push(s);
                }
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
            includeTree: this.includeTree,
            errors: this.errors
        };
    }
}
