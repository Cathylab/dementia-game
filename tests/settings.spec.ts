import { expect, test } from '@playwright/test';
import type { Script } from '../src/types';
import { advance, jumpTo, openWithTestScript, startGame } from './helpers';

const withDefaults = {
  mutate: (s: Script) => {
    s.meta.settingsDefaults = { hiddenHints: true, memoryReview: 'page' };
  },
};

test.describe('設定：隱藏選項提示、記憶對照', () => {
  test('設定畫面有兩個新開關，預設為關閉／融入結局', async ({ page }) => {
    await openWithTestScript(page);
    await startGame(page);
    await page.click('.tool-settings');
    await expect(page.locator('.settings-overlay')).toContainText('隱藏選項提示');
    await expect(page.locator('input[name=hiddenHints]')).not.toBeChecked();
    await expect(page.locator('input[name=memoryReview][value=inline]')).toBeChecked();
    await expect(page.locator('.settings-overlay')).toContainText('融入結局');
    await expect(page.locator('.settings-overlay')).toContainText('結局後獨立一頁');
  });

  test('沒改過時套用 meta.settingsDefaults', async ({ page }) => {
    await openWithTestScript(page, undefined, withDefaults);
    await startGame(page);
    await page.click('.tool-settings');
    await expect(page.locator('input[name=hiddenHints]')).toBeChecked();
    await expect(page.locator('input[name=memoryReview][value=page]')).toBeChecked();
  });

  test('玩家改過的以玩家為準，重新整理後仍保留', async ({ page }) => {
    // 只在第一次載入前寫入舊格式設定（沒有新欄位）
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('dementia-vn-settings', JSON.stringify({ textSpeed: 100, volume: 0.2 }));
      }
    });
    await openWithTestScript(page, undefined, { ...withDefaults, skipSettings: true });
    await startGame(page);
    await page.click('.tool-settings');
    await expect(page.locator('input[name=hiddenHints]')).toBeChecked();
    await page.locator('input[name=hiddenHints]').uncheck();
    await page.locator('input[name=memoryReview][value=inline]').check();
    await page.reload();
    await startGame(page);
    await page.click('.tool-settings');
    await expect(page.locator('input[name=hiddenHints]')).not.toBeChecked();
    await expect(page.locator('input[name=memoryReview][value=inline]')).toBeChecked();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dementia-vn-settings')!))).toMatchObject({
      textSpeed: 100,
      hiddenHints: false,
      memoryReview: 'inline',
    });
  });

  test('選項顯示中切換「隱藏選項提示」立即生效', async ({ page }) => {
    await openWithTestScript(page);
    await jumpTo(page, 'req_scene');
    await advance(page);
    const locked = page.locator('.choice[data-index="2"]');
    await expect(locked).toHaveText('你好像記得什麼，但想不起來。');
    await page.click('.tool-settings');
    await page.locator('input[name=hiddenHints]').check();
    await page.keyboard.press('Escape');
    await expect(locked).toHaveText('鑰匙？');
  });
});
