// 佔位素材與素材管理（需求書 5.4）。
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { assetCatalog, missingListText } from '../src/assetcatalog';
import type { Script } from '../src/types';
import { openWithTestScript } from './helpers';

const demo = JSON.parse(readFileSync(new URL('../examples/寫給未來的我/script.json', import.meta.url), 'utf8')) as Script;
// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('素材清單：Demo 的每種素材都列出來，附用在哪裡與描述', () => {
  const items = assetCatalog(demo);
  const count = (k: string) => items.filter((x) => x.kind === k).length;
  expect(count('bg')).toBe(11);
  expect(count('voice')).toBe(65);
  expect(count('char')).toBeGreaterThanOrEqual(12);
  expect(count('music')).toBe(9);
  const kitchen = items.find((x) => x.kind === 'bg' && x.name === 'kitchen_morning')!;
  expect(kitchen.uses[0]).toBe('第一幕〈婚禮前半年・便利貼〉');
  expect(kitchen.scene).toBe('a1_s01');
  const object = items.find((x) => x.kind === 'fg' && x.description.includes('要畫真相'));
  expect(object).toBeTruthy();
  const voice = items.find((x) => x.kind === 'voice')!;
  expect(voice.description).toMatch(/：「.+」/);
  // 依種類排列：背景在最前面
  expect(items[0].kind).toBe('bg');
  const text = missingListText(items.filter((x) => x.kind === 'bg').slice(0, 2), demo.meta.title);
  expect(text).toContain('【背景】規格');
  expect(text).toContain('kitchen_morning');
});

async function openAssets(page: Page) {
  await page.keyboard.press('Backquote');
  await page.click('[data-dev=story]');
  await page.click('[data-tab=assets]');
  await expect(page.locator('[data-story=asset-summary]')).not.toContainText('檢查中');
}

test('素材頁：顯示狀態；沒有素材也能玩；上傳後變成「已上傳」', async ({ page }) => {
  await openWithTestScript(page);
  await openAssets(page);
  await expect(page.locator('[data-story=asset-summary]')).toContainText('還沒有（佔位中）');
  const row = page.locator('.story-asset[data-asset="bg/test_room"]');
  await expect(row).toHaveAttribute('data-status', 'missing');
  await expect(row.locator('.story-asset-thumb img')).toHaveAttribute('src', /^data:image\/png/);
  await expect(row).toContainText('用在：第一幕〈開始〉');
  await row.locator('input[name=story-asset-file]').setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: PNG });
  await expect(row).toHaveAttribute('data-status', 'local');
  await expect(row.locator('.story-asset-status')).toHaveText('已上傳');
  await expect(row.locator('.story-asset-thumb img')).toHaveAttribute('src', /^blob:/);

  // 只看還沒有的
  await page.locator('input[name=story-asset-missing]').check();
  await expect(page.locator('.story-asset[data-asset="bg/test_room"]')).toBeHidden();
  // 依種類篩選
  await page.selectOption('select[name=story-asset-kind]', 'voice');
  await expect(page.locator('.story-asset').first()).toHaveAttribute('data-asset', /^voice\//);
});

test('網站上有的素材顯示「網站上有檔案」', async ({ page }) => {
  await page.route('**/assets/bg/test_room.png', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await openWithTestScript(page);
  await openAssets(page);
  await expect(page.locator('.story-asset[data-asset="bg/test_room"]')).toHaveAttribute('data-status', 'site');
});

test('佔位圖：同一個名稱畫一樣的圖，不同種類的場景構圖不同', async ({ page }) => {
  await openWithTestScript(page, 'timescale=0.2', {
    mutate: (x) => {
      x.scenes[0].background = 'classroom_demo';
      x.scenes[1].background = 'stage_demo';
    },
  });
  await openAssets(page);
  const a = await page.locator('.story-asset[data-asset="bg/classroom_demo"] img').getAttribute('src');
  const b = await page.locator('.story-asset[data-asset="bg/stage_demo"] img').getAttribute('src');
  expect(a).toMatch(/^data:image\/png/);
  expect(a).not.toBe(b);
  // 重畫一次結果相同（同名稱一致）
  await page.click('[data-tab=scenes]');
  await page.click('[data-tab=assets]');
  await expect(page.locator('.story-asset[data-asset="bg/classroom_demo"] img')).toHaveAttribute('src', a!);
});
