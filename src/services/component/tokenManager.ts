import { Emitter, type Disposable } from '../../core/emitter';
import { getRuntime } from '../../core/runtime';
import { Logger } from '../../utils/logger';

/**
 * Storage key for the list of GitLab instances that have a stored token. Secret stores can't be enumerated, so hosts
 * that need to know which instances have tokens (the MCP launcher) read this list instead.
 */
export const TOKEN_INSTANCES_KEY = 'gitlab-token-instances';

function tokenKey(gitlabInstance: string): string {
  return `gitlab-token-${gitlabInstance}`;
}

/**
 * Manages GitLab personal access tokens through the runtime's secrets port (VS Code SecretStorage in the extension)
 */
export class TokenManager implements Disposable {
  private logger = Logger.getInstance();

  private readonly onDidChangeTokenEmitter = new Emitter<string>();
  /**
   * Fires after a token is stored for a GitLab instance, with the instance hostname. Lets consumers
   * (e.g. the validation provider) re-run work that previously failed for lack of a valid token.
   */
  public readonly onDidChangeToken = this.onDidChangeTokenEmitter.event;

  public dispose(): void {
    this.onDidChangeTokenEmitter.dispose();
  }

  /**
   * Get token for a specific GitLab instance
   * @param gitlabInstance The GitLab instance hostname (e.g., 'gitlab.com')
   */
  public async getTokenForProject(gitlabInstance: string): Promise<string | undefined> {
    const key = tokenKey(gitlabInstance);
    this.logger.debug(`Looking for token with key: ${key}`);
    const token = await getRuntime().secrets.get(key);
    this.logger.debug(`Found token for ${gitlabInstance}: ${token ? 'YES' : 'NO'}`);
    return token;
  }

  /**
   * Store token for a specific GitLab instance
   * @param gitlabInstance The GitLab instance hostname
   * @param token The personal access token to store
   */
  public async setTokenForProject(gitlabInstance: string, token: string): Promise<void> {
    const { secrets } = getRuntime();
    if (!secrets.store) {
      throw new Error('SecretStorage not available');
    }
    const key = tokenKey(gitlabInstance);
    this.logger.debug(`Storing token with key: ${key}`);
    await secrets.store(key, token);
    await this.recordTokenInstance(gitlabInstance);
    this.logger.debug(`Token stored successfully for ${gitlabInstance}`);
    this.onDidChangeTokenEmitter.fire(gitlabInstance);
  }

  /**
   * Get token for any GitLab instance (convenience method)
   * @param gitlabInstance The GitLab instance hostname
   */
  public async getTokenForInstance(gitlabInstance: string): Promise<string | undefined> {
    return getRuntime().secrets.get(tokenKey(gitlabInstance));
  }

  /** The GitLab instances a token has been stored for, in the order they were first stored. */
  public async getTokenInstances(): Promise<string[]> {
    const instances = await getRuntime().storage.get<unknown>(TOKEN_INSTANCES_KEY);
    return Array.isArray(instances) ? instances.filter((item): item is string => typeof item === 'string') : [];
  }

  private async recordTokenInstance(gitlabInstance: string): Promise<void> {
    const instances = await this.getTokenInstances();
    if (instances.includes(gitlabInstance)) return;
    await getRuntime().storage.update(TOKEN_INSTANCES_KEY, [...instances, gitlabInstance]);
  }
}
