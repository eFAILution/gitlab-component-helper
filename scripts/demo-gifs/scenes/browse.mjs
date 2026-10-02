// Component Browser: search, open details, pick inputs, insert, then show the result full width.
import { centerOf, clickOn, moveTo, scrollIntoView, typeSlow } from '../lib/input.mjs';
import { prepareScene, runCommand, sleep, webviewFrame } from '../lib/vscode.mjs';

export const cursorStart = { x: 700, y: 520 };

export async function prepare(page) {
  await prepareScene(page, { content: 'stages:\n  - test\n\ninclude:\n' });
}

const tabClose = (page, label) => page.locator(`.tab[aria-label^="${label}"] .tab-actions .action-label`).first();

export async function perform(page) {
  await runCommand(page, 'GitLab CI: Browse Components', { typeText: (t) => typeSlow(page, t, 45) });
  const list = await webviewFrame(page, '#search');
  await sleep(1500);
  await clickOn(page, list.locator('#search'));
  await typeSlow(page, 'secret', 110);
  await sleep(1500);
  await clickOn(page, list.locator('.component-card[data-name="secret-detection"] [data-action="viewDetails"]'));
  const details = await webviewFrame(page, '#parametersContainer .parameter');
  await sleep(1500);
  // Closing the list leaves editor | details side by side, which reads better than three narrow columns.
  await clickOn(page, tabClose(page, 'GitLab CI/CD Components'), { ms: 700 });
  await moveTo(page, 900, 300, 400);
  await sleep(1100);
  const panelX = (await centerOf(details.locator('#componentName'))).x;
  for (const input of ['stage', 'historic_scan', 'excluded_paths']) {
    const checkbox = details.locator(`#input-${input}`);
    await scrollIntoView(page, checkbox, panelX);
    await clickOn(page, checkbox, { ms: 450 });
    await sleep(450);
  }
  const insert = details.locator('button[data-action="insertComponent"]');
  await scrollIntoView(page, insert, panelX);
  await sleep(400);
  await clickOn(page, insert);
  await sleep(2200);
  await clickOn(page, tabClose(page, 'Component: secret-detection'), { ms: 800 });
  await moveTo(page, 820, 520, 500);
  await sleep(3000);
}
