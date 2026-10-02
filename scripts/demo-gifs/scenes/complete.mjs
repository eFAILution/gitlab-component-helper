// Completion: component names after `component:`, then the version list after `@`.
import { typeSlow } from '../lib/input.mjs';
import { prepareScene, sleep } from '../lib/vscode.mjs';

export const cursorStart = { x: 1100, y: 640 };

export async function prepare(page) {
  await prepareScene(page, { content: 'stages:\n  - validate\n  - build\n  - deploy\n\ninclude:\n' });
}

async function press(page, key, times = 1, gap = 90) {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await sleep(gap);
  }
}

export async function perform(page) {
  await typeSlow(page, '  - component: ', 75);
  await sleep(1800);
  await typeSlow(page, 'plan', 160);
  await sleep(1800);
  await press(page, 'ArrowDown', 1, 500);
  await press(page, 'ArrowUp', 1, 700);
  await page.keyboard.press('Enter');
  await sleep(1500);
  // Drop the version that came with the suggestion to show the version picker.
  await press(page, 'Backspace', 5);
  await sleep(600);
  await page.keyboard.press('Control+Space');
  await sleep(1800);
  await press(page, 'ArrowDown', 1, 450);
  await press(page, 'ArrowUp', 1, 600);
  await page.keyboard.press('Enter');
  await sleep(1200);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  // Auto-indent already lines the new entry up under the first one.
  await typeSlow(page, '- component: ', 60);
  await sleep(1200);
  await typeSlow(page, 'secret', 140);
  await sleep(1300);
  await page.keyboard.press('Enter');
  await sleep(2500);
}
