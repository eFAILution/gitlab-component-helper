// Launches VS Code with a debug port and drives the workbench through Playwright over CDP.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { DEVICE_SCALE, EXTENSIONS_DIR, PROFILE_DIR, VIEWPORT, VSCODE_BIN, WORKSPACE_DIR } from './config.mjs';
import { writeWorkspaceFile } from './workspace.mjs';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const POLL_MS = 250;
const LAUNCH_ATTEMPTS = 120;

async function poll(attempt, attempts = LAUNCH_ATTEMPTS) {
  for (let i = 0; i < attempts; i++) {
    const result = await attempt().catch(() => undefined);
    if (result) return result;
    await sleep(POLL_MS);
  }
  return undefined;
}

/** Port 0 lets Chromium pick a free port and write it here, so we always attach to the copy we just started. */
async function readDebugPort() {
  const file = path.join(PROFILE_DIR, 'DevToolsActivePort');
  return poll(async () => Number(fs.readFileSync(file, 'utf8').split('\n')[0]) || undefined);
}

async function attach(child) {
  const port = await readDebugPort();
  if (!port) throw new Error('VS Code never wrote DevToolsActivePort');
  const browser = await poll(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`));
  if (!browser) throw new Error(`VS Code never answered on debug port ${port}`);
  const page = await poll(async () => browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('workbench')));
  if (!page) throw new Error('VS Code workbench window not found');
  await page.waitForSelector('.monaco-workbench', { timeout: 30000 });
  const cdp = await page.context().newCDPSession(page);
  // Emulating the viewport (instead of resizing the window) keeps every recording the same size on any screen.
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: DEVICE_SCALE, mobile: false });
  await sleep(800);
  return { browser, page, cdp, child };
}

export async function launchVsCode() {
  const child = spawn(VSCODE_BIN, [
    '--remote-debugging-port=0', `--user-data-dir=${PROFILE_DIR}`, `--extensions-dir=${EXTENSIONS_DIR}`,
    '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--new-window', WORKSPACE_DIR,
  ], { stdio: 'ignore' });
  try {
    return await attach(child);
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
}

export async function stopVsCode({ browser, child }) {
  await browser.close().catch(() => {});
  // SIGKILL because a modal dialog can make VS Code ignore SIGTERM. The profile is throwaway.
  child.kill('SIGKILL');
  await sleep(1000);
}

const focusedPaletteLabel = (page) =>
  page.evaluate(() => document.querySelector('.quick-input-list .monaco-list-row.focused')?.getAttribute('aria-label') ?? '');

/** Run a Command Palette entry, refusing to press Enter until the exact command is highlighted. */
export async function runCommand(page, name, { typeText } = {}) {
  await page.keyboard.press('Meta+Shift+P');
  await sleep(400);
  await (typeText ? typeText(name) : page.keyboard.type(name, { delay: 8 }));
  const matches = async () => (await focusedPaletteLabel(page)).toLowerCase().startsWith(name.toLowerCase());
  if (!(await poll(matches, 20))) {
    await page.keyboard.press('Escape');
    throw new Error(`Command Palette did not highlight "${name}"`);
  }
  await page.keyboard.press('Enter');
}

const isVisible = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  return !!el && el.offsetWidth > 0 && el.offsetHeight > 0;
}, selector);

/** Only toggle commands exist for some parts, so check visibility first to make the result deterministic. */
async function hidePart(page, selector, commandName) {
  if (!(await isVisible(page, selector))) return;
  await runCommand(page, commandName);
  await sleep(400);
}

async function closeEverything(page) {
  const MAX_EDITORS = 6;
  for (let i = 0; i < MAX_EDITORS; i++) {
    const closed = await runCommand(page, 'View: Revert and Close Editor').then(() => true, () => false);
    if (!closed) break;
    await sleep(300);
  }
  await runCommand(page, 'View: Close All Editors');
  await sleep(500);
  await page.keyboard.press('Escape');
}

export async function openFile(page, relativePath) {
  await page.keyboard.press('Meta+P');
  await sleep(300);
  await page.keyboard.type(relativePath, { delay: 5 });
  await sleep(600);
  await page.keyboard.press('Enter');
  await sleep(800);
}

/** Start each scene from a clean editor: no open tabs, no side bars or panel, one freshly written file. */
export async function prepareScene(page, { file = '.gitlab-ci.yml', content, cursorAtEnd = true }) {
  await closeEverything(page);
  await hidePart(page, '.part.sidebar', 'View: Toggle Primary Side Bar Visibility');
  await hidePart(page, '.part.auxiliarybar', 'View: Hide Secondary Side Bar');
  await hidePart(page, '.part.panel', 'View: Toggle Panel Visibility');
  writeWorkspaceFile(file, content);
  await openFile(page, file);
  if (cursorAtEnd) await page.keyboard.press('Meta+ArrowDown');
  await sleep(2500);
}

/** Webviews are out-of-process iframes; return the newest live one that contains `selector`. */
export async function webviewFrame(page, selector) {
  const find = async () => {
    const live = page.frames().filter((f) => f.url().includes('fake.html') && !f.isDetached());
    const counts = await Promise.all(live.map((f) => f.locator(selector).count().catch(() => 0)));
    return live.filter((_, i) => counts[i] > 0).at(-1);
  };
  const frame = await poll(find, 80);
  if (!frame) throw new Error(`No webview contains ${selector}`);
  return frame;
}
