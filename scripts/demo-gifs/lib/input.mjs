// Mouse, keyboard, and a drawn cursor. The screencast doesn't capture the OS pointer, so the scripts draw their own
// in the top document (above the webview iframes) and move it in step with Playwright's synthetic mouse.
import { VIEWPORT } from './config.mjs';
import { sleep } from './vscode.mjs';

const CURSOR_ID = 'demo-cursor';
const CURSOR_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='22' height='28' viewBox='0 0 22 28'><path d='M2 2 L2 22 L7.5 17 L11 25 L14.5 23.5 L11 15.8 L18 15.8 Z' fill='white' stroke='black' stroke-width='1.6' stroke-linejoin='round'/></svg>";
const FRAME_MS = 16;
const TOP_SAFE_PX = 90;

let cursor = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

export async function showCursor(page, x, y) {
  await page.evaluate(({ id, svg, x, y }) => {
    document.getElementById(id)?.remove();
    const el = document.createElement('div');
    el.id = id;
    el.style.cssText = `position:fixed;left:0;top:0;width:22px;height:28px;z-index:2147483647;pointer-events:none;transform:translate(${x}px,${y}px);background:url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") no-repeat`;
    document.body.appendChild(el);
  }, { id: CURSOR_ID, svg: CURSOR_SVG, x, y });
  cursor = { x, y };
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export async function moveTo(page, x, y, ms = 500) {
  const steps = Math.max(8, Math.round(ms / FRAME_MS));
  const from = cursor;
  for (let i = 1; i <= steps; i++) {
    const e = easeInOut(i / steps);
    const point = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e };
    await page.evaluate(({ id, point }) => {
      const el = document.getElementById(id);
      if (el) el.style.transform = `translate(${point.x}px,${point.y}px)`;
    }, { id: CURSOR_ID, point });
    await page.mouse.move(point.x, point.y);
    await sleep(ms / steps);
  }
  cursor = { x, y };
}

export async function centerOf(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Element has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function clickOn(page, locator, { ms = 600, pause = 250 } = {}) {
  const { x, y } = await centerOf(locator);
  await moveTo(page, x, y, ms);
  await sleep(pause);
  await page.mouse.click(x, y);
}

/** Middle of `word` on the first editor line containing `lineText`. */
export async function wordPosition(page, lineText, word) {
  const line = page.locator('.view-line', { hasText: lineText }).first();
  return centerOf(line.locator('span span', { hasText: word }).first());
}

/** Type with a little jitter so it reads as a person typing. */
export async function typeSlow(page, text, delay = 70) {
  for (const ch of text) {
    await (ch === '\n' ? page.keyboard.press('Enter') : page.keyboard.type(ch));
    await sleep(delay + Math.random() * 30);
  }
}

export async function wheel(page, deltaY, { steps = 10, ms = 600 } = {}) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, deltaY / steps);
    await sleep(ms / steps);
  }
}

/** Scroll the pane under `x` with the wheel until `locator` is on screen, the way a person would. */
export async function scrollIntoView(page, locator, x, { margin = 40 } = {}) {
  const MAX_SCROLLS = 12;
  for (let i = 0; i < MAX_SCROLLS; i++) {
    const box = await locator.boundingBox();
    if (box && box.y > TOP_SAFE_PX && box.y + box.height < VIEWPORT.height - margin) return;
    await moveTo(page, x, VIEWPORT.height / 2, 250);
    await wheel(page, box && box.y < TOP_SAFE_PX ? -200 : 200, { steps: 6, ms: 300 });
  }
}
