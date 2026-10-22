import type * as vscode from 'vscode';
import type { SecretsPort } from '../../core/ports';

export function createVscodeSecrets(secrets: vscode.SecretStorage): SecretsPort {
  return {
    get: async (key) => secrets.get(key),
    store: async (key, value) => secrets.store(key, value),
  };
}
