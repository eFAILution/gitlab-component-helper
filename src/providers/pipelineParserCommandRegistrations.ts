import * as vscode from 'vscode';
import { PipelineParserCommand } from './pipelineParserCommand';
import { getComponentService } from '../services/component';

async function safeUpdateConfig(config: vscode.WorkspaceConfiguration, section: string, value: any, successMessage?: string) {
    try {
        await config.update(section, value, vscode.ConfigurationTarget.Workspace);
        if (successMessage) vscode.window.showInformationMessage(successMessage);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to update settings (you might be in a restricted workspace): ${error}`);
    }
}

export function registerPipelineParserCommands(context: vscode.ExtensionContext) {
    const parserCommand = new PipelineParserCommand(context);

    context.subscriptions.push(
        vscode.commands.registerCommand('gitlab-component-helper.parsePipeline', async () => {
            await parserCommand.parseAndShowTui(vscode.window.activeTextEditor?.document);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gitlab-component-helper.selectPolicyOverride', async () => {
            const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
            const projectPath = config.get<string>('projectPath', '');

            if (!projectPath) {
                vscode.window.showErrorMessage("Cannot list policies: 'gitlabComponentHelper.projectPath' is not configured.");
                return;
            }

            const gitlabUrl = config.get<string>('gitlabUrl', 'https://gitlab.com');
            const gitlabInstance = gitlabUrl.replace(/^https?:\/\//, '').split('/')[0];
            const componentService = getComponentService();
            const token = await componentService.getTokenForProject(gitlabInstance);

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Fetching available Pipeline Execution Policies (PEP)..."
            }, async () => {
                try {
                    const policies = await componentService.fetchPipelineExecutionPolicies(gitlabInstance, projectPath, token || '');

                    if (policies.length === 0) {
                        vscode.window.showInformationMessage(`No active Pipeline Execution Policies found for project '${projectPath}'.`);
                        return;
                    }

                    const selected = await vscode.window.showQuickPick(policies, {
                        placeHolder: 'Select a Pipeline Execution Policy to override as active'
                    });

                    if (selected) {
                        await safeUpdateConfig(config, 'parser.activePolicyOverride', selected, `Active Policy override set to: ${selected}`);
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to fetch policies: ${error}`);
                }
            });
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gitlab-component-helper.setProjectPath', async () => {
            const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
            const currentPath = config.get<string>('projectPath', '');

            const input = await vscode.window.showInputBox({
                prompt: 'Enter the GitLab project path (e.g., my-group/my-project)',
                value: currentPath
            });

            if (input !== undefined) {
                await safeUpdateConfig(config, 'projectPath', input, `Project path set to: ${input}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gitlab-component-helper.selectLocalPepOverride', async () => {
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                openLabel: 'Select Local Policy',
                filters: { 'YAML': ['yml', 'yaml'] }
            });

            if (uris && uris.length > 0) {
                const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
                let trustedRoot = config.get<string[]>('trustedIncludeRoot', []);

                // Remove existing absolute paths (which represent local file overrides)
                trustedRoot = trustedRoot.filter(inc => !require('path').isAbsolute(inc));

                trustedRoot.push(uris[0].fsPath);
                await safeUpdateConfig(config, 'trustedIncludeRoot', trustedRoot, `Local PEP override set to: ${uris[0].fsPath}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('gitlab-component-helper.clearPepOverrides', async () => {
            const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
            let updated = false;

            if (config.get<string>('parser.activePolicyOverride', '') !== '') {
                await safeUpdateConfig(config, 'parser.activePolicyOverride', '');
                updated = true;
            }

            let trustedRoot = config.get<string[]>('trustedIncludeRoot', []);
            const originalLength = trustedRoot.length;
            trustedRoot = trustedRoot.filter(inc => !require('path').isAbsolute(inc));

            if (trustedRoot.length !== originalLength) {
                await safeUpdateConfig(config, 'trustedIncludeRoot', trustedRoot);
                updated = true;
            }

            if (updated) {
                vscode.window.showInformationMessage('All PEP overrides cleared.');
            } else {
                vscode.window.showInformationMessage('No active PEP overrides to clear.');
            }
        })
    );
}
