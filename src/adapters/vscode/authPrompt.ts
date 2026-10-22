import * as vscode from 'vscode';
import type { AuthPromptPort } from '../../core/ports';

export type SaveToken = (gitlabInstance: string, token: string) => Promise<void>;

/**
 * Prompt the user for a GitLab personal access token after a 401/403.
 *
 * The two reasons we reach a 401 need different wording: a stored token that GitLab rejected
 * (expired/invalid — *replace* it) versus no token at all (private source needs *first-time* auth).
 *
 * @param saveToken Stores the entered token, keyed by the GitLab instance.
 * @returns A port whose `promptForToken` resolves to the trimmed token if the user entered one (also persisted),
 *          or `undefined` if they left it blank (public access) or dismissed the prompt.
 */
export function createVscodeAuthPrompt(saveToken: SaveToken): AuthPromptPort {
  return {
    promptForToken: async (gitlabInstance, hadToken) => {
      const tokenPrompt = hadToken
        ? `Your GitLab token for ${gitlabInstance} is invalid or has expired. Enter a new personal access token (needs the read_api scope) to continue.`
        : `This project/group requires a GitLab personal access token for ${gitlabInstance} (needs the read_api scope). Enter one to continue, or leave blank for public access.`;
      const token = await vscode.window.showInputBox({
        title: 'GitLab Component Helper',
        prompt: tokenPrompt,
        placeHolder: hadToken ? 'New personal access token' : 'Personal access token (blank for public access)',
        password: true,
        ignoreFocusOut: true
      });
      if (token && token.trim()) {
        await saveToken(gitlabInstance, token.trim());
        vscode.window.showInformationMessage(`GitLab Component Helper: token saved for ${gitlabInstance}`);
        return token.trim();
      } else if (token === '') {
        vscode.window.showInformationMessage('GitLab Component Helper: no token entered. Public access will be used.');
        return undefined;
      }
      return undefined;
    },
  };
}
