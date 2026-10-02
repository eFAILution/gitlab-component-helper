// Version upgrades: hover an outdated pin, Quick Fix it, then update the rest from the Command Palette.
import { moveTo, typeSlow, wordPosition } from '../lib/input.mjs';
import { prepareScene, runCommand, sleep } from '../lib/vscode.mjs';

export const cursorStart = { x: 1100, y: 650 };

export async function prepare(page) {
  await prepareScene(page, {
    cursorAtEnd: false,
    content: `stages:
  - validate
  - build
  - test
  - deploy

include:
  - component: gitlab.com/components/opentofu/validate-plan-apply@4.6.0
  - component: gitlab.com/components/sast/sast@3.3.0
  - component: gitlab.com/components/secret-detection/secret-detection@2.1.0
  - component: gitlab.com/components/code-quality/code-quality@1.0.6
`,
  });
  await page.keyboard.press('Meta+S');
  await sleep(5000);
}

export async function perform(page) {
  const pin = await wordPosition(page, 'sast/sast', '3.3.0');
  await moveTo(page, pin.x, pin.y, 900);
  await sleep(3800);
  await page.mouse.click(pin.x, pin.y);
  await sleep(300);
  await page.keyboard.press('Meta+.');
  await sleep(1700);
  await page.keyboard.press('Enter');
  await sleep(1200);
  await moveTo(page, 1100, 650, 600);
  await sleep(800);
  await runCommand(page, 'GitLab CI: Update All Component Versions to Latest', { typeText: (t) => typeSlow(page, t, 45) });
  await sleep(3500);
  await page.keyboard.press('Meta+S');
  await sleep(2500);
}
