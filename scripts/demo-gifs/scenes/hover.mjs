// Hover: component docs with version status, an input's docs, and an outdated pin.
import { moveTo, wordPosition } from '../lib/input.mjs';
import { prepareScene, sleep } from '../lib/vscode.mjs';

export const cursorStart = { x: 1000, y: 650 };
const REST = { x: 1000, y: 650 };
const URL_OFFSET_PX = 120;

export async function prepare(page) {
  await prepareScene(page, {
    cursorAtEnd: false,
    content: `stages:
  - validate
  - build
  - test

include:
  - component: gitlab.com/components/opentofu/validate-plan@4.9.0
    inputs:
      opentofu_version: 1.12.6
      root_dir: infra/
  - component: gitlab.com/components/sast/sast@3.3.0
    inputs:
      excluded_paths: "spec, tmp"
`,
  });
  // The version check runs on open/save, so save once to make the outdated pin's hint ready before recording.
  await page.keyboard.press('Meta+S');
  await sleep(4000);
}

async function hoverWord(page, lineText, word, { offset = 0, hold = 3500 } = {}) {
  const { x, y } = await wordPosition(page, lineText, word);
  await moveTo(page, x + offset, y, 850);
  await sleep(hold);
}

export async function perform(page) {
  await hoverWord(page, 'opentofu/validate-plan', 'gitlab.com', { offset: URL_OFFSET_PX });
  const hover = page.locator('.monaco-hover:visible .monaco-scrollable-element').first();
  const box = await hover.boundingBox();
  await moveTo(page, box.x + box.width / 2, box.y + box.height / 2, 600);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 60);
    await sleep(180);
  }
  await sleep(2000);
  await moveTo(page, REST.x, REST.y, 500);
  await sleep(600);
  await hoverWord(page, 'opentofu_version', 'opentofu_version');
  await moveTo(page, REST.x, REST.y, 500);
  await sleep(600);
  await hoverWord(page, 'sast/sast', 'gitlab.com', { offset: URL_OFFSET_PX, hold: 4000 });
  await moveTo(page, 1100, 700, 600);
  await sleep(800);
}
