// Release 壓縮檔（需求書 4.3）：內容、解壓縮後雙擊開始.html／玩 Demo.html、使用說明的截圖。
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { FOLDER, packageRelease } from '../scripts/package-release.mjs';

test('打包：解壓縮後有開始.html、玩 Demo.html、使用說明，雙擊就能用', async ({ page }) => {
  const work = await mkdtemp(join(tmpdir(), 'vn-release-'));
  const zipFile = join(work, 'release.zip');
  const r = await packageRelease(zipFile);
  // README 標示的大小：目前約 9 MB（素材增加時更新 README）
  expect(r.bytes).toBeLessThan(30 * 1024 * 1024);
  const entries = unzipSync(new Uint8Array(await readFile(zipFile)));
  const names = Object.keys(entries);
  for (const f of ['開始.html', '玩 Demo.html', '空白範本.html', '使用說明.html', 'usage/u1-home.webp', 'examples/寫給未來的我/script.json', 'packs/dementia/pack.json']) {
    expect(names, f).toContain(`${FOLDER}/${f}`);
  }
  expect(names.some((n) => n.endsWith('player-template.html'))).toBe(false);
  const dir = join(work, 'unzipped');
  for (const [p, data] of Object.entries(entries)) {
    if (p.endsWith('/')) continue;
    await mkdir(dirname(join(dir, p)), { recursive: true });
    await writeFile(join(dir, p), data);
  }

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(join(dir, FOLDER, '開始.html')).href);
  await expect(page.locator('.g-hero h1')).toBeVisible();
  await page.goto(pathToFileURL(join(dir, FOLDER, '玩 Demo.html')).href);
  await expect(page.locator('.title-screen h1')).toHaveText('寫給未來的我');
  await page.goto(pathToFileURL(join(dir, FOLDER, '使用說明.html')).href);
  await expect(page.locator('h1')).toHaveText('使用說明');
  // 截圖都載得到
  const broken = await page.evaluate(() =>
    Promise.all(
      [...document.images].map((img) => (img.complete ? Promise.resolve(img.naturalWidth > 0) : new Promise<boolean>((r) => ((img.onload = () => r(true)), (img.onerror = () => r(false)))))),
    ),
  );
  expect(broken.length).toBeGreaterThanOrEqual(5);
  expect(broken.every(Boolean)).toBe(true);
  expect(errors).toEqual([]);
});
