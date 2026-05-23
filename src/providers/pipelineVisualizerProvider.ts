import { safeUrlParse } from '../utils/urlUtils';
import * as vscode from 'vscode';
import { PipelineParser, PipelineGraph, PipelineJob, PipelineStage } from '../parsers/pipelineParser';
import { getComponentService } from '../services/component/componentService';

import { secureRandomBase64Url } from '../utils/crypto';

// Dev Note: these escape and nonce functions are designed to prevent XSS and injection attacks.
function escapeHtml(unsafe: string): string {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function escapeMermaid(unsafe: string): string {
    return escapeHtml(unsafe.replace(/\\/g, "/"));
}

function getNonce(): string {
    return secureRandomBase64Url(32);
}

export class PipelineVisualizerProvider {
    private panel: vscode.WebviewPanel | undefined;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    public async show(componentContext?: any, document?: vscode.TextDocument) {
        if (this.panel) {
            this.panel.reveal();
        } else {
            this.panel = vscode.window.createWebviewPanel(
                'gitlabPipelineVisualizer',
                'GitLab Pipeline Visualizer',
                vscode.ViewColumn.Active,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    enableCommandUris: true,
                    localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
                }
            );

            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });
        }

        this.panel.webview.html = this.getLoadingHtml();

        try {
            let content = '';
            let sourceName = '';

            if (document) {
                content = document.getText();
                sourceName = document.uri.fsPath;
            } else if (componentContext) {
                // Fetch component YAML
                const gitlabInstance = componentContext.gitlabInstance || 'gitlab.com';
                const componentService = getComponentService();

                // Construct the raw URL for the template
                // Assuming standard component directory structure
                const templateName = componentContext.name === componentContext.sourcePath.split('/').pop()
                    ? 'template.yml'
                    : `${componentContext.name}.yml`;

                try {
                    content = await componentService.fetchRawFile(
                        gitlabInstance,
                        componentContext.sourcePath,
                        `templates/${templateName}`,
                        componentContext.version || 'main'
                    );
                    sourceName = componentContext.name;
                } catch (e) {
                    // Try fallback
                    try {
                        content = await componentService.fetchRawFile(
                            gitlabInstance,
                            componentContext.sourcePath,
                            `templates/${componentContext.name}/template.yml`,
                            componentContext.version || 'main'
                        );
                        sourceName = componentContext.name;
                    } catch (err) {
                        throw new Error(`Failed to fetch component template for ${componentContext.name}`);
                    }
                }
            } else {
                throw new Error("No document or component provided to visualize.");
            }

            const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
            const customVariables = config.get<Record<string, string>>('customVariables', {});
            const alwaysInclude = config.get<string[]>('visualizer.alwaysInclude', []);
            const gitlabUrl = config.get<string>('gitlabUrl', 'https://gitlab.com');
            const projectPath = config.get<string>('projectPath', '');

            // Ensure gitlabInstance is just the hostname for comparison
            let gitlabInstance = 'gitlab.com';
            try {
                gitlabInstance = safeUrlParse(gitlabUrl).hostname;
            } catch {
                gitlabInstance = gitlabUrl.replace(/^https?:\/\//, '').split('/')[0];
            }

            const parserContext = componentContext 
                ? { ...componentContext, customVariables } 
                : { gitlabInstance, projectPath, customVariables };

            // Build structured include objects for alwaysInclude entries.
            // We pass these directly to parser.parse() as pre-parsed objects rather than
            // injecting a YAML string — avoiding duplicate-key corruption and Windows-path
            // backslash escaping issues that the string-injection approach suffered from.
            const extraIncludes = alwaysInclude.map(entry => {
                if (entry.startsWith('component:')) {
                    return { component: entry.slice('component:'.length) };
                }
                if (entry.startsWith('project:')) {
                    // Format: project:group/path:file.yml@ref
                    const parts = entry.slice('project:'.length).split(':');
                    const project = parts[0];
                    const fileAndRef = parts[1] || '';
                    const atIdx = fileAndRef.lastIndexOf('@');
                    const file = atIdx >= 0 ? fileAndRef.slice(0, atIdx) : fileAndRef;
                    const ref = atIdx >= 0 ? fileAndRef.slice(atIdx + 1) : 'HEAD';
                    return { project, file, ref };
                }
                if (entry.startsWith('local:')) {
                    return { local: entry.slice('local:'.length) };
                }
                // Default: treat as a local path (absolute paths work correctly since
                // resolveLocalInclude handles absolute paths via fs.existsSync)
                return { local: entry };
            });

            const parser = new PipelineParser(10); // max depth 10
            const graph = await parser.parse(content, sourceName, parserContext, extraIncludes.length > 0 ? extraIncludes : undefined);

            this.panel.webview.html = this.getGraphHtml(graph, sourceName, this.panel.webview);
        } catch (e) {
            this.panel.webview.html = this.getErrorHtml(e instanceof Error ? e.message : String(e));
        }
    }

    private getGraphHtml(graph: PipelineGraph, sourceName: string, webview: vscode.Webview): string {
        let mermaidCode = 'flowchart LR\n';

        const stageIds: string[] = [];

        // Filter stages: we only show explicit stages or implicit stages that have jobs
        const visibleStages = graph.stages.filter(s => !s.isImplicit || s.jobs.length > 0);

        visibleStages.forEach((stage, index) => {
            const stageId = `stage_${index}`;
            stageIds.push(stageId);
            mermaidCode += `  subgraph ${stageId} ["${escapeMermaid(stage.name)}"]\n`;
            mermaidCode += `    direction TB\n`;

            if (stage.jobs.length === 0) {
                mermaidCode += `    empty_${stageId}[No jobs]\n`;
                mermaidCode += `    style empty_${stageId} fill:none,stroke:none\n`;
            } else {
                const jobIds: string[] = [];
                const usedJobIds = new Set<string>();
                stage.jobs.forEach((job: PipelineJob) => {
                    let baseId = `job_${job.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
                    let jobId = baseId;
                    let counter = 1;
                    while (usedJobIds.has(jobId)) {
                        jobId = `${baseId}_${counter++}`;
                    }
                    usedJobIds.add(jobId);
                    jobIds.push(jobId);
                    mermaidCode += `    ${jobId}["${escapeMermaid(job.name)}<br/><small><i>${escapeMermaid(job.source)}</i></small>"]\n`;
                });
                // Chain jobs with invisible links to force vertical (TB) stacking.
                // Mermaid's subgraph direction TB is unreliable inside an LR parent;
                // ~~~ links guarantee the layout engine stacks them top-to-bottom.
                if (jobIds.length > 1) {
                    mermaidCode += `    ${jobIds.join(' ~~~ ')}\n`;
                }
            }
            mermaidCode += `  end\n`;

            // Add style to subgraph
            if (stage.isImplicit) {
                mermaidCode += `  style ${stageId} fill:#f9f9f9,stroke:#999,stroke-dasharray: 5 5\n`;
            } else {
                mermaidCode += `  style ${stageId} fill:#e1f5fe,stroke:#0288d1,stroke-width:2px\n`;
            }
        });

        // Link stages to enforce ordering
        for (let i = 0; i < stageIds.length - 1; i++) {
            mermaidCode += `  ${stageIds[i]} --> ${stageIds[i + 1]}\n`;
        }

        const renderError = (e: string): string => {
            // Replace known action sentinels with clickable VS Code command links.
            // All other content is HTML-escaped before substitution so there is no XSS surface.
            return escapeHtml(e).replace(
                /\[action:openCustomVariables\]/g,
                `<a href="command:workbench.action.openSettings?%22gitlabComponentHelper.customVariables%22">set custom variables</a>`
            );
        };

        const MAX_TREE_RENDER_DEPTH = 15;
        const renderIncludeTree = (node: any, depth: number = 0, isLast: boolean = true, prefix: string = ''): string => {
            if (depth > MAX_TREE_RENDER_DEPTH) {
                return `<div class="tree-line">${prefix}${isLast ? '└── ' : '├── '}... (max depth reached)</div>`;
            }

            let html = '';
            const name = node.name;
            
            if (depth > 0) {
                const connector = isLast ? '└── ' : '├── ';
                html += `<div class="tree-line">${prefix}${connector}${escapeHtml(name)}</div>`;
            } else {
                html += `<div class="tree-line root-node">${escapeHtml(name)}</div>`;
            }

            const newPrefix = depth === 0 ? '' : prefix + (isLast ? '&nbsp;&nbsp;&nbsp;&nbsp;' : '│&nbsp;&nbsp;&nbsp;');
            
            if (node.children && node.children.length > 0) {
                node.children.forEach((child: any, index: number) => {
                    html += renderIncludeTree(child, depth + 1, index === node.children.length - 1, newPrefix);
                });
            }
            return html;
        };

        const errorsHtml = graph.errors.length > 0
            ? `<div class="errors"><h3>Warnings:</h3><ul>${graph.errors.map(e => `<li>${renderError(e)}</li>`).join('')}</ul></div>`
            : '';

        const includesHtml = graph.includeTree
            ? `<div class="includes"><h3>Included Sources:</h3><div class="tree">${renderIncludeTree(graph.includeTree)}</div></div>`
            : '';

        const nonce = getNonce();
        const mermaidUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'mermaid.min.js'));
        const svgPanZoomUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'svg-pan-zoom.min.js'));

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';">
            <title>Pipeline Visualization</title>
            <script nonce="${nonce}" src="${mermaidUri}"></script>
            <script nonce="${nonce}" src="${svgPanZoomUri}"></script>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-editor-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 20px;
                    margin: 0;
                    height: 100vh;
                    box-sizing: border-box;
                }
                .container {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    gap: 15px;
                }
                .graph-container {
                    background-color: white; /* Mermaid usually looks best on white */
                    padding: 10px;
                    border-radius: 8px;
                    flex-grow: 1;
                    min-height: 400px;
                    overflow: hidden; /* svg-pan-zoom handles the panning */
                    position: relative;
                }
                .mermaid {
                    width: 100%;
                    height: 100%;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                }
                .mermaid svg {
                    width: 100% !important;
                    height: 100% !important;
                    max-width: none !important;
                }
                .errors {
                    background-color: rgba(255,0,0,0.1);
                    border: 1px solid red;
                    padding: 10px;
                    border-radius: 4px;
                }
                .includes {
                    background-color: rgba(0,120,255,0.05);
                    border: 1px solid rgba(0,120,255,0.3);
                    padding: 10px;
                    border-radius: 4px;
                }
                .tree {
                    font-family: 'Courier New', Courier, monospace;
                    font-size: 13px;
                    line-height: 1.4;
                    white-space: pre;
                }
                .tree-line {
                    margin-bottom: 2px;
                }
                .root-node {
                    font-weight: bold;
                    color: var(--vscode-editor-foreground);
                    margin-bottom: 5px;
                }
                h2, h3 {
                    margin-top: 0;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>Pipeline: ${escapeHtml(sourceName)}</h2>
                <div class="graph-container">
                    <div class="mermaid">
                        ${mermaidCode}
                    </div>
                </div>
                ${includesHtml}
                ${errorsHtml}
            </div>
            <script nonce="${nonce}">
                mermaid.initialize({ startOnLoad: false, theme: 'default' });
                
                async function renderGraph() {
                    try {
                        await mermaid.run();
                        
                        // After Mermaid renders, initialize svg-pan-zoom
                        const svg = document.querySelector('.mermaid svg');
                        if (svg) {
                            // Ensure SVG takes up the full container space for panning
                            svg.style.width = '100%';
                            svg.style.height = '100%';
                            
                            svgPanZoom(svg, {
                                zoomEnabled: true,
                                controlIconsEnabled: true,
                                fit: true,
                                center: true,
                                minZoom: 0.1,
                                maxZoom: 10
                            });
                        }
                    } catch (err) {
                        console.error('Mermaid rendering failed', err);
                    }
                }
                
                renderGraph();
            </script>
        </body>
        </html>`;
    }

    private getLoadingHtml(): string {
        const nonce = getNonce();
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
            <style nonce="${nonce}">
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-editor-foreground);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                }
            </style>
        </head>
        <body>
            <div>Loading pipeline visualization...</div>
        </body>
        </html>`;
    }

    private getErrorHtml(error: string): string {
        const nonce = getNonce();
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
            <style nonce="${nonce}">
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-errorForeground);
                    padding: 20px;
                }
            </style>
        </head>
        <body>
            <h2>Error visualizing pipeline</h2>
            <p>${escapeHtml(error)}</p>
        </body>
        </html>`;
    }
}
