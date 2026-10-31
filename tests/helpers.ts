import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

export const TEST_SCRIPT = readFileSync(new URL('./fixtures/test-script.json', import.meta.url), 'utf8');

/** 讓文字瞬間顯示，並用測試腳本取代 public/script.json。 */
export async function openWithTestScript(page: Page, query = 'timescale=0.2'): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('dementia-vn-settings', JSON.stringify({ textSpeed: 100, volume: 0.2 }));
  });
  await page.route('**/script.json', (route) => route.fulfill({ contentType: 'application/json', body: TEST_SCRIPT }));
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
  await page.locator('#stage').click({ position: { x: 400, y: 200 } });
}

/** 按「開始」並等到第一句出現。 */
export async function startGame(page: Page): Promise<void> {
  await page.click('.start-button');
  await expect(page.locator('#stage')).toHaveAttribute('data-phase', /text|choice/);
  await expect(page.locator('#stage')).toHaveAttribute('data-blink', 'open');
}
