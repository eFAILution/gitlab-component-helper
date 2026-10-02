// Re-records the README demo GIFs in a throwaway VS Code profile. Usage and publishing steps live in
// .ai/workflows.yaml (record_demo_gifs).
//
//   npm install && npm run record              # every scene
//   npm run record -- hover versions           # just these
import * as browse from './scenes/browse.mjs';
import * as complete from './scenes/complete.mjs';
import * as hover from './scenes/hover.mjs';
import * as validate from './scenes/validate.mjs';
import * as versions from './scenes/versions.mjs';
import { showCursor } from './lib/input.mjs';
import { Recorder, encodeGif, writeReviewSheet } from './lib/recorder.mjs';
import { launchVsCode, prepareScene, runCommand, sleep, stopVsCode, webviewFrame } from './lib/vscode.mjs';
import { installExtension, resetWorkDir } from './lib/workspace.mjs';

const SCENES = { browse, complete, hover, validate, versions };
const SOURCE_COUNT = 4;

/** Open the Component Browser once so every source is cached before the first take. */
async function warmCache(page) {
  await prepareScene(page, { content: 'include:\n' });
  await runCommand(page, 'GitLab CI: Browse Components');
  const list = await webviewFrame(page, '.source-group');
  await list.locator('.source-group').nth(SOURCE_COUNT - 1).waitFor({ timeout: 60000 });
}

async function recordScene({ page, cdp }, name) {
  const scene = SCENES[name];
  await scene.prepare(page);
  await showCursor(page, scene.cursorStart.x, scene.cursorStart.y);
  const recorder = new Recorder(cdp, name);
  await recorder.start();
  await sleep(1000);
  await scene.perform(page);
  const duration = await recorder.stop();
  const gif = encodeGif(name);
  const sheet = writeReviewSheet(name, duration);
  console.log(`${name}: ${gif} (${duration.toFixed(1)}s), review sheet ${sheet}`);
}

async function main() {
  const requested = process.argv.slice(2);
  const unknown = requested.filter((name) => !SCENES[name]);
  if (unknown.length) throw new Error(`Unknown scene(s): ${unknown.join(', ')}. Pick from ${Object.keys(SCENES).join(', ')}`);
  const names = requested.length ? requested : Object.keys(SCENES);

  resetWorkDir();
  installExtension();
  const session = await launchVsCode();
  try {
    await warmCache(session.page);
    for (const name of names) await recordScene(session, name);
  } finally {
    await stopVsCode(session);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
