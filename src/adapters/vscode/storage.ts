import type * as vscode from 'vscode';
import type { StoragePort } from '../../core/ports';

export function createVscodeStorage(memento: vscode.Memento): StoragePort {
  return {
    get: async <T>(key: string) => memento.get<T>(key),
    update: async (key, value) => memento.update(key, value),
  };
}
