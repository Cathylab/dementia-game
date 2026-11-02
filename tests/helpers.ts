import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import type { Script } from '../src/types';

export const TEST_SCRIPT = readFileSync(new URL('./fixtures/test-script.json', import.meta.url), 'utf8');

/** 讀一份新的測試腳本物件（可以自由修改）。 */
export function testScript(): Script {
  return JSON.parse(TEST_SCRIPT) as Script;
}

/**
 * 讓文字瞬間顯示，並用測試腳本取代 public/script.json。
 * mutate 可以在送出前修改腳本；settings 可以覆寫預先存好的設定。
 */
export async function openWithTestScript(
  page: Page,
  query = 'timescale=0.2',
  opts: { mutate?: (s: Script) => void; settings?: Record<string, unknown> } = {},
): Promise<void> {
  const settings = { textSpeed: 100, volume: 0.2, ...opts.settings };
  await page.addInitScript((value) => {
    localStorage.setItem('dementia-vn-settings', value);
  }, JSON.stringify(settings));
  const script = testScript();
  opts.mutate?.(script);
  const body = JSON.stringify(script);
  await page.route('**/script.json', (route) => route.fulfill({ contentType: 'application/json', body }));
  await page.goto(`./?${query}`);
  await expect(page.locator('.title-screen h1')).toHaveText('測試腳本');
}

/** 透過開發者面板跳到指定場景，然後關掉面板。 */
export async function jumpTo(page: Page, sceneId: string): Promise<void> {
  const panel = page.locator('.devpanel');
  if (!(await panel.evaluate((n) => n.classList.contains('open')))) await page.keyboard.press('Backquote');
  await expect(panel).toBeVisible();
  await page.selectOption('select[name=dev-scene]', sceneId);
  await page.click('[data-dev=jump]');
  await page.keyboard.press('Backquote');
  await expect(panel).toBeHidden();
  await expect(page.locator('#stage')).toHaveAttribute('data-scene', sceneId);
  await expect(page.locator('#stage')).toHaveAttribute('data-blink', 'open');
}

/** 點一下畫面（推進台詞）。 */
export async function advance(page: Page): Promise<void> {
  // 點在台詞區：它疊在物件與背景上方，不會誤點到物件
  const box = (await page.locator('#stage').boundingBox())!;
  await page.locator('#stage').click({ position: { x: box.width * 0.15, y: box.height * 0.86 } });
}

/** 按「開始」並等到第一句出現。 */
export async function startGame(page: Page): Promise<void> {
  await page.click('.start-button');
  await expect(page.locator('#stage')).toHaveAttribute('data-phase', /text|choice/);
  await expect(page.locator('#stage')).toHaveAttribute('data-blink', 'open');
}

/** 目前台詞（一般台詞或內心獨白）的文字。 */
export function currentText(page: Page) {
  return page.locator('#stage:not(.monologue-on) .dialog .text, #stage.monologue-on .monologue-text');
}


/** 讀引擎的狀態欄位（例如 flags、seen、index）。 */
export function engineValue<T>(page: Page, key: string): Promise<T> {
  return page.evaluate((k) => (window as unknown as { __vn: { engine: Record<string, unknown> } }).__vn.engine[k], key) as Promise<T>;
}
