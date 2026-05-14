import * as vscode from 'vscode';
import { PipelineParser, PipelineGraph } from '../parsers/pipelineParser';
import { getComponentService } from '../services/component/componentService';

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
                    enableCommandUris: true
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

                const url = `https://${gitlabInstance}/api/v4/projects/${encodeURIComponent(componentContext.sourcePath)}/repository/files/${encodeURIComponent(`templates/${templateName}`)}/raw?ref=${componentContext.version || 'main'}`;

                try {
                    content = await componentService.httpClient.fetchText(url);
                    sourceName = componentContext.name;
                } catch (e) {
                    // Try fallback
                    const fallbackUrl = `https://${gitlabInstance}/api/v4/projects/${encodeURIComponent(componentContext.sourcePath)}/repository/files/${encodeURIComponent(`templates/${componentContext.name}/template.yml`)}/raw?ref=${componentContext.version || 'main'}`;
                    try {
                        content = await componentService.httpClient.fetchText(fallbackUrl);
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
            const parserContext = componentContext ? { ...componentContext, customVariables } : { customVariables };

            const parser = new PipelineParser(10); // max depth 10
            const graph = await parser.parse(content, sourceName, parserContext);

            this.panel.webview.html = this.getGraphHtml(graph, sourceName);
        } catch (e) {
            this.panel.webview.html = this.getErrorHtml(e instanceof Error ? e.message : String(e));
        }
    }

    private getGraphHtml(graph: PipelineGraph, sourceName: string): string {
        let mermaidCode = 'flowchart LR\n';

        let prevStageId = '';
        const stageIds: string[] = [];

        // Filter stages: we only show explicit stages or implicit stages that have jobs
        const visibleStages = graph.stages.filter(s => !s.isImplicit || s.jobs.length > 0);

        visibleStages.forEach((stage, index) => {
            const stageId = `stage_${index}`;
            stageIds.push(stageId);
            mermaidCode += `  subgraph ${stageId} ["${stage.name}"]\n`;
            mermaidCode += `    direction TB\n`;

            if (stage.jobs.length === 0) {
                mermaidCode += `    empty_${stageId}[No jobs]\n`;
                mermaidCode += `    style empty_${stageId} fill:none,stroke:none\n`;
            } else {
                stage.jobs.forEach(job => {
                    const jobId = `job_${job.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
                    // Use standard characters and <br> for newlines in node labels
                    mermaidCode += `    ${jobId}["${job.name}<br/><small><i>${job.source}</i></small>"]\n`;
                });
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

        const errorsHtml = graph.errors.length > 0
            ? `<div class="errors"><h3>Warnings:</h3><ul>${graph.errors.map(e => `<li>${e}</li>`).join('')}</ul></div>`
            : '';

        const includesHtml = graph.includedSources.length > 0
            ? `<div class="includes"><h3>Included Sources:</h3><ul>${graph.includedSources.map(s => `<li>${s}</li>`).join('')}</ul></div>`
            : '';

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Pipeline Visualization</title>
            <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
            <script src="https://cdn.jsdelivr.net/npm/svg-pan-zoom@3.6.1/dist/svg-pan-zoom.min.js"></script>
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
                    background-color: rgba(0,120,255,0.1);
                    border: 1px solid blue;
                    padding: 10px;
                    border-radius: 4px;
                }
                h2, h3 {
                    margin-top: 0;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>Pipeline: ${sourceName}</h2>
                <div class="graph-container">
                    <div class="mermaid">
                        ${mermaidCode}
                    </div>
                </div>
                ${includesHtml}
                ${errorsHtml}
            </div>
            <script>
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
        return `<!DOCTYPE html>
        <html>
        <head>
            <style>
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
        return `<!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-errorForeground);
                    padding: 20px;
                }
            </style>
        </head>
        <body>
            <h2>Error visualizing pipeline</h2>
            <p>${error}</p>
        </body>
        </html>`;
    }
}
