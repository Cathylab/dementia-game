// 試玩回饋第 4 項：封面圖、遊戲名稱、章節卡樣式（開發者面板可調）。
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { assetCatalog } from '../src/assetcatalog';
import { assetNames } from '../src/assetnames';
import type { Script } from '../src/types';
import { openWithTestScript, testScript } from './helpers';

test('封面：meta.cover 顯示在標題畫面；手機直式可以另給 coverPortrait', async ({ page }) => {
  await openWithTestScript(page, 'timescale=0.2', { mutate: (s) => Object.assign(s.meta, { cover: 'test_room', coverPortrait: 'old_school' }) });
  const title = page.locator('.title-screen');
  await expect(title).toHaveClass(/has-cover/);
  await expect(title).toHaveAttribute('data-cover', 'test_room');
  await expect.poll(() => title.evaluate((n) => getComputedStyle(n).backgroundImage)).toContain('url(');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => (window as unknown as { __vn: { view: { showTitle(): void } } }).__vn.view.showTitle());
  await expect(title).toHaveAttribute('data-cover', 'old_school');
});

test('沒有封面時照舊（深色漸層）', async ({ page }) => {
  await openWithTestScript(page);
  await expect(page.locator('.title-screen')).not.toHaveClass(/has-cover/);
});

test('封面算在需要的背景圖裡；物件的循環音效算在需要的音效裡', () => {
  const s = testScript();
  s.meta.cover = 'cover_art';
  s.scenes.find((x) => x.id === 'obj_scene')!.objects![0].sfx = 'phone_ring';
  expect(assetNames(s, 'bg')[0]).toBe('cover_art');
  expect(assetNames(s, 'sfx')).toContain('phone_ring');
  const items = assetCatalog(s);
  expect(items.find((x) => x.kind === 'bg' && x.name === 'cover_art')?.uses).toContain('標題畫面');
  expect(items.find((x) => x.kind === 'sfx' && x.name === 'phone_ring')?.description).toContain('循環播放');
});

test('開發者面板：改遊戲名稱、封面、章節卡樣式與大小，存進劇本', async ({ page }) => {
  await openWithTestScript(page);
  await page.keyboard.press('Backquote');
  await page.locator('input[name=dev-title]').fill('新的名字');
  await page.locator('input[name=dev-title]').press('Enter');
  await expect(page.locator('.title-screen h1')).toHaveText('新的名字');
  await page.locator('input[name=dev-cover]').fill('test_room');
  await page.locator('input[name=dev-cover]').press('Enter');
  await expect(page.locator('.title-screen')).toHaveClass(/has-cover/);
  await page.selectOption('select[name=dev-chapter-style]', 'bold');
  await page.locator('input[name=dev-chapter-scale]').fill('1.2');
  await expect(page.locator('.chapter-card')).toHaveAttribute('data-style', 'bold');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-dev=save-presentation]')]);
  const saved = JSON.parse(await readFile(await download.path(), 'utf8')) as Script;
  expect(saved.meta).toMatchObject({ title: '新的名字', cover: 'test_room', chapterStyle: { style: 'bold', scale: 1.2 } });
});

test('章節卡預設樣式：「第一章」比以前大（至少畫面高度的 4%）', async ({ page }) => {
  await openWithTestScript(page);
  await page.click('.start-button');
  await page.evaluate(() => void (window as unknown as { __vn: { view: { previewChapterCard(): Promise<void> } } }).__vn.view.previewChapterCard());
  const no = page.locator('.chapter-card.open .chapter-no');
  await expect(no).toHaveText('第一章');
  await expect(page.locator('.chapter-card')).toHaveAttribute('data-style', 'stacked');
  const h = page.viewportSize()!.height;
  const size = await no.evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
  expect(size).toBeGreaterThanOrEqual(h * 0.04);
});

test('製作名單：meta.credits 有內容時標題畫面有按鈕，列出出處；沒有就不顯示', async ({ page }) => {
  await openWithTestScript(page, 'timescale=0.2', {
    mutate: (s) => (s.meta.credits = [{ file: 'phone_ring', title: 'Phone Ringing', author: '某人', license: 'CC0', url: 'https://openverse.org/x' }]),
  });
  await page.click('[data-ui=credits]');
  const overlay = page.locator('[data-ui=credits-overlay]');
  await expect(overlay.locator('li[data-file=phone_ring]')).toContainText('Phone Ringing');
  await expect(overlay.locator('li[data-file=phone_ring]')).toContainText('CC0');
  await expect(overlay.locator('a')).toHaveAttribute('target', '_blank');
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await expect(page.locator('.title-screen')).toHaveClass(/open/);
});

test('正式腳本：19 筆音效出處都在製作名單裡', async ({ page }) => {
  await page.goto('./play.html?timescale=0.2');
  await page.click('[data-ui=credits]');
  await expect(page.locator('.credits-list li')).toHaveCount(19);
});

test('沒有 credits：沒有製作名單按鈕', async ({ page }) => {
  await openWithTestScript(page);
  await expect(page.locator('[data-ui=credits]')).toHaveCount(0);
});

test('介面樣式：開發者面板切換 classic／box／paper，存進 meta.uiStyle', async ({ page }) => {
  await openWithTestScript(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-ui-style', 'classic');
  await page.keyboard.press('Backquote');
  await page.selectOption('select[name=dev-ui-style]', 'paper');
  await expect(page.locator('#stage')).toHaveAttribute('data-ui-style', 'paper');
  await page.selectOption('select[name=dev-ui-style]', 'box');
  await expect(page.locator('#stage')).toHaveAttribute('data-ui-style', 'box');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-dev=save-presentation]')]);
  const saved = JSON.parse(await readFile(await download.path(), 'utf8')) as Script;
  expect(saved.meta.uiStyle).toBe('box');
});

test('內心獨白樣式：預設暗帶（不斜體），開發者面板可以換框或舊樣式、調大小，存進 meta.monologueStyle', async ({ page }) => {
  await openWithTestScript(page);
  await expect(page.locator('.monologue')).toHaveAttribute('data-style', 'band');
  expect(await page.locator('.monologue-text').evaluate((n) => getComputedStyle(n).fontStyle)).toBe('normal');
  await page.keyboard.press('Backquote');
  await page.selectOption('select[name=dev-monologue-style]', 'soft');
  await expect(page.locator('.monologue')).toHaveAttribute('data-style', 'soft');
  expect(await page.locator('.monologue-text').evaluate((n) => getComputedStyle(n).fontStyle)).toBe('italic');
  await page.selectOption('select[name=dev-monologue-style]', 'card');
  await page.locator('input[name=dev-monologue-scale]').fill('1.2');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-dev=save-presentation]')]);
  const saved = JSON.parse(await readFile(await download.path(), 'utf8')) as Script;
  expect(saved.meta.monologueStyle).toEqual({ style: 'card', scale: 1.2 });
});
