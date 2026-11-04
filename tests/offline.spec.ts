// 離線版（需求書 4.4）：dist-offline/ 裡的 html 直接用 file:// 開啟。
// 建置由 playwright.config 的 webServer（npm run build）一起完成。
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { packProject } from '../src/projectfile';
import { testScript, unblock } from './helpers';

const OUT = fileURLToPath(new URL('../dist-offline/', import.meta.url));
const pageUrl = (file: string, query = 'timescale=0.3') => `${pathToFileURL(join(OUT, file)).href}?${query}`;

/** 開啟離線 html；記下錯誤與不該出現的 fetch。 */
async function open(page: Page, file = '玩 Demo.html', query?: string) {
  const errors: string[] = [];
  const fetched: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && /fetch|module|CORS/i.test(m.text())) errors.push(m.text());
  });
  page.on('request', (r) => {
    if (/script\.json|manifest\.json|projects\.json/.test(r.url())) fetched.push(r.url());
  });
  await page.addInitScript(() => {
    localStorage.setItem('dementia-vn-settings', JSON.stringify({ textSpeed: 100, volume: 0.2 }));
  });
  await page.goto(pageUrl(file, query));
  return { errors, fetched };
}

const stage = (page: Page) => page.locator('#stage');

test('玩 Demo.html：雙擊開啟就能玩，劇本與清單內嵌、圖片用相對路徑', async ({ page }) => {
  const { errors, fetched } = await open(page);
  await expect(page.locator('.title-screen h1')).toHaveText('寫給未來的我');
  await expect(page).toHaveTitle('寫給未來的我');
  // 題材包也內嵌在 html 裡
  expect(await page.evaluate(() => (window as unknown as { __vn: { pack: { id: string; effects: string[] } } }).__vn.pack)).toMatchObject({ id: 'dementia' });
  await page.click('.start-button');
  await expect(stage(page)).toHaveAttribute('data-scene', 'a1_s01', { timeout: 15_000 });
  await expect(page.locator('.bg')).toHaveAttribute('style', /examples\/.*\/assets\/bg\/kitchen_morning\.webp/);
  // 圖片真的載得到（不是佔位圖）
  const ok = await page.evaluate(
    (src) => new Promise<boolean>((r) => Object.assign(new Image(), { onload: () => r(true), onerror: () => r(false), src })),
    (await page.locator('.bg').getAttribute('style'))!.match(/url\("(.+)"\)/)![1],
  );
  expect(ok).toBe(true);
  // 開發者面板顯示離線模式與被簡化的功能
  await page.keyboard.press('Backquote');
  await expect(page.locator('[data-dev=offline]')).toContainText('離線模式');
  expect(errors).toEqual([]);
  expect(fetched).toEqual([]);
});

test('離線模式的配音用 <audio> 播放', async ({ page }) => {
  const { errors } = await open(page);
  await page.click('.start-button');
  await expect(stage(page)).toHaveAttribute('data-scene', 'a1_s01', { timeout: 15_000 });
  await page.keyboard.press('Backquote');
  await page.selectOption('select[name=dev-scene]', 'a1_s02');
  await page.click('[data-dev=jump]');
  await page.keyboard.press('Backquote');
  await expect(stage(page)).toHaveAttribute('data-scene', 'a1_s02');
  for (let i = 0; i < 12 && !(await stage(page).getAttribute('data-voice')); i++) {
    await page.waitForFunction(() => (window as unknown as { __vn: { engine: { phase: string } } }).__vn.engine.phase !== 'busy');
    if (await unblock(page)) continue;
    await stage(page).click({ position: { x: 150, y: 620 } });
  }
  await expect(stage(page)).toHaveAttribute('data-voice', /^a1_s02_/);
  await expect(stage(page)).toHaveAttribute('data-voice-state', /playing|ended/);
  expect(errors).toEqual([]);
});

