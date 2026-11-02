// 呈現調整：轉場樣式、立繪構圖、物件提示、音樂試聽，以及從開發者面板存檔。
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { structureOf } from '../src/editable';
import { validateScript } from '../src/script';
import type { Script } from '../src/types';
import { currentText, jumpTo, openWithTestScript, testScript } from './helpers';

const openPanel = (page: Page) => page.keyboard.press('Backquote');

test.describe('轉場樣式', () => {
  for (const [style, check] of [
    ['blink', (p: Page) => expect(p.locator('.blink')).toHaveClass(/closed/)],
    ['blink_soft', (p: Page) => expect(p.locator('.blink')).toHaveClass(/closed/)],
    ['fade', (p: Page) => expect(p.locator('.fade-curtain')).toHaveClass(/on/)],
    ['focus', (p: Page) => expect(p.locator('#stage')).toHaveClass(/focus-out/)],
  ] as const) {
    test(`${style}：換場景時套用這個樣式`, async ({ page }) => {
      await openWithTestScript(page, 'timescale=1', { mutate: (s) => (s.meta.transition = style) });
      await jumpTo(page, 'fx_text');
      await expect(page.locator('#stage')).toHaveAttribute('data-transition', style);
      await openPanel(page);
      await page.selectOption('select[name=dev-scene]', 'fx_name');
      await page.click('[data-dev=jump]');
      await check(page);
      await expect(page.locator('#stage')).toHaveAttribute('data-blink', 'open', { timeout: 5000 });
      await expect(page.locator('#stage')).toHaveAttribute('data-scene', 'fx_name');
    });
  }

  test('開發者面板切換並預覽', async ({ page }) => {
    await openWithTestScript(page, 'timescale=1');
    await jumpTo(page, 'fx_text');
    await openPanel(page);
    await page.selectOption('select[name=dev-transition]', 'fade');
    await expect(page.locator('#stage')).toHaveAttribute('data-transition', 'fade');
    await page.click('[data-dev=preview-transition]');
    await expect(page.locator('.fade-curtain')).toHaveClass(/on/);
    await expect(page.locator('.fade-curtain')).not.toHaveClass(/on/, { timeout: 5000 });
    await expect(currentText(page)).toHaveText(/./);
  });
});

test.describe('立繪構圖', () => {
  const height = (page: Page) =>
    page.evaluate(() => document.querySelector('.sprite')!.getBoundingClientRect().height / document.querySelector('#stage')!.getBoundingClientRect().height);

  test('meta.sprite 是所有角色的預設，角色自己的 sprite 覆寫它', async ({ page }) => {
    await openWithTestScript(page, undefined, {
      mutate: (s) => {
        s.meta.sprite = { scale: 2, y: -80 };
      },
    });
    await jumpTo(page, 'pose');
    const sprite = page.locator('.sprite');
    await expect(sprite).toHaveAttribute('style', /--sprite-scale: 2/);
    await expect(sprite).toHaveAttribute('style', /--sprite-y: -80/);
    // 原本的身高 94% × 2；transform 的縮放不算在 bounding box 高度的比例內，所以用寬鬆範圍
    expect(await height(page)).toBeGreaterThan(1.6);
  });

  test('開發者面板拉桿即時調整，套用到所有角色', async ({ page }) => {
    await openWithTestScript(page);
    await jumpTo(page, 'pose');
    await openPanel(page);
    await expect(page.locator('select[name=dev-sprite-char]')).toHaveValue('amin');
    await page.locator('input[name=dev-sprite-scale]').fill('1.8');
    await expect(page.locator('.sprite')).toHaveAttribute('style', /--sprite-scale: 1.8/);
    await page.locator('input[name=dev-sprite-y]').fill('-60');
    await expect(page.locator('.sprite')).toHaveAttribute('style', /--sprite-y: -60/);
    const own = await page.evaluate(() => (window as unknown as { __vn: { engine: { script: Script } } }).__vn.engine.script.characters[0].sprite);
    expect(own).toEqual({ scale: 1.8, y: -60 });
    await page.click('[data-dev=sprite-all]');
    const meta = await page.evaluate(() => (window as unknown as { __vn: { engine: { script: Script } } }).__vn.engine.script.meta.sprite);
    expect(meta).toEqual({ scale: 1.8, y: -60 });
  });
});

