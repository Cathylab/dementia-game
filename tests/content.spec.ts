// repo 結構（需求書 4.2）：內容在 examples/、templates/、packs/，引擎可以切換載入哪個專案。
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { validateScript } from '../src/script';
import type { Script } from '../src/types';

const read = async (p: string) => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), 'utf8')) as Script;

test('空白範本：可以執行、腳本檢查沒有問題', async () => {
  const blank = await read('templates/空白/script.json');
  expect(validateScript(blank)).toEqual([]);
  expect(blank.endings.length).toBeGreaterThan(0);
});

test('沒有參數時載入 Demo；素材從 examples/寫給未來的我/assets 來', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(decodeURIComponent(r.url())));
  await page.goto('./');
  await expect(page.locator('.title-screen h1')).toHaveText('寫給未來的我');
  await page.click('.start-button');
  await expect(page.locator('#stage')).toHaveAttribute('data-scene', 'a1_s01', { timeout: 15_000 });
  await expect.poll(() => requests.some((u) => u.includes('/examples/寫給未來的我/assets/bg/kitchen_morning.webp'))).toBe(true);
  expect(requests.some((u) => /\/assets\/bg\/.*\.webp/.test(u) && !u.includes('/examples/'))).toBe(false);
});

test('?project=templates/空白 載入空白範本，可以玩到結局', async ({ page }) => {
  await page.goto('./?project=templates/空白&timescale=0.2');
  await expect(page.locator('.title-screen h1')).toHaveText('我的遊戲');
  await page.click('.start-button');
  await expect(page.locator('.dialog .text')).toHaveText('這是旁白。在故事編輯器裡改成你的第一句。');
  for (let i = 0; i < 6 && !(await page.locator('.ending-screen.open').isVisible()); i++) {
    await page.waitForFunction(() => (window as unknown as { __vn: { engine: { phase: string } } }).__vn.engine.phase !== 'busy');
    await page.locator('#stage').click({ position: { x: 100, y: 600 } });
  }
  await expect(page.locator('.ending-screen.open')).toBeVisible();
});

test('不認得的專案參數改回 Demo（不能指到別的資料夾）', async ({ page }) => {
  await page.goto('./?project=../../etc');
  await expect(page.locator('.title-screen h1')).toHaveText('寫給未來的我');
  await page.goto('./?project=src');
  await expect(page.locator('.title-screen h1')).toHaveText('寫給未來的我');
});

test('建置產生 projects.json 與每個專案的音檔清單', async ({ request }) => {
  const projects = (await (await request.get('./projects.json')).json()) as { dir: string; kind: string; title: string }[];
  expect(projects).toEqual(
    expect.arrayContaining([
      { dir: 'examples/寫給未來的我', kind: 'example', title: '寫給未來的我' },
      { dir: 'templates/空白', kind: 'template', title: '我的遊戲' },
    ]),
  );
  const voices = (await (await request.get(`./${encodeURI('examples/寫給未來的我')}/assets/voice/manifest.json`)).json()) as string[];
  expect(voices.length).toBe(66);
  const blank = (await (await request.get(`./${encodeURI('templates/空白')}/assets/sfx/manifest.json`)).json()) as string[];
  expect(blank).toEqual([]);
});
