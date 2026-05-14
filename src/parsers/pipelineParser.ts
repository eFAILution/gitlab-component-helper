import { parseYaml } from '../utils/yamlParser';
import { getComponentService } from '../services/component/componentService';
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

    private async parseRecursive(content: string, sourceName: string, depth: number, context?: any) {
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
                await this.resolveInclude(inc, sourceName, depth + 1, context);
            }
        }
    }

    private async resolveInclude(inc: any, currentSource: string, depth: number, context?: any) {
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
                    await this.resolveLocalInclude(inc, currentSource, depth, context);
                    return;
                }
            } else if (inc.local) {
                await this.resolveLocalInclude(inc.local, currentSource, depth, context);
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
                const parts = componentUrl.split('/');
                const gitlabInstance = parts[0];
                const rest = parts.slice(1);
                
                let lastPart = rest[rest.length - 1];
                let version = 'main';
                if (lastPart.includes('@')) {
                    const split = lastPart.split('@');
                    lastPart = split[0];
                    version = split[1];
                    if (version === '[current-branch-or-sha]') {
                        version = 'HEAD';
                        this.errors.push(`Replaced missing variable $CI_COMMIT_SHA with HEAD for component ${inc.component}. <a href="command:workbench.action.openSettings?%22gitlabComponentHelper.customVariables%22">Click here to set custom variables</a>`);
                    }
                    rest[rest.length - 1] = lastPart;
                }
                
                const combinations = [];
                if (rest.length >= 2) {
                    // Try assuming the last part is the component sub-directory
                    const p1 = rest.slice(0, rest.length - 1).join('/');
                    const t1 = rest[rest.length - 1];
                    combinations.push({ proj: p1, temp: `templates/${t1}.yml` });
                    combinations.push({ proj: p1, temp: `templates/${t1}/template.yml` });
                    
                    // Try assuming the whole thing is the project
                    const p2 = rest.join('/');
                    combinations.push({ proj: p2, temp: `templates/template.yml` });
                    combinations.push({ proj: p2, temp: `templates/${t1}.yml` });
                }
                
                let fetched = false;
                const componentService = getComponentService();
                
                for (const combo of combinations) {
                    const url = `https://${gitlabInstance}/api/v4/projects/${encodeURIComponent(combo.proj)}/repository/files/${encodeURIComponent(combo.temp)}/raw?ref=${version}`;
                    try {
                        const content = await componentService.httpClient.fetchText(url);
                        if (content && typeof content === 'string' && !content.includes('{"message":"404 Project Not Found"}')) {
                            this.includedSources.push(targetName);
                            await this.parseRecursive(content, targetName, depth, context);
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
                    
                    const url = `https://${gitlabInstance}/api/v4/projects/${encodeURIComponent(projectPath)}/repository/files/${encodeURIComponent(cleanFile)}/raw?ref=${encodeURIComponent(ref)}`;
                    
                    try {
                        const content = await componentService.httpClient.fetchText(url);
                        if (content && typeof content === 'string' && !content.includes('{"message":"404 Project Not Found"}')) {
                            if (!this.includedSources.includes(targetName)) {
                                this.includedSources.push(targetName);
                            }
                            await this.parseRecursive(content, targetName, depth, context);
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

    private async resolveLocalInclude(inc: string, currentSource: string, depth: number, context?: any) {
        try {
            if (path.isAbsolute(currentSource)) {
                const dir = path.dirname(currentSource);
                const localPath = inc.startsWith('/') ? path.join(dir, inc.substring(1)) : path.resolve(dir, inc);
                
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
