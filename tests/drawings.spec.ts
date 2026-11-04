// 簡單素材（需求書 6-7）：手繪拍照去背、裁切、調整大小；小圖庫。
import { expect, test } from '@playwright/test';
import { GALLERY, galleryFor } from '../src/gallery';
import { contentBox, coverCrop, fitCutout, paperColor, removePaper, type Pixels } from '../src/photo';

/** 偏黃的「白紙」上畫一個深色方塊（像手機拍的照片）。 */
function photo(w = 200, h = 160): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const ink = x >= 60 && x < 120 && y >= 40 && y < 140;
      const noise = ((x * 7 + y * 13) % 9) - 4;
      data[i] = ink ? 40 : 232 + noise;
      data[i + 1] = ink ? 60 : 222 + noise;
      data[i + 2] = ink ? 90 : 196 + noise;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

test('去掉白紙：紙變透明、畫的部分留下，範圍抓得到；紙的顏色校正成白', () => {
  const img = photo();
  const [r, , b] = paperColor(img);
  expect(r).toBeGreaterThan(225);
  expect(b).toBeLessThan(205);
  const out = removePaper(img);
  const at = (x: number, y: number) => (y * img.width + x) * 4;
  expect(out.data[at(5, 5) + 3]).toBe(0);
  expect(out.data[at(190, 150) + 3]).toBe(0);
  expect(out.data[at(90, 90) + 3]).toBe(255);
  // 白平衡：墨水的藍色分量被拉高（紙偏黃 → 補藍）
  expect(out.data[at(90, 90) + 2]).toBeGreaterThan(90);
  expect(contentBox(out)).toEqual({ x: 60, y: 40, w: 60, h: 100 });
  // 整張都是紙：沒有內容
  const blank = removePaper({ data: new Uint8ClampedArray(40 * 40 * 4).fill(240), width: 40, height: 40 });
  expect(contentBox(blank)).toBeNull();
});

test('裁切與擺放：背景裁成 2304×1080 的比例；立繪與物品底部貼齊、左右置中', () => {
  // 直式照片當背景：上下裁掉
  const c = coverCrop(3000, 4000, 2304, 1080);
  expect(c.w).toBe(3000);
  expect(c.h).toBe(Math.round(3000 / (2304 / 1080)));
  expect(c.y).toBe(Math.round((4000 - c.h) / 2));
  // 很寬的照片：左右裁掉
  const d = coverCrop(5000, 1000, 2304, 1080);
  expect(d.h).toBe(1000);
  expect(d.x).toBe(Math.round((5000 - d.w) / 2));

  const ch = fitCutout('char', 300, 900);
  expect([ch.canvasW, ch.canvasH]).toEqual([1000, 1800]);
  expect(ch.y + ch.h).toBe(1800);
  expect(Math.abs(ch.x * 2 + ch.w - 1000)).toBeLessThanOrEqual(1);
  expect(ch.h).toBeLessThanOrEqual(1800);

  const fg = fitCutout('fg', 400, 200);
  expect(fg.canvasW).toBe(900);
  expect(fg.y + fg.h).toBe(fg.canvasH);
  expect(fg.w).toBeLessThanOrEqual(900);
});

test('圖庫：有背景也有物品，依名稱把像的排前面', () => {
  expect(GALLERY.filter((g) => g.kind === 'bg').length).toBeGreaterThanOrEqual(6);
  expect(GALLERY.filter((g) => g.kind === 'fg').length).toBeGreaterThanOrEqual(6);
  expect(new Set(GALLERY.map((g) => g.id)).size).toBe(GALLERY.length);
  expect(galleryFor('bg', 'kitchen_morning')[0].id).toBe('kitchen');
  expect(galleryFor('bg', 'a1_classroom')[0].id).toBe('classroom');
  expect(galleryFor('fg', 'old_photo')[0].id).toBe('photo');
});

test('引導網站：上傳照片當背景（自動裁切）、從圖庫選，遊戲裡看得到', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.click('[data-guide=begin]');
  await page.click('[data-guide=start-blank]');
  await expect(page.locator('[data-guide=progress]')).toContainText('第 1 步');
  await page.goto('./#/step/7');
  await page.locator('[data-guide=drawings-alt] summary').click();
  const row = page.locator('[data-drawing="bg/room"]');
  await expect(row).toBeVisible();
  await expect(row.locator('.g-thumb')).toContainText('還沒有圖');

  // 在瀏覽器裡做一張直式「照片」
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 800;
    const g = c.getContext('2d')!;
    g.fillStyle = '#e8dcc0';
    g.fillRect(0, 0, 600, 800);
    g.fillStyle = '#335';
    g.fillRect(200, 300, 200, 200);
    return c.toDataURL('image/png').split(',')[1];
  });
  await row.locator('input[name=drawing-file]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(row.locator('[data-guide=drawing-status]')).toContainText('已放進專案：room.webp（2304×1080（上下裁掉一點））');
  await expect(row.locator('.g-thumb img')).toBeVisible();
  const size = await row.locator('.g-thumb img').evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
  expect(size).toEqual([2304, 1080]);

  // 從圖庫選
  await row.locator('[data-guide=gallery] summary').click();
  await row.locator('[data-gallery=bedroom]').click();
  await expect(row.locator('[data-guide=drawing-status]')).toContainText('圖庫：臥室');

  // 遊戲裡用的是專案裡的圖，不是佔位圖
  await page.goto('./play.html?local=1&timescale=0.2');
  await page.click('.start-button');
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('.bg')!).backgroundImage))
    .toContain('blob:');
  expect(errors).toEqual([]);
});

test('手繪立繪：白紙上的人物去背、底部貼齊，放成 1000×1800 的透明圖', async ({ page }) => {
  await page.goto('./');
  await page.click('[data-guide=begin]');
  await page.click('[data-guide=start-example]');
  await expect(page.locator('[data-guide=progress]')).toContainText('第 1 步');
  await page.goto('./#/step/7');
  await page.locator('[data-guide=drawings-alt] summary').click();
  const row = page.locator('[data-drawing^="char/"]').first();
  await expect(row).toBeVisible();
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 900;
    c.height = 1200;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f0e8d4';
    g.fillRect(0, 0, 900, 1200);
    g.fillStyle = '#2a3a5a';
    g.beginPath();
    g.arc(450, 300, 90, 0, Math.PI * 2);
    g.fill();
    g.fillRect(360, 400, 180, 600);
    return c.toDataURL('image/png').split(',')[1];
  });
  await row.locator('input[name=drawing-file]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect(row.locator('[data-guide=drawing-status]')).toContainText('1000×1800，已去掉白紙背景');
  const info = await row.locator('.g-thumb img').evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const a = (x: number, y: number) => g.getImageData(x, y, 1, 1).data[3];
    return { w: c.width, h: c.height, corner: a(5, 5), body: a(500, 1700), bottom: a(500, 1799) };
  });
  expect(info).toMatchObject({ w: 1000, h: 1800, corner: 0 });
  expect(info.body).toBeGreaterThan(200);
  expect(info.bottom).toBeGreaterThan(100);
});
