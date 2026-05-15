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
exports.registerAddProjectTokenCommand = registerAddProjectTokenCommand;
const vscode = __importStar(require("vscode"));
/**
 * Register the command to add a GitLab project token
 * This allows users to add authentication for private GitLab projects/groups
 */
function registerAddProjectTokenCommand(context, service) {
    context.subscriptions.push(vscode.commands.registerCommand('gitlabComponentHelper.addProjectToken', async () => {
        // Prompt for the full GitLab URL
        const url = await vscode.window.showInputBox({
            prompt: 'Enter the full GitLab project or group URL (e.g. https://gitlab.com/mygroup/myproject)',
            ignoreFocusOut: true,
            placeHolder: 'https://gitlab.com/mygroup/myproject'
        });
        if (!url)
            return;
        let gitlabInstance = '';
        let projectPath = '';
        try {
            const parsed = new URL(url);
            gitlabInstance = parsed.hostname;
            // Remove leading/trailing slashes and join path
            projectPath = parsed.pathname.replace(/^\/+|\/+$/g, '');
            if (!gitlabInstance || !projectPath)
                throw new Error('Invalid URL');
        }
        catch (e) {
            vscode.window.showErrorMessage('Invalid GitLab URL. Please enter a valid project or group URL.');
            return;
        }
        // Prompt for token (optional)
        const token = await vscode.window.showInputBox({
            prompt: `Enter GitLab personal access token for ${gitlabInstance} (leave blank for public access)`,
            password: true,
            ignoreFocusOut: true
        });
        if (token === undefined)
            return; // User cancelled
        // Add to component sources as a proper object
        const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
        const componentSources = config.get('componentSources', []);
        // Check if this source already exists
        const existingSource = componentSources.find((source) => source.path === projectPath && source.gitlabInstance === gitlabInstance);
        let displayName;
        let type;
        // Try to determine type from path
        const pathSegments = projectPath.split('/').filter(Boolean);
        if (pathSegments.length === 1) {
            type = 'group';
        }
        else if (pathSegments.length > 1) {
            // Ambiguous, ask user
            const typePick = await vscode.window.showQuickPick([
                { label: 'Project', value: 'project', description: 'A single GitLab project' },
                { label: 'Group', value: 'group', description: 'A GitLab group containing multiple projects' }
            ], {
                placeHolder: 'Is this a group or a project?',
                ignoreFocusOut: true
            });
            if (!typePick)
                return; // User cancelled
            type = typePick.value;
        }
        else {
            // Fallback
            type = 'project';
        }
        if (!existingSource) {
            // Prompt for a display name
            const inputDisplayName = await vscode.window.showInputBox({
                prompt: 'Enter a display name for this component source',
                value: projectPath.split('/').pop() || projectPath,
                ignoreFocusOut: true
            });
            if (!inputDisplayName)
                return; // User cancelled
            displayName = inputDisplayName;
            const newSource = {
                name: displayName,
                path: projectPath,
                gitlabInstance: gitlabInstance,
                type: type
            };
            componentSources.push(newSource);
            await config.update('componentSources', componentSources, vscode.ConfigurationTarget.Global);
        }
        else {
            displayName = existingSource.name;
        }
        // Store the token if provided
        if (token && token.trim()) {
            try {
                if (!service['tokenManager']) {
                    service.setSecretStorage(context.secrets);
                }
                await service.setTokenForProject(gitlabInstance, projectPath, token.trim());
                vscode.window.showInformationMessage(`Component source "${displayName}" added successfully with token for ${gitlabInstance}!`);
            }
            catch (e) {
                vscode.window.showErrorMessage(`Failed to save token: ${e}`);
            }
        }
        else {
            vscode.window.showInformationMessage(`Component source "${displayName}" added successfully! Public access will be used.`);
        }
    }));
}
//# sourceMappingURL=commands.js.map