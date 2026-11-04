// 試玩回饋第 5 項：暫停選單（繼續、存檔、讀檔、設定、回到標題）；1 個自動存檔＋3 個手動欄位，存在瀏覽器。
import { expect, test } from '@playwright/test';
import { advance, currentText, engineValue, jumpTo, openWithTestScript, startGame } from './helpers';

test('暫停選單：繼續、存檔、讀檔、設定、回到標題；Esc 也能打開', async ({ page }) => {
  await openWithTestScript(page);
  await startGame(page);
  await page.click('.tool-pause');
  const menu = page.locator('.pause-overlay.open');
  for (const k of ['resume', 'save', 'load', 'settings', 'title']) await expect(menu.locator(`[data-pause=${k}]`)).toBeVisible();
  // 暫停時點畫面不會往下
  await page.locator('#stage').click({ position: { x: 5, y: 5 } });
  await expect(currentText(page)).toHaveText('旁白第一句。');
  await menu.locator('[data-pause=resume]').click();
  await expect(menu).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-overlay.open')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-overlay.open')).toHaveCount(0);
});

test('手動存檔與讀檔：數值、旗標、點過的物件、位置都回來', async ({ page }) => {
  await openWithTestScript(page);
  await jumpTo(page, 'obj_scene');
  await page.locator('.object-spot[data-object=o_phone]').click({ force: true });
  await page.locator('.inspect').click();
  await advance(page);
  await expect(currentText(page)).toHaveText('物件第二句。');
  await page.click('.tool-pause');
  await page.click('[data-pause=save]');
  await page.click('.save-slot[data-slot="1"]');
  await expect(page.locator('.save-slot[data-slot="1"]')).toContainText('物件第二句');
  await expect(page.locator('.save-slot[data-slot=auto]')).toBeDisabled();
  await page.keyboard.press('Escape');
  // 走到別的地方再讀檔
  await jumpTo(page, 'fx_name');
  await page.click('.tool-pause');
  await page.click('[data-pause=load]');
  await page.click('.save-slot[data-slot="1"]');
  await expect(page.locator('#stage')).toHaveAttribute('data-scene', 'obj_scene');
  await expect(currentText(page)).toHaveText('物件第二句。');
  expect(await engineValue<string[]>(page, 'seen')).toEqual(['o_phone']);
});

test('自動存檔：重新整理後標題畫面有「繼續」，接著玩', async ({ page }) => {
  await openWithTestScript(page);
  await startGame(page);
  await advance(page);
  await advance(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-phase', /text|choice/);
  const index = await engineValue<number>(page, 'index');
  await page.reload();
  await expect(page.locator('[data-ui=continue]')).toBeVisible();
  await expect(page.locator('.continue-note')).toContainText('第1幕');
  await page.click('[data-ui=continue]');
  await expect(page.locator('#stage')).toHaveAttribute('data-scene', 't_start');
  expect(await engineValue<number>(page, 'index')).toBe(index);
});

test('沒有存檔時，標題畫面沒有「繼續」與「讀取存檔」', async ({ page }) => {
  await openWithTestScript(page);
  await expect(page.locator('[data-ui=continue]')).toHaveCount(0);
  await expect(page.locator('[data-ui=load]')).toHaveCount(0);
});

test('手機直式：暫停在「選單」裡', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWithTestScript(page);
  await startGame(page);
  await page.click('.menu-toggle');
  await page.click('.tool-pause');
  await expect(page.locator('.pause-overlay.open [data-pause=save]')).toBeVisible();
});
