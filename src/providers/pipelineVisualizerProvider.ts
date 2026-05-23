import { safeUrlParse } from '../utils/urlUtils';
import * as vscode from 'vscode';
import { PipelineParser, PipelineGraph, PipelineJob, PipelineStage } from '../parsers/pipelineParser';
import { getComponentService } from '../services/component/componentService';

import { secureRandomBase64Url } from '../utils/crypto';
import { getContrastColor } from '../utils/colorUtils';

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
    private graph: PipelineGraph | undefined;
    private hiddenSources = new Set<string>();
    private sourceColors = new Map<string, string>();

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

            this.panel.webview.onDidReceiveMessage(message => {
                if (message.type === 'updateFilters') {
                    this.hiddenSources = new Set(message.hiddenSources);
                    this.sourceColors = new Map(Object.entries(message.colors));
                    if (this.graph) {
                        const newMermaidCode = this.generateMermaidCode(this.graph, this.hiddenSources, this.sourceColors);
                        this.panel?.webview.postMessage({ type: 'rerender', mermaidCode: newMermaidCode });
                    }
                }
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
            const activePolicyOverride = config.get<string>('visualizer.activePolicyOverride', '');
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

            // Ensure gitlabInstance is just the hostname for comparison
            let gitlabInstance = 'gitlab.com';
            try {
                gitlabInstance = safeUrlParse(gitlabUrl).hostname;
            } catch {
                gitlabInstance = gitlabUrl.replace(/^https?:\/\//, '').split('/')[0];
            }

            const parserContext = componentContext
                ? { ...componentContext, customVariables, activePolicyOverride }
                : { gitlabInstance, projectPath, customVariables, activePolicyOverride };

            let includesToProcess = [...alwaysInclude];
            let pepWarning: string | undefined;
            let pepInfo: string | undefined;

            const projectPathToUse = componentContext?.projectPath || projectPath;

            const pepContext = {
                projectPathConfigured: !!projectPathToUse,
                linkedProject: undefined as string | undefined,
                availablePolicies: [] as string[],
                activePolicyOverride: activePolicyOverride,
                localOverrides: alwaysInclude.filter(inc => require('path').isAbsolute(inc))
            };

            // Fetch linked policy project if available
            if (projectPathToUse) {
                const componentService = getComponentService();
                const token = await componentService.getTokenForProject(gitlabInstance, projectPathToUse);

                const pepOverride = config.get<string>('visualizer.pepProjectPathOverride');
                let linkedProject: string | undefined = undefined;

                if (pepOverride) {
                    linkedProject = pepOverride;
                    pepContext.linkedProject = linkedProject;
                } else {
                    linkedProject = await componentService.fetchLinkedSecurityPolicyProject(gitlabInstance, projectPathToUse, token || '');
                    pepContext.linkedProject = linkedProject;
                }

                let availablePolicies: string[] = [];
                try {
                    availablePolicies = await componentService.fetchPipelineExecutionPolicies(gitlabInstance, projectPathToUse, token || '');
                    pepContext.availablePolicies = availablePolicies;
                } catch (e) {
                    // Ignore errors fetching policies list
                }

                if (linkedProject) {
                    includesToProcess.push(`project:${linkedProject}:.gitlab/security-policies/policy.yml`);
                    if (pepOverride) {
                        pepInfo = `Loaded PEP from explicit override project '${linkedProject}'.`;
                    } else {
                        pepInfo = `Loaded PEP from linked project '${linkedProject}'.`;
                    }
                } else {
                    pepWarning = `No linked Security Policy Project (PEP) was returned by GitLab for '${projectPathToUse}'. Defaulting to local repository fallback.`;
                    // Fallback: check local policy
                    includesToProcess.push(`project:${projectPathToUse}:.gitlab/security-policies/policy.yml`);
                }

                if (availablePolicies.length > 0) {
                    pepInfo = (pepInfo ? pepInfo + ' ' : '') + `Available server policies: ${availablePolicies.join(', ')}.`;
                    if (activePolicyOverride && !availablePolicies.includes(activePolicyOverride)) {
                        pepWarning = (pepWarning ? pepWarning + ' ' : '') + `Warning: Active policy override '${activePolicyOverride}' was not found on the server.`;
                    }
                }
            } else {
                pepWarning = `Cannot automatically discover Pipeline Execution Policies (PEP): 'gitlabComponentHelper.projectPath' is not configured in settings.`;
            }

            // Build structured include objects for includesToProcess entries.
            // We pass these directly to parser.parse() as pre-parsed objects rather than
            // injecting a YAML string — avoiding duplicate-key corruption and Windows-path
            // backslash escaping issues that the string-injection approach suffered from.
            const extraIncludes = includesToProcess.map(entry => {
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

            if (pepWarning) {
                graph.errors.push(pepWarning);
            }
            if (pepInfo) {
                graph.errors.push(`ℹ️ Info: ${pepInfo}`);
            }

            this.graph = graph;
            this.panel.webview.html = this.getWebviewHtml(graph, sourceName, this.panel.webview, activePolicyOverride, pepContext);
        } catch (e) {
            this.panel.webview.html = this.getErrorHtml(e instanceof Error ? e.message : String(e));
        }
    }

    // Normalize a node name (which may include a Local Override) to the raw source path used in jobs
    private normalizeSource(nodeName: string): string {
        const match = nodeName.match(/\(Local Override: (.*?)\)$/);
        const raw = match ? match[1] : nodeName;
        // Convert Windows backslashes to forward slashes for consistent matching
        return raw.replace(/\\\\/g, '/');
    }


    private generateMermaidCode(graph: PipelineGraph, hiddenSources: Set<string>, sourceColors: Map<string, string>): string {
        const effectiveHidden = new Set<string>();
        const effectiveColors = new Map<string, string>();

        if (graph.includeTree) {
            const traverse = (node: any, parentHidden: boolean, parentColor: string | undefined) => {
                const source = this.normalizeSource(node.name);
                const isHidden = parentHidden || hiddenSources.has(source);
                const color = (sourceColors.has(source) && sourceColors.get(source) !== '#ffffff')
                    ? sourceColors.get(source)
                    : parentColor;

                if (isHidden) {
                    effectiveHidden.add(source);
                }
                if (color) {
                    effectiveColors.set(source, color);
                }

                if (node.children) {
                    for (const child of node.children) {
                        traverse(child, isHidden, color);
                    }
                }
            };
            traverse(graph.includeTree, false, undefined);
        }

        let mermaidCode = 'flowchart LR\n';

        const stageIds: string[] = [];

        // Filter stages: we only show explicit stages or implicit stages that have jobs
        const visibleStages = graph.stages.filter(s => !s.isImplicit || s.jobs.length > 0);

        visibleStages.forEach((stage, index) => {
            const stageId = `stage_${index}`;

            // Only add stage subgraph if it has jobs after filtering, or if it's an explicit stage
            const visibleJobs = stage.jobs.filter(job => !effectiveHidden.has(job.source));

            if (visibleJobs.length === 0 && stage.isImplicit) {
                return; // Skip implicit stages with no visible jobs
            }

            stageIds.push(stageId);
            mermaidCode += `  subgraph ${stageId} ["${escapeMermaid(stage.name)}"]\n`;
            mermaidCode += `    direction TB\n`;

            if (visibleJobs.length === 0) {
                mermaidCode += `    empty_${stageId}[No jobs]\n`;
                mermaidCode += `    style empty_${stageId} fill:none,stroke:none\n`;
            } else {
                const jobIds: string[] = [];
                const usedJobIds = new Set<string>();
                visibleJobs.forEach((job: PipelineJob) => {
                    let baseId = `job_${job.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
                    let jobId = baseId;
                    let counter = 1;
                    while (usedJobIds.has(jobId)) {
                        jobId = `${baseId}_${counter++}`;
                    }
                    usedJobIds.add(jobId);
                    jobIds.push(jobId);
                    mermaidCode += `    ${jobId}["${escapeMermaid(job.name)}<br/><small><i>${escapeMermaid(job.source)}</i></small>"]\n`;

                    // Apply color if configured
                    const color = effectiveColors.get(job.source);
                    if (color && color !== '#ffffff') {
                        const textColor = getContrastColor(color);
                        mermaidCode += `    style ${jobId} fill:${color},stroke:#333,stroke-width:2px,color:${textColor}\n`;
                    }
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

        return mermaidCode;
    }

    private getWebviewHtml(graph: PipelineGraph, sourceName: string, webview: vscode.Webview, activePolicyOverride?: string, pepContext?: any): string {
        const mermaidCode = this.generateMermaidCode(graph, this.hiddenSources, this.sourceColors);

        const renderError = (e: string): string => {
            // Replace known action sentinels with clickable VS Code command links.
            // All other content is HTML-escaped before substitution so there is no XSS surface.
            return escapeHtml(e).replace(
                /\[action:openCustomVariables\]/g,
                `<a href="command:workbench.action.openSettings?%22gitlabComponentHelper.customVariables%22">set custom variables</a>`
            );
        };

        const MAX_TREE_RENDER_DEPTH = 15;
        const renderIncludeTree = (
            node: any,
            depth: number = 0,
            isLast: boolean = true,
            prefix: string = '',
            parentSource: string = ''
        ): string => {
            if (depth > MAX_TREE_RENDER_DEPTH) {
                return `<div class="tree-line"><span class="tree-text">${prefix}${isLast ? '└── ' : '├── '}... (max depth reached)</span></div>`;
            }

            let html = '';
            const name = node.name;
            let displayName = escapeHtml(name);

            // Highlight local overrides if present
            if (displayName.includes('(Local Override:')) {
                displayName = displayName.replace(/\(Local Override: (.*?)\)/, '<span style="color: var(--vscode-charts-orange); font-style: italic;">(Local Override: $1)</span>');
            }

            const source = this.normalizeSource(name);
            const isChecked = !this.hiddenSources.has(source) ? 'checked' : '';
            const colorValue = this.sourceColors.get(source) || '#ffffff';
            const hasColor = colorValue !== '#ffffff';
            const styleString = hasColor ? `border-left: 4px solid ${colorValue}; padding-left: 4px;` : '';

            const controls = `<span class="tree-controls" style="display: flex; gap: 8px; align-items: center; margin-left: 10px; flex-shrink: 0; white-space: nowrap;">
                <input type="checkbox" class="source-toggle" data-source="${escapeHtml(source)}" data-parent="${escapeHtml(parentSource)}" ${isChecked} title="Toggle visibility">
                <input type="color" class="source-color" data-source="${escapeHtml(source)}" value="${colorValue}" title="Set job color" style="padding: 0; width: 20px; height: 20px; border: none; background: none; cursor: pointer;">
                <button class="apply-color" data-source="${escapeHtml(source)}" title="Apply color" style="background:none; border:none; color:var(--vscode-button-foreground); cursor:pointer; font-size:14px; padding:0; margin-left:2px;">✓</button>
                <button class="reset-color" data-source="${escapeHtml(source)}" title="Clear color" style="background:none; border:none; color:var(--vscode-errorForeground); cursor:pointer; font-size:14px; padding:0; margin-top:-2px;">×</button>
            </span>`;

            if (depth > 0) {
                const connector = isLast ? '└── ' : '├── ';
                html += `<div class="tree-line" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; ${styleString}"><span class="tree-text" style="flex-grow: 1;">${prefix}${connector}${displayName}</span>${controls}</div>`;
            } else {
                html += `<div class="tree-line root-node" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; ${styleString}"><span class="tree-text" style="flex-grow: 1;">${displayName}</span>${controls}</div>`;
            }

            const newPrefix = depth === 0 ? '' : prefix + (isLast ? '&nbsp;&nbsp;&nbsp;&nbsp;' : '│&nbsp;&nbsp;&nbsp;');

            if (node.children && node.children.length > 0) {
                node.children.forEach((child: any, index: number) => {
                    html += renderIncludeTree(child, depth + 1, index === node.children.length - 1, newPrefix, source);
                });
            }
            return html;
        };

        const errorsHtml = graph.errors.length > 0
            ? `<div class="errors"><h3>Warnings:</h3><ul>${graph.errors.map(e => `<li>${renderError(e)}</li>`).join('')}</ul></div>`
            : '';

        let pepPanelHtml = '';
        if (pepContext) {
            pepPanelHtml = `
                <div class="pep-panel" style="background-color: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); padding: 15px; margin-bottom: 20px; border-radius: 4px;">
                    <h3 style="margin-top: 0; margin-bottom: 15px;">🛡️ Pipeline Execution Policies (PEP)</h3>
                    ${!pepContext.projectPathConfigured ? `
                        <p style="color: var(--vscode-editorWarning-foreground); margin-bottom: 10px;">⚠️ Project Path not configured. Cannot discover server PEPs.</p>
                        <a href="command:gitlab-component-helper.setProjectPath" class="vscode-button" style="display: inline-block; padding: 6px 12px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); text-decoration: none; border-radius: 2px;">Configure Project Path</a>
                    ` : `
                        <div style="margin-bottom: 10px;">
                            <strong>Linked Project:</strong> ${pepContext.linkedProject ? `<code>${pepContext.linkedProject}</code>` : '<em>None / Local Fallback</em>'}
                            <a href="command:gitlab-component-helper.setLinkedProjectOverride" title="Manually override the linked policy project" style="margin-left: 10px; color: var(--vscode-textLink-foreground); text-decoration: none; font-size: 12px;">[Set Policy Project]</a><br/>
                            <strong>Server Policies:</strong> ${pepContext.availablePolicies.length > 0 ? pepContext.availablePolicies.join(', ') : '<em>None</em>'}<br/>
                        </div>
                    `}
                    
                    <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--vscode-widget-border);">
                        <strong style="display: block; margin-bottom: 5px;">Active Overrides:</strong>
                        ${pepContext.activePolicyOverride ? `• Server Policy: <code>${pepContext.activePolicyOverride}</code><br/>` : ''}
                        ${pepContext.localOverrides.map((path: string) => `• Local File: <code>${path}</code><br/>`).join('')}
                        ${!pepContext.activePolicyOverride && pepContext.localOverrides.length === 0 ? '<em>None</em><br/>' : ''}
                    </div>

                    <div style="margin-top: 15px; display: flex; gap: 10px; flex-wrap: wrap;">
                        <a href="command:gitlab-component-helper.selectPolicyOverride" style="padding: 6px 12px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); text-decoration: none; border-radius: 2px; font-size: 13px;">Select Server Policy</a>
                        <a href="command:gitlab-component-helper.selectLocalPepOverride" style="padding: 6px 12px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); text-decoration: none; border-radius: 2px; font-size: 13px;">Select Local File</a>
                        <a href="command:gitlab-component-helper.clearPepOverrides" style="padding: 6px 12px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); text-decoration: none; border-radius: 2px; font-size: 13px;">Clear Overrides</a>
                    </div>
                </div>
            `;
        }

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
                .info-banner {
                    background-color: rgba(255,165,0,0.1);
                    border: 1px solid orange;
                    padding: 10px;
                    border-radius: 4px;
                    margin-bottom: 5px;
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
                ${pepPanelHtml}
                ${activePolicyOverride ? `<div class="info-banner"><strong>🛡️ Active Policy Override:</strong> ${escapeHtml(activePolicyOverride)} <small>(Other policies are being ignored)</small></div>` : ''}
                <div class="graph-container">
                    <div class="mermaid">
                        ${mermaidCode}
                    </div>
                </div>
                ${includesHtml}
                ${errorsHtml}
            </div>
            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                mermaid.initialize({ startOnLoad: false, theme: 'default' });
                
                let panZoomInstance = null;

                async function renderGraph() {
                    try {
                        const container = document.querySelector('.mermaid');
                        container.removeAttribute('data-processed');
                        
                        await mermaid.run({ querySelector: '.mermaid' });
                        
                        // After Mermaid renders, initialize svg-pan-zoom
                        const svg = container.querySelector('svg');
                        if (svg) {
                            // Ensure SVG takes up the full container space for panning
                            svg.style.width = '100%';
                            svg.style.height = '100%';
                            
                            if (panZoomInstance) {
                                panZoomInstance.destroy();
                            }
                            
                            panZoomInstance = svgPanZoom(svg, {
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

                function sendUpdate() {
                    const hiddenSources = [];
                    document.querySelectorAll('.source-toggle').forEach(el => {
                        if (!el.checked) {
                            hiddenSources.push(el.getAttribute('data-source'));
                        }
                    });
                    
                    const colors = {};
                    document.querySelectorAll('.source-color').forEach(el => {
                        if (el.value && el.value !== '#ffffff') {
                            colors[el.getAttribute('data-source')] = el.value;
                        }
                    });
                    
                    document.querySelectorAll('.tree-line').forEach(line => {
                        const picker = line.querySelector('.source-color');
                        if (picker && picker.value && picker.value !== '#ffffff') {
                            line.style.borderLeft = '4px solid ' + picker.value;
                            line.style.paddingLeft = '4px';
                        } else {
                            line.style.borderLeft = '';
                            line.style.paddingLeft = '';
                        }
                    });

                    vscode.postMessage({
                        type: 'updateFilters',
                        hiddenSources: hiddenSources,
                        colors: colors
                    });
                }
                
                // Initial sync so the extension knows the current UI state on load
                sendUpdate();

                // Cascade toggle: when a parent is (un)checked, apply same state to all descendants
                function cascadeToggle(source, checked) {
                    const children = Array.from(document.querySelectorAll('.source-toggle[data-parent="' + CSS.escape(source) + '"]'));
                    children.forEach(child => {
                        child.checked = checked;
                        const childSource = child.getAttribute('data-source');
                        cascadeToggle(childSource, checked);
                    });
                }
                // Attach event listeners for checkboxes
                document.querySelectorAll('.source-toggle').forEach(el => {
                    // Left-click (change) – cascade state to all descendants
                    el.addEventListener('change', (e) => {
                        const target = e.target;
                        const src = target.getAttribute('data-source');
                        const checked = target.checked;
                        if (src) {
                            cascadeToggle(src, checked);
                        }
                        sendUpdate();
                    });
                });
                
                // Colour pickers now require explicit Apply click
                document.querySelectorAll('.apply-color').forEach(el => {
                    el.addEventListener('click', (e) => {
                        // When Apply is clicked, we simply call sendUpdate to push the current colour value
                        sendUpdate();
                    });
                });

                document.querySelectorAll('.reset-color').forEach(el => {
                    el.addEventListener('click', (e) => {
                        const source = e.target.getAttribute('data-source');
                        const picker = document.querySelector('.source-color[data-source="' + CSS.escape(source) + '"]');
                        if (picker) {
                            picker.value = '#ffffff';
                            sendUpdate();
                        }
                    });
                });

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.type === 'rerender') {
                        const container = document.querySelector('.mermaid');
                        container.innerHTML = message.mermaidCode;
                        renderGraph();
                    }
                });
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
