// 章節卡、開發者面板的收合與摺疊、上傳素材。
import { expect, test, type Page } from '@playwright/test';
import { advance, currentText, jumpTo, openWithTestScript } from './helpers';

const openPanel = (page: Page) => page.keyboard.press('Backquote');

// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** 一秒的無聲 WAV。 */
function wav(): Buffer {
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
  return buf;
}

test.describe('章節卡', () => {
  test('每一幕開頭顯示「第幾章」與 title 裡「・」前面的時間；chapter 可以覆寫；點一下跳過', async ({ page }) => {
    await openWithTestScript(page, 'timescale=1', {
      mutate: (s) => {
        s.scenes.find((x) => x.id === 't_start')!.title = '婚禮前半年・開始';
        s.scenes.find((x) => x.id === 'act3')!.chapter = '婚禮當天';
      },
    });
    await page.click('.start-button');
    const card = page.locator('.chapter-card');
    await expect(card).toHaveClass(/show/);
    await expect(card.locator('.chapter-no')).toHaveText('第一章');
    await expect(card.locator('.chapter-time')).toHaveText('婚禮前半年');
    // 卡片還在時，場景還沒換上
    await expect(page.locator('#stage')).not.toHaveAttribute('data-scene', 't_start');
    await card.click();
    await expect(card).toBeHidden();
    await expect(page.locator('#stage')).toHaveAttribute('data-scene', 't_start');
    await expect(currentText(page)).toHaveText('旁白第一句。');

    // 同一幕的下一個場景不再出現
    await advance(page);
    await jumpTo(page, 'pose');
    await expect(card).toBeHidden();

    await openPanel(page);
    await page.selectOption('select[name=dev-scene]', 'act3');
    await page.click('[data-dev=jump]');
    await expect(card).toHaveClass(/show/);
    await expect(card.locator('.chapter-no')).toHaveText('第三章');
    await expect(card.locator('.chapter-time')).toHaveText('婚禮當天');
    await page.keyboard.press('Backquote');
    await page.keyboard.press('Enter');
    await expect(card).toBeHidden();
    await expect(page.locator('#stage')).toHaveAttribute('data-scene', 'act3');
  });

  test('title 沒有「・」、也沒有 chapter 的幕不顯示章節卡', async ({ page }) => {
    await openWithTestScript(page);
    await page.click('.start-button');
    await expect(page.locator('#stage')).toHaveAttribute('data-scene', 't_start');
    await expect(page.locator('.chapter-card')).toBeHidden();
  });
});

test.describe('開發者面板', () => {
  test('可以收合成標題列再展開，各區塊可以摺疊，重新整理後記得', async ({ page }) => {
    await openWithTestScript(page, 'timescale=0.2&dev=1');
    const panel = page.locator('.devpanel');
    const status = panel.locator('details[data-section=目前狀態]');
    await expect(status.locator('.dev-status')).toBeVisible();

    await page.click('[data-dev=collapse]');
    await expect(panel).toHaveClass(/collapsed/);
    await expect(panel.locator('h2')).toBeVisible();
    await expect(status).toBeHidden();
    const box = (await panel.boundingBox())!;
    expect(box.height).toBeLessThan(80);
    await panel.locator('h2').click();
    await expect(status.locator('.dev-status')).toBeVisible();

    await status.locator('summary').click();
    await expect(status.locator('.dev-status')).toBeHidden();
    await page.click('[data-dev=collapse]');
    await page.reload();
    await expect(panel).toHaveClass(/collapsed/);
    // 用鍵盤打開時一律展開；摺疊的區塊維持摺疊
    await openPanel(page);
    await openPanel(page);
    await expect(panel).not.toHaveClass(/collapsed/);
    await expect(status.locator('.dev-status')).toBeHidden();
    await expect(panel.locator('details[data-section=跳到場景] select')).toBeVisible();

    await page.click('[data-dev=fold-all]');
    await expect(panel.locator('details.dev-section[open]')).toHaveCount(0);
    await page.click('[data-dev=fold-all]');
    await expect(panel.locator('details.dev-section:not([open])')).toHaveCount(0);
  });

  test('上傳素材：背景圖立刻換上並轉成 webp，配音依檔名對應', async ({ page }) => {
    await openWithTestScript(page);
    await page.click('.start-button');
    await expect(page.locator('#stage')).toHaveAttribute('data-scene', 't_start');
    await openPanel(page);
    const section = page.locator('details[data-section=上傳素材]');

    await page.selectOption('select[name=dev-upload-kind]', 'bg');
    await expect(page.locator('select[name=dev-upload-name] option[value=test_room]')).toHaveText('test_room（缺）');
    await page.selectOption('select[name=dev-upload-name]', 'test_room');
    // 3000×1500 的漸層圖：會縮成 2560 寬並轉成 webp
    const big = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 3000;
      c.height = 1500;
      const g = c.getContext('2d')!;
      const grad = g.createLinearGradient(0, 0, 3000, 1500);
      grad.addColorStop(0, '#c96');
      grad.addColorStop(1, '#369');
      g.fillStyle = grad;
      g.fillRect(0, 0, 3000, 1500);
      return c.toDataURL('image/png').split(',')[1];
    });
    await page.setInputFiles('input[name=dev-upload-file]', { name: '我的背景.png', mimeType: 'image/png', buffer: Buffer.from(big, 'base64') });
    await expect(page.locator('.bg')).toHaveAttribute('style', /blob:/);
    await expect(section.locator('.dev-uploads a')).toHaveAttribute('download', 'test_room.webp');
    await expect(section).toContainText('2560×1280，從 3000×1500 縮小');
    await expect(section).toContainText('1 / 1 個檔案已放進遊戲');
    await expect(page.locator('select[name=dev-upload-name] option[value=test_room]')).toHaveText('test_room（已上傳）');

    // 很小的圖轉成 webp 反而變大：維持原本的 png
    await page.setInputFiles('input[name=dev-upload-file]', { name: 'test_room.png', mimeType: 'image/png', buffer: PNG });
    await expect(section.locator('.dev-uploads a').first()).toHaveAttribute('download', 'test_room.png');

    await page.selectOption('select[name=dev-upload-kind]', 'voice');
    await page.setInputFiles('input[name=dev-upload-file]', [
      { name: 't_start_01_amin.wav', mimeType: 'audio/wav', buffer: wav() },
      { name: 'no_such_voice.wav', mimeType: 'audio/wav', buffer: wav() },
    ]);
    await expect(section).toContainText('2 / 2 個檔案已放進遊戲');
    await expect(section).toContainText('腳本裡沒有用到這個名稱');
    await expect(section).toContainText('正式檔案要是 mp3 或 ogg');
    const has = await page.evaluate(() =>
      (window as unknown as { __vn: { view: { audio: { hasVoice(id: string): Promise<boolean> } } } }).__vn.view.audio.hasVoice('t_start_01_amin'),
    );
    expect(has).toBe(true);
  });
});
