import * as vscode from 'vscode';
import { ComponentService } from './componentService';

/**
 * Register the command to add a GitLab project token
 * This allows users to add authentication for private GitLab projects/groups
 */
export function registerAddProjectTokenCommand(
  context: vscode.ExtensionContext,
  service: ComponentService
) {
  context.subscriptions.push(
    vscode.commands.registerCommand('gitlabComponentHelper.addProjectToken', async () => {
      // Prompt for the full GitLab URL
      const url = await vscode.window.showInputBox({
        prompt: 'Enter the full GitLab project or group URL (e.g. https://gitlab.com/mygroup/myproject)',
        ignoreFocusOut: true,
        placeHolder: 'https://gitlab.com/mygroup/myproject'
      });
      if (!url) return;

      let gitlabInstance = '';
      let projectPath = '';
      try {
        const parsed = new URL(url);
        gitlabInstance = parsed.hostname;
        // Remove leading/trailing slashes and join path
        projectPath = parsed.pathname.replace(/^\/+|\/+$/g, '');
        if (!gitlabInstance || !projectPath) throw new Error('Invalid URL');
      } catch (e) {
        vscode.window.showErrorMessage('Invalid GitLab URL. Please enter a valid project or group URL.');
        return;
      }

      // Prompt for token (optional)
      const token = await vscode.window.showInputBox({
        prompt: `Enter GitLab personal access token for ${gitlabInstance} (leave blank for public access)`,
        password: true,
        ignoreFocusOut: true
      });
      if (token === undefined) return; // User cancelled

      // Add to component sources as a proper object
      const config = vscode.workspace.getConfiguration('gitlabComponentHelper');
      const componentSources: any[] = config.get('componentSources', []);

      // Check if this source already exists
      const existingSource = componentSources.find(
        (source) => source.path === projectPath && source.gitlabInstance === gitlabInstance
      );

      let displayName: string;
      let type: 'group' | 'project';

      // Try to determine type from path
      const pathSegments = projectPath.split('/').filter(Boolean);
      if (pathSegments.length === 1) {
        type = 'group';
      } else if (pathSegments.length > 1) {
        // Ambiguous, ask user
        const typePick = await vscode.window.showQuickPick(
          [
            { label: 'Project', value: 'project', description: 'A single GitLab project' },
            { label: 'Group', value: 'group', description: 'A GitLab group containing multiple projects' }
          ],
          {
            placeHolder: 'Is this a group or a project?',
            ignoreFocusOut: true
          }
        );
        if (!typePick) return; // User cancelled
        type = typePick.value as 'group' | 'project';
      } else {
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

        if (!inputDisplayName) return; // User cancelled

        displayName = inputDisplayName;

        const newSource = {
          name: displayName,
          path: projectPath,
          gitlabInstance: gitlabInstance,
          type: type
        };

        componentSources.push(newSource);
        await config.update('componentSources', componentSources, vscode.ConfigurationTarget.Global);
      } else {
        displayName = existingSource.name;
      }

      // Store the token if provided
      if (token && token.trim()) {
        try {
          if (!service['tokenManager']) {
            service.setSecretStorage(context.secrets);
          }
          await service.setTokenForProject(gitlabInstance, projectPath, token.trim());
          vscode.window.showInformationMessage(
            `Component source "${displayName}" added successfully with token for ${gitlabInstance}!`
          );
        } catch (e) {
          vscode.window.showErrorMessage(`Failed to save token: ${e}`);
        }
      } else {
        vscode.window.showInformationMessage(
          `Component source "${displayName}" added successfully! Public access will be used.`
        );
      }
    })
  );
}