test.describe('物件提示', () => {
  test('預設是物品本身發亮；可以切回圓圈', async ({ page }) => {
    await openWithTestScript(page);
    await jumpTo(page, 'obj_scene');
    await expect(currentText(page)).toHaveText('物件第一句。');
    await expect(page.locator('#stage')).toHaveAttribute('data-highlight', 'glow');
    const filter = await page.locator('.object-spot[data-object="o_phone"] .glow').evaluate((n) => getComputedStyle(n).backdropFilter);
    expect(filter).toContain('brightness');
    await openPanel(page);
    await page.selectOption('select[name=dev-highlight]', 'ring');
    await expect(page.locator('#stage')).toHaveAttribute('data-highlight', 'ring');
    const filter2 = await page.locator('.object-spot[data-object="o_phone"] .glow').evaluate((n) => getComputedStyle(n).backdropFilter);
    expect(filter2).toBe('none');
  });
});

test.describe('音樂', () => {
  test('改這個場景的音樂、用電腦裡的檔案試聽', async ({ page }) => {
    await openWithTestScript(page);
    await jumpTo(page, 'music_scene');
    await expect(page.locator('#stage')).toHaveAttribute('data-music', 'scene_song');
    await openPanel(page);
    await expect(page.locator('input[name=dev-music]')).toHaveValue('scene_song');
    await page.locator('input[name=dev-music]').fill('other_song');
    await page.click('[data-dev=apply-music]');
    await expect(page.locator('#stage')).toHaveAttribute('data-music', 'other_song');
    await expect(page.locator('#stage')).toHaveAttribute('data-audio-mode', 'synth');
    // 一秒的 WAV
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
    await page.setInputFiles('input[name=dev-music-file]', { name: 'test.wav', mimeType: 'audio/wav', buffer: buf });
    await expect(page.locator('#stage')).toHaveAttribute('data-audio-mode', 'file');
    await expect(page.locator('.devpanel')).toContainText('正在用「test.wav」試聽「other_song」');
  });
});

test.describe('存檔', () => {
  test('線上版：儲存調整會下載含呈現設定的 script.json', async ({ page }) => {
    await openWithTestScript(page);
    await jumpTo(page, 'pose');
    await openPanel(page);
    await page.selectOption('select[name=dev-transition]', 'focus');
    await page.locator('input[name=dev-sprite-scale]').fill('2.1');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-dev=save-presentation]')]);
    const saved = JSON.parse(await readFile(await download.path(), 'utf8')) as Script;
    expect(saved.meta.transition).toBe('focus');
    expect(saved.characters[0].sprite?.scale).toBe(2.1);
    expect(structureOf(saved)).toBe(structureOf(testScript()));
    await expect(page.locator('.devpanel')).toContainText('已下載');
  });

  test('呈現設定的改變不算結構改變（本機可以寫回）', () => {
    const a = testScript();
    const b = testScript();
    b.meta.transition = 'fade';
    b.meta.objectHighlight = 'ring';
    b.meta.sprite = { scale: 2, y: -90 };
    b.characters[0].sprite = { scale: 1.5 };
    b.scenes[0].music = 'another';
    expect(structureOf(b)).toBe(structureOf(a));
  });

  test('腳本檢查：呈現設定的值不合法', () => {
    const s = testScript();
    s.meta.transition = 'wipe' as never;
    s.meta.objectHighlight = 'box' as never;
    s.meta.sprite = { scale: -1 };
    const problems = validateScript(s).join('\n');
    expect(problems).toContain('meta.transition');
    expect(problems).toContain('meta.objectHighlight');
    expect(problems).toContain('meta.sprite.scale');
  });
});