test('離線模式的背景音樂檔用 <audio> 播放（走音只改速度與音量）', async ({ page }) => {
  // 放一個假的音樂檔，並在內嵌清單裡加上它
  const music = join(OUT, 'examples/寫給未來的我/assets/music/home_morning.mp3');
  const sr = 8000;
  const buf = Buffer.alloc(44 + sr * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + sr * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(sr * 2, 40);
  await writeFile(music, buf);
  try {
    await page.addInitScript(() => {
      let value: { projects: Record<string, { manifests: Record<string, string[]> }> } | undefined;
      Object.defineProperty(window, '__VN_EMBED__', {
        configurable: true,
        get: () => value,
        set: (v) => {
          v.projects['examples/寫給未來的我'].manifests.music = ['home_morning.mp3'];
          value = v;
        },
      });
    });
    const { errors } = await open(page);
    await page.click('.start-button');
    await expect(stage(page)).toHaveAttribute('data-music', 'home_morning', { timeout: 15_000 });
    await expect(stage(page)).toHaveAttribute('data-audio-mode', 'file');
    expect(errors).toEqual([]);
  } finally {
    await rm(music, { force: true });
  }
});

test('空白範本.html：載入空白範本，可以玩到結局', async ({ page }) => {
  const { errors } = await open(page, '空白範本.html');
  await expect(page.locator('.title-screen h1')).toHaveText('我的遊戲');
  expect(await page.evaluate(() => (window as unknown as { __vn: { pack: { id: string } } }).__vn.pack.id)).toBe('plain');
  await page.click('.start-button');
  for (let i = 0; i < 8 && !(await page.locator('.ending-screen.open').isVisible()); i++) {
    await page.waitForFunction(() => (window as unknown as { __vn: { engine: { phase: string } } }).__vn.engine.phase !== 'busy');
    await stage(page).click({ position: { x: 150, y: 620 } });
  }
  await expect(page.locator('.ending-screen.open')).toBeVisible();
  expect(errors).toEqual([]);
});

test('離線模式：開啟專案檔後存在瀏覽器裡，重新開啟還在', async ({ page }) => {
  const script = testScript();
  script.meta.title = '離線開啟的專案';
  const file = Buffer.from(await (await packProject({ script, files: new Map() })).arrayBuffer());
  const { errors } = await open(page, '空白範本.html');
  await page.keyboard.press('Backquote');
  await page.setInputFiles('input[name=dev-project-file]', { name: 'game.vnproj', mimeType: 'application/zip', buffer: file });
  await expect(page.locator('.title-screen h1')).toHaveText('離線開啟的專案', { timeout: 15_000 });
  // 直接雙擊 html 是原本的空白範本；開發者面板有連結打開本機專案（網址帶 local=1）
  await page.goto(pageUrl('空白範本.html'));
  await expect(page.locator('.project-badge')).toHaveCount(0);
  await page.keyboard.press('Backquote');
  await expect(page.locator('[data-dev=stored-project]')).toContainText('離線開啟的專案');
  await page.locator('[data-dev=open-stored]').click();
  await expect(page.locator('.title-screen h1')).toHaveText('離線開啟的專案');
  await expect(page.locator('.project-badge')).toContainText('本機專案');
  expect(errors).toEqual([]);
});

test('玩 Demo.html：一路選第一個選項可以走到結局', async ({ page }) => {
  test.setTimeout(240_000);
  const { errors } = await open(page, '玩 Demo.html', 'timescale=0.2');
  await page.click('.start-button');
  const ending = page.locator('.ending-screen.open, .memory-page.open');
  for (let i = 0; i < 2000 && !(await ending.first().isVisible()); i++) {
    if (await page.locator('.inspect.open').count()) {
      await page.locator('.inspect.open').click();
      continue;
    }
    const choice = page.locator('.choices.open :is(.choice, .hotspot):not(.vanishing):not(:disabled)');
    if (await choice.count()) {
      await choice.first().click({ timeout: 2000 }).catch(() => {});
      continue;
    }
    if ((await page.evaluate(() => (window as unknown as { __vn: { engine: { phase: string } } }).__vn.engine.phase)) === 'text' && (await unblock(page))) continue;
    await stage(page).click({ position: { x: 190, y: 620 } });
  }
  await expect(ending.first()).toBeVisible();
  expect(errors).toEqual([]);
});
