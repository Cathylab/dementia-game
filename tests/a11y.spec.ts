// 階段二 B-8 無障礙：文字大小、減少晃動與閃爍、色弱友善；標題畫面提醒有晃動與閃爍。
import { expect, test } from '@playwright/test';
import { jumpTo, openWithTestScript, startGame } from './helpers';

test('標題畫面提醒有晃動與閃爍，按「設定」打開設定（疊在標題畫面上）', async ({ page }) => {
  await openWithTestScript(page);
  await expect(page.locator('[data-ui=motion-note]')).toContainText('晃動');
  await page.click('[data-ui=title-settings]');
  await expect(page.locator('.settings-overlay.open input[name=calm]')).toBeVisible();
});

test('文字大小：特大讓台詞變大，記在瀏覽器裡', async ({ page }) => {
  await openWithTestScript(page);
  await startGame(page);
  const size = () => page.locator('.dialog').evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
  const before = await size();
  await page.click('.tool-settings');
  await page.locator('input[name=textScale][value="1.4"]').check();
  await expect.poll(size).toBeGreaterThan(before * 1.3);
  // 記在瀏覽器裡（測試工具每次載入會重設設定，所以只檢查有寫進去）
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dementia-vn-settings')!).textScale)).toBe(1.4);
});

test('減少晃動與閃爍：畫面不晃、轉場改淡入淡出', async ({ page }) => {
  await openWithTestScript(page);
  await startGame(page);
  const sway = () => page.locator('.scene-layers').evaluate((n) => getComputedStyle(n).animationName);
  expect(await sway()).not.toBe('none');
  await page.click('.tool-settings');
  await page.locator('input[name=calm]').check();
  await expect(page.locator('#stage')).toHaveClass(/calm/);
  expect(await sway()).toBe('none');
  await page.keyboard.press('Escape');
  // 換場景時用淡入淡出的黑幕，不用眼皮
  await jumpTo(page, 'fx_look');
  await expect(page.locator('.blink')).not.toHaveClass(/closed/);
  expect(await page.locator('.objects').evaluate((n) => getComputedStyle(n).animationName)).toBe('none');
});

test('系統設定「減少動態」時預設就減少晃動與閃爍', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await openWithTestScript(page);
  await expect(page.locator('#stage')).toHaveClass(/calm/);
  await expect(page.locator('[data-ui=motion-note]')).toContainText('已減少');
  await context.close();
});

test('色弱友善：灰掉的選項加鎖頭與虛線，物件加黑白雙圈', async ({ page }) => {
  await openWithTestScript(page);
  await page.click('[data-ui=title-settings]');
  await page.locator('input[name=colorAssist]').check();
  await page.keyboard.press('Escape');
  await jumpTo(page, 'req_scene');
  await expect(page.locator('#stage')).toHaveClass(/color-assist/);
  await expect(page.locator('.object-spot').first()).toHaveCSS('outline-style', 'solid');
});
