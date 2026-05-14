import { parseYaml } from '../utils/yamlParser';
import { getComponentService } from '../services/component/componentService';

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
                    this.errors.push(`Local file includes (${inc}) are currently stubbed in visualizer.`);
                    return; // Cannot resolve local file from here easily without workspace context
                }
            } else if (inc.component) {
                // Component include
                // e.g., gitlab.com/my-group/my-project/my-component@1.0.0
                const componentUrl = inc.component;
                targetName = `component:${componentUrl}`;
                
                // Parse component URL to fetch the raw template
                const componentService = getComponentService();
                const parsedUrl = componentService.parseCustomComponentUrl(`https://${componentUrl}`);
                if (parsedUrl) {
                    const { gitlabInstance, path } = parsedUrl;
                    const pathParts = path.split('@');
                    const fullPath = pathParts[0];
                    const version = pathParts.length > 1 ? pathParts[1] : 'main';
                    
                    // The component path is likely a project path + template name.
                    // For simplicity, we can fetch metadata, but we need the raw content.
                    // componentFetcher.ts logic: it finds templates/name.yml
                    // This is a bit complex to reproduce here without duplicating fetch logic.
                    // We will log it as an included source but might not be able to fetch its content perfectly.
                    this.includedSources.push(targetName);
                    this.errors.push(`Recursive parsing of component ${componentUrl} is not fully supported yet.`);
                    return;
                }
            } else if (inc.project && inc.file) {
                // Project include
                targetName = `project:${inc.project}:${inc.file}`;
                this.includedSources.push(targetName);
                this.errors.push(`Recursive parsing of project files (${inc.project}/${inc.file}) is not fully supported yet.`);
                return;
            } else if (inc.remote) {
                // Remote include
                targetUrl = inc.remote;
                targetName = `remote:${inc.remote}`;
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
