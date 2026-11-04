// 專案檔：匯出、開啟、存成本機專案、本機專案的存檔與上傳、關閉。
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { packProject, unpackProject } from '../src/projectfile';
import { jumpTo, openWithTestScript, testScript } from './helpers';

const openPanel = (page: Page) => page.keyboard.press('Backquote');
// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function routeAssets(page: Page): Promise<void> {
  await page.route('**/assets/bg/test_room.png', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await page.route('**/assets/voice/manifest.json', (r) => r.fulfill({ contentType: 'application/json', body: '[]' }));
}

/** 用 Node 做一個專案檔：標題改掉，附一張背景圖。 */
async function makeProjectFile(title: string): Promise<Buffer> {
  const script = testScript();
  script.meta.title = title;
  const blob = await packProject({ script, files: new Map([['bg/test_room.png', new Blob([PNG], { type: 'image/png' })]]) });
  return Buffer.from(await blob.arrayBuffer());
}

async function openProjectFile(page: Page, buffer: Buffer, title: string): Promise<void> {
  await openPanel(page);
  await page.setInputFiles('input[name=dev-project-file]', { name: 'game.vnproj', mimeType: 'application/zip', buffer });
  await expect(page.locator('.title-screen h1')).toHaveText(title, { timeout: 15_000 });
}

test('專案檔格式：打包再拆開內容一樣；不是專案檔時給看得懂的錯誤', async () => {
  const script = testScript();
  const blob = await packProject({ script, files: new Map([['bg/a.webp', new Blob([PNG])], ['voice/x.mp3', new Blob(['mp3'])]]) });
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  expect(Object.keys(entries).sort()).toEqual(['assets/bg/a.webp', 'assets/voice/x.mp3', 'project.json', 'script.json']);
  const back = await unpackProject(blob);
  expect(back.script).toEqual(script);
  expect([...back.files.keys()].sort()).toEqual(['bg/a.webp', 'voice/x.mp3']);
  expect(back.info.title).toBe('測試腳本');
  await expect(unpackProject(new Blob(['hello']))).rejects.toThrow('這不是專案檔');
});

test('匯出專案檔：包含劇本與網站上有的素材', async ({ page }) => {
  await routeAssets(page);
  await openWithTestScript(page);
  await openPanel(page);
  await expect(page.locator('[data-dev=project-mode]')).toHaveAttribute('data-mode', 'site');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-dev=export-project]')]);
  expect(download.suggestedFilename()).toBe('測試腳本.vnproj');
  const project = await unpackProject(new Blob([await readFile(await download.path())]));
  expect(project.script.meta.title).toBe('測試腳本');
  expect([...project.files.keys()]).toContain('bg/test_room.png');
  await expect(page.locator('[data-dev=project-status]')).toContainText('已下載 測試腳本.vnproj');
});

test('開啟專案檔：改用檔案裡的遊戲，重新整理還在；修改與上傳自動存進去；關閉後回到網站版', async ({ page }) => {
  await openWithTestScript(page);
  await openProjectFile(page, await makeProjectFile('匯入的遊戲'), '匯入的遊戲');
  await expect(page.locator('.project-badge')).toContainText('本機專案');

  // 背景圖來自專案檔（不是網站，也不是佔位圖）
  await jumpTo(page, 'pose');
  await expect(page.locator('.bg')).toHaveAttribute('style', /blob:/);

  // 修改後按儲存：存進瀏覽器裡的專案
  await page.evaluate(() => {
    const vn = (window as unknown as { __vn: { engine: { script: { meta: { title: string } } }; editor: { save(): Promise<string> } } }).__vn;
    vn.engine.script.meta.title = '改過的標題';
    return vn.editor.save();
  });
  // 上傳一張物品圖
  await openPanel(page);
  await page.selectOption('select[name=dev-upload-kind]', 'fg');
  await page.setInputFiles('input[name=dev-upload-file]', { name: 'phone_on_table.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('details[data-section=上傳素材]')).toContainText('1 / 1 個檔案已放進遊戲');

  await page.reload();
  await expect(page.locator('.title-screen h1')).toHaveText('改過的標題');
  const files = await page.evaluate(async () => {
    const vn = (window as unknown as { __vn: { project: { store: { load(): Promise<{ files: Map<string, Blob> }> } } } }).__vn;
    return [...(await vn.project.store.load()).files.keys()].sort();
  });
  expect(files).toEqual(['bg/test_room.png', 'fg/phone_on_table.png']);

  // ?site=1 暫時看網站原本的遊戲
  await page.goto('./play.html?timescale=0.2&site=1');
  await expect(page.locator('.title-screen h1')).toHaveText('測試腳本');
  await page.goto('./play.html?timescale=0.2');
  await expect(page.locator('.title-screen h1')).toHaveText('改過的標題');

  page.on('dialog', (d) => void d.accept());
  await openPanel(page);
  await expect(page.locator('[data-dev=project-mode]')).toHaveAttribute('data-mode', 'local');
  await page.click('[data-dev=close-project]');
  await expect(page.locator('.title-screen h1')).toHaveText('測試腳本', { timeout: 15_000 });
  await expect(page.locator('.project-badge')).toHaveCount(0);
});

test('網站版：上傳後「存成本機專案」，重新整理後上傳的素材還在', async ({ page }) => {
  await routeAssets(page);
  await openWithTestScript(page);
  await openPanel(page);
  await page.selectOption('select[name=dev-upload-kind]', 'fg');
  await page.setInputFiles('input[name=dev-upload-file]', { name: 'phone_on_table.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('details[data-section=上傳素材]')).toContainText('1 / 1 個檔案已放進遊戲');
  await page.click('[data-dev=save-local]');
  await expect(page.locator('.project-badge')).toContainText('本機專案', { timeout: 15_000 });
  const files = await page.evaluate(async () => {
    const vn = (window as unknown as { __vn: { project: { store: { load(): Promise<{ files: Map<string, Blob> }> } } } }).__vn;
    return [...(await vn.project.store.load()).files.keys()].sort();
  });
  expect(files).toEqual(['bg/test_room.png', 'fg/phone_on_table.png']);
});

test('不是專案檔：顯示錯誤，維持原本的遊戲', async ({ page }) => {
  await openWithTestScript(page);
  await openPanel(page);
  await page.setInputFiles('input[name=dev-project-file]', { name: 'oops.vnproj', mimeType: 'application/zip', buffer: Buffer.from('not a zip') });
  await expect(page.locator('[data-dev=project-status]')).toContainText('沒有成功：這不是專案檔');
  await expect(page.locator('[data-dev=project-mode]')).toHaveAttribute('data-mode', 'site');
});
