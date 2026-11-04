// 匯出可以玩的版本（需求書 5.5）：壓縮檔內容、解壓縮後雙擊就能玩、不會被這個瀏覽器的本機專案蓋掉。
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Download, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';

const OUT = fileURLToPath(new URL('../dist-offline/', import.meta.url));

/** 解壓縮到暫存資料夾，回傳資料夾路徑與檔案清單。 */
async function unzip(download: Download): Promise<{ dir: string; files: string[] }> {
  const entries = unzipSync(new Uint8Array(await readFile(await download.path())));
  const dir = await mkdtemp(join(tmpdir(), 'vn-export-'));
  for (const [path, data] of Object.entries(entries)) {
    if (path.endsWith('/')) continue;
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), data);
  }
  return { dir, files: Object.keys(entries).sort() };
}

async function playToEnd(page: Page): Promise<void> {
  await page.click('.start-button');
  for (let i = 0; i < 20 && !(await page.locator('.ending-screen.open').isVisible()); i++) {
    await page.waitForFunction(() => (window as unknown as { __vn: { engine: { phase: string } } }).__vn.engine.phase !== 'busy');
    await page.locator('#stage').click({ position: { x: 150, y: 620 } });
  }
  await expect(page.locator('.ending-screen.open')).toBeVisible();
}

test('引導流程第 9 步：匯出可以玩的版本，解壓縮後雙擊就能玩到結局', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.click('[data-guide=begin]');
  await page.click('[data-guide=start-blank]');
  await page.locator('input[name=guide-title]').fill('匯出測試');
  await page.locator('textarea[name=guide-goal]').fill('目標');
  await page.click('[data-guide=next]');
  await expect(page.locator('[data-guide=progress]')).toContainText('第 2 步');
  await page.goto('./#/step/9');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-guide=export-playable]')]);
  expect(download.suggestedFilename()).toBe('匯出測試-可以玩的版本.zip');
  await expect(page.locator('[data-guide=play-status]')).toContainText('已下載');
  const { dir, files } = await unzip(download);
  expect(files).toEqual(expect.arrayContaining(['匯出測試/index.html', '匯出測試/玩 匯出測試.html', '匯出測試/說明.txt']));

  await page.goto(pathToFileURL(join(dir, '匯出測試', '玩 匯出測試.html')).href + '?timescale=0.2');
  await expect(page.locator('.title-screen h1')).toHaveText('匯出測試');
  await expect(page.locator('.project-badge')).toHaveCount(0);
  await playToEnd(page);
  expect(errors).toEqual([]);
});

test('開發者面板：從網站版 Demo 匯出，素材一起打包，圖片從 game/assets 載入', async ({ page }) => {
  await page.goto('./play.html?site=1&timescale=0.2');
  await expect(page.locator('.title-screen h1')).toHaveText('寫給未來的我');
  await page.keyboard.press('Backquote');
  await expect(page.locator('[data-dev=export-playable]')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.click('[data-dev=export-playable]')]);
  expect(download.suggestedFilename()).toBe('寫給未來的我-可以玩的版本.zip');
  const { dir, files } = await unzip(download);
  expect(files).toContain('寫給未來的我/game/assets/bg/kitchen_morning.webp');
  expect(files.filter((f) => f.includes('/game/assets/voice/')).length).toBe(66);

  // 用另一個（離線版）頁面在這個瀏覽器建立一個不同的本機專案，確認匯出的遊戲不會被蓋掉
  await page.goto(pathToFileURL(join(OUT, '開始.html')).href);
  await page.click('[data-guide=begin]');
  await page.click('[data-guide=start-blank]');
  await expect(page.locator('[data-guide=progress]')).toBeVisible();

  await page.goto(pathToFileURL(join(dir, '寫給未來的我', 'index.html')).href + '?timescale=0.2');
  await expect(page.locator('.title-screen h1')).toHaveText('寫給未來的我');
  await page.click('.start-button');
  await expect(page.locator('.bg')).toHaveAttribute('style', /game\/assets\/bg\/kitchen_morning\.webp/, { timeout: 15_000 });
  const ok = await page.evaluate(
    (src) => new Promise<boolean>((r) => Object.assign(new Image(), { onload: () => r(true), onerror: () => r(false), src })),
    (await page.locator('.bg').getAttribute('style'))!.match(/url\("(.+)"\)/)![1],
  );
  expect(ok).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __vn: { pack: { id: string } } }).__vn.pack.id)).toBe('dementia');
});

test('離線版「開始.html」也能匯出可以玩的版本', async ({ page }) => {
  await page.goto(pathToFileURL(join(OUT, '開始.html')).href);
  await page.click('[data-guide=begin]');
  await page.click('[data-guide=start-blank]');
  await page.locator('textarea[name=guide-goal]').fill('目標');
  await page.click('[data-guide=next]');
  await expect(page.locator('[data-guide=progress]')).toContainText('第 2 步');
  await page.goto(pathToFileURL(join(OUT, '開始.html')).href + '#/step/9');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-guide=export-playable]')]);
  const { dir } = await unzip(download);
  await page.goto(pathToFileURL(join(dir, '我的遊戲', 'index.html')).href + '?timescale=0.2');
  await expect(page.locator('.title-screen h1')).toHaveText('我的遊戲');
  await playToEnd(page);
});
