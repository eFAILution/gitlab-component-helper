// Builds the throwaway VS Code profile and demo workspace. Nothing here touches the user's own VS Code setup.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  DEMO_DIR, EXTENSIONS_DIR, FIXTURES_DIR, PROFILE_DIR, REPO_ROOT, VSCODE_CLI, VSIX_PATH, WORK_DIR, WORKSPACE_DIR,
} from './config.mjs';

export function resetWorkDir() {
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(PROFILE_DIR, 'User'), { recursive: true });
  fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  fs.copyFileSync(path.join(FIXTURES_DIR, 'settings.json'), path.join(PROFILE_DIR, 'User', 'settings.json'));
  fs.cpSync(path.join(FIXTURES_DIR, 'templates'), path.join(WORKSPACE_DIR, 'templates'), { recursive: true });
}

/** Package the extension as Marketplace users get it, so the window title has no "[Extension Development Host]". */
export function installExtension() {
  const vsce = path.join(DEMO_DIR, 'node_modules', '.bin', 'vsce');
  execFileSync(vsce, ['package', '--no-dependencies', '-o', VSIX_PATH], { cwd: REPO_ROOT, stdio: 'inherit' });
  execFileSync(VSCODE_CLI, [
    `--user-data-dir=${PROFILE_DIR}`, `--extensions-dir=${EXTENSIONS_DIR}`, '--install-extension', VSIX_PATH,
  ], { stdio: 'inherit' });
}

export function readFixtureSettings() {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'settings.json'), 'utf8'));
}

export function writeWorkspaceFile(relativePath, content) {
  const target = path.join(WORKSPACE_DIR, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
