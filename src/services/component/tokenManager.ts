import * as vscode from 'vscode';
import { Logger } from '../../utils/logger';

/**
 * Manages GitLab personal access tokens using VS Code's SecretStorage
 */
export class TokenManager {
  private logger = Logger.getInstance();
  private secretStorage: vscode.SecretStorage | undefined;

  private readonly onDidChangeTokenEmitter = new vscode.EventEmitter<string>();
  /**
   * Fires after a token is stored for a GitLab instance, with the instance hostname. Lets consumers
   * (e.g. the validation provider) re-run work that previously failed for lack of a valid token.
   */
  public readonly onDidChangeToken = this.onDidChangeTokenEmitter.event;

  constructor() {}

  public setSecretStorage(secretStorage: vscode.SecretStorage): void {
    this.secretStorage = secretStorage;
  }

  /**
   * Get token for a specific GitLab instance
   * @param gitlabInstance The GitLab instance hostname (e.g., 'gitlab.com')
   */
  public async getTokenForProject(gitlabInstance: string): Promise<string | undefined> {
    if (!this.secretStorage) {
      this.logger.debug(`No secretStorage available for ${gitlabInstance}`);
      return undefined;
    }
    const key = `gitlab-token-${gitlabInstance}`;
    this.logger.debug(`Looking for token with key: ${key}`);
    const token = await this.secretStorage.get(key);
    this.logger.debug(`Found token for ${gitlabInstance}: ${token ? 'YES' : 'NO'}`);
    return token;
  }

  /**
   * Store token for a specific GitLab instance
   * @param gitlabInstance The GitLab instance hostname
   * @param token The personal access token to store
   */
  public async setTokenForProject(gitlabInstance: string, token: string): Promise<void> {
    if (!this.secretStorage) {
      throw new Error('SecretStorage not available');
    }
    const key = `gitlab-token-${gitlabInstance}`;
    this.logger.debug(`Storing token with key: ${key}`);
    await this.secretStorage.store(key, token);
    this.logger.debug(`Token stored successfully for ${gitlabInstance}`);
    this.onDidChangeTokenEmitter.fire(gitlabInstance);
  }

  /**
   * Get token for any GitLab instance (convenience method)
   * @param gitlabInstance The GitLab instance hostname
   */
  public async getTokenForInstance(gitlabInstance: string): Promise<string | undefined> {
    if (!this.secretStorage) {
      return undefined;
    }
    const key = `gitlab-token-${gitlabInstance}`;
    return await this.secretStorage.get(key);
  }
}
