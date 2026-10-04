import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEMO_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const REPO_ROOT = path.resolve(DEMO_DIR, '../..');
export const FIXTURES_DIR = path.join(DEMO_DIR, 'fixtures');
export const OUT_DIR = path.join(DEMO_DIR, 'out');

const WORK_DIR_PREFIX = 'gch-demo';

/** The work dir is wiped on every run, so only accept a folder whose own name marks it as ours. */
function resolveWorkDir(requested) {
  const dir = path.resolve(requested);
  const isOurs = path.basename(dir).startsWith(WORK_DIR_PREFIX);
  const holdsSomethingPrecious = [os.homedir(), REPO_ROOT].some((p) => !path.relative(dir, p).startsWith('..'));
  if (!isOurs || holdsSomethingPrecious) {
    throw new Error(`GCH_DEMO_DIR must be a throwaway folder named ${WORK_DIR_PREFIX}*, got ${dir}`);
  }
  return dir;
}

// VS Code's IPC socket lives in the profile and its path must stay under ~103 characters, so keep this short.
export const WORK_DIR = resolveWorkDir(process.env.GCH_DEMO_DIR ?? '/tmp/gch-demo');
export const PROFILE_DIR = path.join(WORK_DIR, 'profile');
export const EXTENSIONS_DIR = path.join(WORK_DIR, 'extensions');
// The folder name shows in the window title, so it doubles as the demo's project name.
export const WORKSPACE_DIR = path.join(WORK_DIR, 'my-pipelines');
export const FRAMES_DIR = path.join(WORK_DIR, 'frames');
export const VSIX_PATH = path.join(WORK_DIR, 'extension.vsix');

const VSCODE_APP = '/Applications/Visual Studio Code.app/Contents';
export const VSCODE_BIN = process.env.VSCODE_BIN ?? `${VSCODE_APP}/MacOS/Code`;
export const VSCODE_CLI = process.env.VSCODE_CLI ?? `${VSCODE_APP}/Resources/app/bin/code`;

export const VIEWPORT = { width: 1280, height: 800 };
export const DEVICE_SCALE = 2;
export const GIF = { width: 1100, fps: 12, colors: 192 };
