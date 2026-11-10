import * as vscode from 'vscode';
import { CONFIG_SECTION } from '../../core/config/defaults';
import type { ConfigPort } from '../../core/ports';

/** Reads settings live from the workspace configuration, so changes apply without a reload. */
export function createVscodeConfig(): ConfigPort {
  return {
    get: (key, fallback) => vscode.workspace.getConfiguration(CONFIG_SECTION).get(key, fallback),
  };
}
