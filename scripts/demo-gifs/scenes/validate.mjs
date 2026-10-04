// Input checks: Quick Fix a mistyped remote input, then fill a local template's inputs until its error clears.
import { moveTo, typeSlow, wordPosition } from '../lib/input.mjs';
import { prepareScene, sleep } from '../lib/vscode.mjs';

export const cursorStart = { x: 1100, y: 650 };
const REST = { x: 1100, y: 650 };

export async function prepare(page) {
  await prepareScene(page, {
    content: `stages:
  - test
  - deploy

include:
  - component: gitlab.com/components/sast/sast@3.5.0
    inputs:
      excluded_path: "spec, tmp"
`,
  });
  await page.keyboard.press('Meta+S');
  await sleep(3000);
}

async function pickSuggestion(page, downPresses) {
  await page.keyboard.press('Control+Space');
  await sleep(1500);
  for (let i = 0; i < downPresses; i++) {
    await page.keyboard.press('ArrowDown');
    await sleep(550);
  }
  await page.keyboard.press('Enter');
  await sleep(500);
}

async function fixTypo(page) {
  const typo = await wordPosition(page, 'excluded_path', 'excluded_path');
  await moveTo(page, typo.x, typo.y, 900);
  await sleep(2800);
  await page.mouse.click(typo.x, typo.y);
  await sleep(300);
  await page.keyboard.press('Meta+.');
  await sleep(1500);
  // The suggestions aren't ranked yet (#333), so walk down to `excluded_paths`.
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('ArrowDown');
    await sleep(500);
  }
  await sleep(500);
  await page.keyboard.press('Enter');
  await moveTo(page, REST.x, REST.y, 500);
  await sleep(1200);
}

export async function perform(page) {
  await fixTypo(page);
  await page.keyboard.press('Meta+ArrowDown');
  await typeSlow(page, '  - local: templates/deploy.yml', 55);
  await page.keyboard.press('Enter');
  await typeSlow(page, '  inputs:', 60);
  await page.keyboard.press('Enter');
  await typeSlow(page, '  ', 60);
  await pickSuggestion(page, 1); // environment
  await pickSuggestion(page, 1); // production
  await page.keyboard.press('Meta+S');
  await sleep(2000);
  const local = await wordPosition(page, 'local:', 'templates/deploy.yml');
  await moveTo(page, local.x, local.y, 900);
  await sleep(3500);
  await moveTo(page, REST.x, REST.y, 500);
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await pickSuggestion(page, 0); // app_name, the only missing input left
  await typeSlow(page, 'billing-api', 90);
  await page.keyboard.press('Meta+S');
  await sleep(3000);
}
