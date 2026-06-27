import * as vscode from 'vscode';
import { PipelineParser, PipelineGraph, PipelineJob } from '../parsers/pipelineParser';
import { getComponentService } from '../services/component/componentService';

export class PipelineParserCommand {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public async parseAndShowTui(document?: vscode.TextDocument) {
        if (!document) {
            vscode.window.showErrorMessage("No active GitLab CI document to parse.");
            return;
        }

        const content = document.getText();
        const sourceName = document.uri.fsPath;

        const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
        const customVariables = config.get<Record<string, string>>('customVariables', {});
        const activePolicyOverride = config.get<string>('parser.activePolicyOverride', '');
        const gitlabUrl = config.get<string>('gitlabUrl', 'https://gitlab.com');
        let projectPath = config.get<string>('projectPath', '');

        // Try to auto-discover project path from local .git/config if not set in VS Code settings
        if (!projectPath && sourceName && require('path').isAbsolute(sourceName)) {
            try {
                const { getProjectPathFromLocalFile } = require('../utils/gitUtils');
                const discoveredPath = await getProjectPathFromLocalFile(sourceName);
                if (discoveredPath) {
                    projectPath = discoveredPath;
                }
            } catch (e) {
                // Ignore
            }
        }

        let gitlabInstance = 'gitlab.com';
        try {
            gitlabInstance = new URL(gitlabUrl).hostname;
        } catch {
            gitlabInstance = gitlabUrl.replace(/^https?:\/\//, '').split('/')[0];
        }

        const parserContext = { gitlabInstance, projectPath, customVariables, activePolicyOverride };
        let includesToProcess: string[] = [];
        let pepWarning: string | undefined;
        let pepInfo: string | undefined;

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Parsing GitLab Pipeline...",
            cancellable: false
        }, async (progress) => {
            try {
                if (projectPath) {
                    const componentService = getComponentService();
                    const token = await componentService.getTokenForProject(gitlabInstance);

                    const pepOverride = config.get<string>('parser.pepProjectPathOverride');
                    let linkedProject: string | undefined = undefined;

                    if (pepOverride) {
                        linkedProject = pepOverride;
                    } else {
                        linkedProject = await componentService.fetchLinkedSecurityPolicyProject(gitlabInstance, projectPath, token || '');
                    }

                    if (linkedProject) {
                        includesToProcess.push(`project:${linkedProject}:.gitlab/security-policies/policy.yml`);
                        pepInfo = pepOverride 
                            ? `Loaded PEP from explicit override project '${linkedProject}'.`
                            : `Loaded PEP from linked project '${linkedProject}'.`;
                    } else {
                        pepWarning = `No linked Security Policy Project (PEP) was returned by GitLab for '${projectPath}'. Defaulting to local repository fallback.`;
                        includesToProcess.push(`project:${projectPath}:.gitlab/security-policies/policy.yml`);
                    }
                } else {
                    pepWarning = `Cannot automatically discover Pipeline Execution Policies (PEP): 'gitlabComponentHelper.projectPath' is not configured.`;
                }

                const extraIncludes = includesToProcess.map(entry => {
                    if (entry.startsWith('project:')) {
                        const parts = entry.slice('project:'.length).split(':');
                        const project = parts[0];
                        const fileAndRef = parts[1] || '';
                        const atIdx = fileAndRef.lastIndexOf('@');
                        const file = atIdx >= 0 ? fileAndRef.slice(0, atIdx) : fileAndRef;
                        const ref = atIdx >= 0 ? fileAndRef.slice(atIdx + 1) : 'HEAD';
                        return { project, file, ref };
                    }
                    return { local: entry };
                });

                const parser = new PipelineParser(10);
                const graph = await parser.parse(content, sourceName, parserContext, extraIncludes.length > 0 ? extraIncludes : undefined);

                if (pepWarning) graph.errors.push(pepWarning);
                if (pepInfo) graph.errors.push(`ℹ️ Info: ${pepInfo}`);

                // Step 2: Show QuickPick for filtering sources
                const allSources = new Set<string>();
                const extractSources = (node: any) => {
                    const match = node.name.match(/\(Local Override: (.*?)\)$/);
                    const raw = match ? match[1] : node.name;
                    allSources.add(raw.replace(/\\\\/g, '/'));
                    if (node.children) {
                        for (const child of node.children) extractSources(child);
                    }
                };
                if (graph.includeTree) extractSources(graph.includeTree);
                
                const quickPickItems: vscode.QuickPickItem[] = Array.from(allSources).map(src => ({
                    label: src,
                    picked: true
                }));

                // Ensure there is something to pick, else skip filtering
                let hiddenSources = new Set<string>();
                if (quickPickItems.length > 1) {
                    const selected = await vscode.window.showQuickPick(quickPickItems, {
                        canPickMany: true,
                        placeHolder: 'Select included files to visualize (uncheck to hide their jobs)'
                    });
                    if (!selected) return; // User cancelled
                    
                    const selectedSources = new Set(selected.map(s => s.label));
                    hiddenSources = new Set(Array.from(allSources).filter(s => !selectedSources.has(s)));
                }

                // Step 3: Generate Markdown output
                await this.generateMarkdownOutput(graph, sourceName, hiddenSources);

            } catch (error) {
                vscode.window.showErrorMessage(`Failed to parse pipeline: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }

    private async generateMarkdownOutput(graph: PipelineGraph, sourceName: string, hiddenSources: Set<string>) {
        const effectiveHidden = new Set<string>();

        if (graph.includeTree) {
            const traverse = (node: any, parentHidden: boolean) => {
                const match = node.name.match(/\(Local Override: (.*?)\)$/);
                const raw = match ? match[1] : node.name;
                const source = raw.replace(/\\\\/g, '/');
                
                const isHidden = parentHidden || hiddenSources.has(source);
                if (isHidden) effectiveHidden.add(source);

                if (node.children) {
                    for (const child of node.children) traverse(child, isHidden);
                }
            };
            traverse(graph.includeTree, false);
        }

        let md = `# GitLab Pipeline Visualization\n\n`;
        md += `**Source:** \`${sourceName}\`\n\n`;

        if (graph.errors.length > 0) {
            md += `## Warnings / Info\n`;
            graph.errors.forEach(err => {
                md += `- ${err}\n`;
            });
            md += `\n`;
        }

        md += `## Pipeline Stages & Jobs\n\n`;

        const visibleStages = graph.stages.filter(s => !s.isImplicit || s.jobs.length > 0);
        
        visibleStages.forEach(stage => {
            const visibleJobs = stage.jobs.filter(job => !effectiveHidden.has(job.source));
            
            if (visibleJobs.length === 0 && stage.isImplicit) return;

            md += `### Stage: ${stage.name} ${stage.isImplicit ? '(Implicit)' : ''}\n`;
            
            if (visibleJobs.length === 0) {
                md += `*No jobs in this stage*\n`;
            } else {
                visibleJobs.forEach(job => {
                    md += `- **${job.name}** *(Source: \`${job.source}\`)*\n`;
                });
            }
            md += `\n`;
        });

        md += `## Included Sources Tree\n\n`;
        md += "```text\n";
        
        const renderIncludeTree = (node: any, depth: number = 0, isLast: boolean = true, prefix: string = '') => {
            if (depth > 15) return `${prefix}${isLast ? '└── ' : '├── '}... (max depth reached)\n`;
            
            const connector = depth === 0 ? '' : (isLast ? '└── ' : '├── ');
            let line = `${prefix}${connector}${node.name}\n`;
            
            const newPrefix = depth === 0 ? '' : prefix + (isLast ? '    ' : '│   ');
            
            if (node.children && node.children.length > 0) {
                node.children.forEach((child: any, index: number) => {
                    line += renderIncludeTree(child, depth + 1, index === node.children.length - 1, newPrefix);
                });
            }
            return line;
        };

        if (graph.includeTree) {
            md += renderIncludeTree(graph.includeTree);
        } else {
            md += `No includes found.\n`;
        }
        md += "```\n";

        // Provide an invisible data block for the piggybacking component
        md += `\n<!-- PIPELINE_GRAPH_DATA: ${Buffer.from(JSON.stringify(graph)).toString('base64')} -->\n`;

        const document = await vscode.workspace.openTextDocument({
            content: md,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(document, { preview: false });
    }
}
