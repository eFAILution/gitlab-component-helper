import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Attempts to extract the GitLab project path (e.g. group/subgroup/project)
 * by finding the nearest .git/config file and parsing the origin remote URL.
 */
export async function getProjectPathFromLocalFile(filePath: string): Promise<string | undefined> {
    try {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
        if (!workspaceFolder) {
            return undefined;
        }

        const gitConfigPath = path.join(workspaceFolder.uri.fsPath, '.git', 'config');
        if (!fs.existsSync(gitConfigPath)) {
            return undefined;
        }

        const configContent = await fs.promises.readFile(gitConfigPath, 'utf8');
        
        // Find [remote "origin"] block
        const originMatch = configContent.match(/\[remote\s+"origin"\][\s\S]*?url\s*=\s*(.+)/);
        if (!originMatch || !originMatch[1]) {
            return undefined;
        }

        const remoteUrl = originMatch[1].trim();

        // Extract path from various git URL formats
        // SSH: git@gitlab.com:group/project.git
        // HTTPS: https://gitlab.com/group/project.git
        // SSH with protocol: ssh://git@gitlab.com/group/project.git

        let projectPath = '';

        if (remoteUrl.startsWith('http://') || remoteUrl.startsWith('https://')) {
            try {
                const urlObj = new URL(remoteUrl);
                projectPath = urlObj.pathname;
            } catch {
                return undefined;
            }
        } else if (remoteUrl.startsWith('ssh://')) {
            try {
                const urlObj = new URL(remoteUrl);
                projectPath = urlObj.pathname;
            } catch {
                return undefined;
            }
        } else if (remoteUrl.includes(':')) {
            // git@gitlab.com:group/project.git
            projectPath = remoteUrl.split(':')[1];
        } else {
            return undefined;
        }

        // Clean up the path (remove leading slash and trailing .git)
        projectPath = projectPath.replace(/^\/+/, '');
        if (projectPath.endsWith('.git')) {
            projectPath = projectPath.slice(0, -4);
        }

        return projectPath;
    } catch (e) {
        // Silently fail if we can't read the file or parse it
        return undefined;
    }
}
