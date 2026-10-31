import { expect, test } from '@playwright/test';
import { advance, jumpTo, openWithTestScript, startGame } from './helpers';

test.beforeEach(async ({ page }) => {
  await openWithTestScript(page);
});

test('ADV 介面：人名、台詞、功能列七個按鈕', async ({ page }) => {
  await startGame(page);
  await expect(page.locator('.dialog .text')).toHaveText('旁白第一句。');
  await expect(page.locator('.namebox')).toHaveClass(/hidden/);
  await advance(page);
  await expect(page.locator('.namebox .name')).toHaveText('阿明哥');
  await expect(page.locator('.sprite')).toBeVisible();
  for (const key of ['back', 'auto', 'skip', 'log', 'hide', 'settings', 'title']) {
    await expect(page.locator(`.tool-${key}`)).toBeVisible();
    await expect(page.locator(`.tool-${key}`)).toBeEnabled();
  }
});

test('內心獨白：不顯示人名框，在畫面中央偏上淡入，停留後淡出並自動前進', async ({ page }) => {
  await startGame(page);
  await advance(page);
  await advance(page);
  await expect(page.locator('.monologue')).toHaveClass(/show/);
  await expect(page.locator('.monologue-text')).toHaveText('獨白第一句。');
  await expect(page.locator('#stage')).toHaveClass(/monologue-on/);
  const font = await page.locator('.monologue-text').evaluate((n) => getComputedStyle(n).fontFamily);
  expect(font).not.toBe(await page.locator('.dialog').evaluate((n) => getComputedStyle(n).fontFamily));
  // 自動前進到下一句
  await expect(page.locator('.dialog .text')).toHaveText('旁白第二句。', { timeout: 5000 });
});

test('眨眼轉場：換場景時上下眼皮合攏再張開', async ({ page }) => {
  await startGame(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-blink', 'open');
  await page.keyboard.press('Backquote');
  await page.selectOption('select[name=dev-scene]', 'fx_text');
  await page.click('[data-dev=jump]');
  await expect(page.locator('.blink')).toHaveClass(/closed/);
  await expect(page.locator('.blink')).not.toHaveClass(/closed/);
});

test('回上一句、對話紀錄、隱藏介面、設定、回標題', async ({ page }) => {
  await startGame(page);
  await advance(page);
  await expect(page.locator('.dialog .text')).toHaveText('角色第一句。');
  await page.click('.tool-back');
  await expect(page.locator('.dialog .text')).toHaveText('旁白第一句。');

  await page.click('.tool-log');
  await expect(page.locator('.log-overlay')).toBeVisible();
  await expect(page.locator('.log-row')).toHaveCount(1);
  await page.keyboard.press('Escape');

  await page.click('.tool-hide');
  await expect(page.locator('#stage')).toHaveClass(/ui-hidden/);
  await advance(page);
  await expect(page.locator('#stage')).not.toHaveClass(/ui-hidden/);

  await page.click('.tool-settings');
  await expect(page.locator('input[name=textSpeed]')).toBeVisible();
  await expect(page.locator('input[name=volume]')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.click('.tool-title');
  await expect(page.locator('.title-screen')).toBeVisible();
});

test('自動播放與快轉', async ({ page }) => {
  await startGame(page);
  await page.click('.tool-auto');
  await expect(page.locator('.tool-auto')).toHaveClass(/active/);
  await expect(page.locator('.dialog .text')).toHaveText('角色第一句。', { timeout: 5000 });
  await page.click('.tool-auto');
  await page.click('.tool-skip');
  // 快轉停在選項
  await expect(page.locator('.choices.open .choice')).toHaveCount(2, { timeout: 5000 });
  await expect(page.locator('.tool-skip')).not.toHaveClass(/active/);
});

test('結局條件依序判定，最後一條是 fallback', async ({ page }) => {
  await startGame(page);
  await page.click('.tool-skip');
  await page.locator('.choice').nth(1).click();
  await expect(page.locator('#stage')).toHaveAttribute('data-scene', 'end_y');
  await expect(page.locator('.dialog .text')).toHaveText('結局 Y。');
  await advance(page);
  await expect(page.locator('.ending-screen.open')).toBeVisible();
  await expect(page.locator('.ending-screen')).toHaveAttribute('data-ending-id', 'ending_y');
  await expect(page.locator('.ending-title')).toHaveText('結局Y');
});

test('ui 覆寫：skip disabled、settings hidden、log corrupt', async ({ page }) => {
  await jumpTo(page, 'ui_scene');
  await expect(page.locator('.tool-skip')).toBeDisabled();
  await expect(page.locator('.tool-settings')).toBeHidden();
  await expect(page.locator('.tool-log')).toHaveAttribute('data-override', 'corrupt');
  for (let i = 0; i < 6; i++) await advance(page);
  await page.click('.tool-log');
  await expect(page.locator('.log-overlay')).toHaveClass(/corrupt/);
  // 7 句裡隨機刪掉幾句，人名套 name_fade
  expect(await page.locator('.log-row').count()).toBeLessThan(7);
  expect(await page.locator('.log-name.fx-name-fade').count()).toBeGreaterThan(0);
  await expect(page.locator('.log-name').first()).not.toHaveText('阿明哥');
});

test('ui 覆寫：back wrong_scene 跳到 backTarget', async ({ page }) => {
  await jumpTo(page, 'ui_scene');
  await advance(page);
  await page.click('.tool-back');
  await expect(page.locator('#stage')).toHaveAttribute('data-scene', 't_start');
});

test('ui 覆寫：auto skips_lines 會跳過台詞', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.1;
  });
  await page.reload();
  await jumpTo(page, 'ui_scene');
  await page.click('.tool-auto');
  await expect(page.locator('#stage')).toHaveAttribute('data-auto-skipped', /[1-9]/, { timeout: 10000 });
});

test('ui 覆寫只影響該場景，換場景後恢復正常', async ({ page }) => {
  await jumpTo(page, 'ui_scene');
  await expect(page.locator('.tool-skip')).toBeDisabled();
  await jumpTo(page, 'fx_text');
  await expect(page.locator('.tool-skip')).toBeEnabled();
  await expect(page.locator('.tool-settings')).toBeVisible();
});

test('立繪依 gaze 與 distance 變化，省略時沿用上一句', async ({ page }) => {
  await jumpTo(page, 'pose');
  const sprite = page.locator('.sprite');
  await expect(sprite).toHaveAttribute('data-gaze', 'camera');
  await expect(sprite).toHaveAttribute('data-expression', 'smile');
  await advance(page);
  await expect(sprite).toHaveAttribute('data-gaze', 'away');
  await expect(sprite).toHaveAttribute('data-distance', 'near');
  await expect.poll(() => sprite.evaluate((n) => getComputedStyle(n).getPropertyValue('--ds').trim())).toBe('1.25');
  await advance(page);
  await expect(sprite).toHaveAttribute('data-gaze', 'other');
  await expect(sprite).toHaveAttribute('data-distance', 'far');
  await advance(page);
  await expect(sprite).toHaveAttribute('data-gaze', 'other');
  await expect(sprite).toHaveAttribute('data-distance', 'far');
  await expect(sprite).toHaveAttribute('data-expression', 'smile');
  // 開發者面板切換
  await page.keyboard.press('Backquote');
  await page.selectOption('select[name=dev-gaze]', 'camera');
  await page.selectOption('select[name=dev-distance]', 'near');
  await expect(sprite).toHaveAttribute('data-gaze', 'camera');
  await expect(sprite).toHaveAttribute('data-distance', 'near');
});

test('熱點選項：發光圓點、hover 顯示文字、點擊跳轉', async ({ page }) => {
  await jumpTo(page, 'ch_hot');
  const spots = page.locator('.hotspot');
  await expect(spots).toHaveCount(2);
  await expect(page.locator('.hotspot-prompt')).toHaveText('點一個');
  const label = spots.nth(1).locator('.label');
  await expect(label).toHaveCSS('opacity', '0');
  await spots.nth(1).hover();
  await expect(label).toHaveCSS('opacity', '1');
  const box = await spots.nth(1).boundingBox();
  expect(box!.x + box!.width / 2).toBeGreaterThan(1280 * 0.7);
  await spots.nth(1).click();
  await expect(page.locator('#stage')).toHaveAttribute('data-scene', 'flat_b');
});

test('前景層與背景 1.2 倍寬', async ({ page }) => {
  await jumpTo(page, 'fx_wrong_fg');
  await expect(page.locator('.fg')).toBeVisible();
  await expect(page.locator('.fg')).toHaveAttribute('data-name', 'cup');
  const bg = await page.locator('.bg').boundingBox();
  const stage = await page.locator('#stage').boundingBox();
  expect(bg!.width / stage!.width).toBeGreaterThan(1.15);
});

test('音樂：找不到檔案時用合成音，有檔案時播放檔案', async ({ page }) => {
  await startGame(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-music', 'test_music');
  await expect(page.locator('#stage')).toHaveAttribute('data-audio-mode', 'synth');
});

test('音樂：有音檔時改播檔案', async ({ page }) => {
  // 產生一秒的 WAV（decodeAudioData 會依內容判斷格式）
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
  for (let i = 0; i < sr; i++) buf.writeInt16LE(Math.round(Math.sin((i / sr) * 2 * Math.PI * 220) * 6000), 44 + i * 2);
  await page.route('**/assets/music/test_music.ogg', (r) => r.fulfill({ contentType: 'audio/ogg', body: buf }));
  await startGame(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-audio-mode', 'file');
});

test('素材：找不到圖檔時使用佔位圖，有圖檔時使用圖檔', async ({ page }) => {
  // 1×1 PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.route('**/assets/char/amin_neutral.png', (r) => r.fulfill({ contentType: 'image/png', body: png }));
  await startGame(page);
  await expect(page.locator('.bg')).toHaveAttribute('style', /data:image\/png/);
  await advance(page);
  await expect(page.locator('.sprite')).toHaveAttribute('src', /assets\/char\/amin_neutral\.png$/);
});

test('開發者面板：預設關閉，按 ` 開關，顯示數值與旗標，可重置', async ({ page }) => {
  await expect(page.locator('.devpanel')).toBeHidden();
  await page.keyboard.press('Backquote');
  await expect(page.locator('.devpanel')).toBeVisible();
  await page.click('[data-dev=reset]');
  await expect(page.locator('#stage')).toHaveAttribute('data-scene', 't_start');
  await expect(page.locator('.dev-stat[data-stat=trust]')).toBeVisible();
  await expect(page.locator('.dev-stat[data-stat=lucidity]')).toBeVisible();
  await expect(page.locator('.dev-status')).toContainText('t_start');
  await page.locator('.dev-stat[data-stat=trust] button').nth(1).click();
  await expect(page.locator('.dev-stat[data-stat=trust] strong')).toHaveText('1');
  await page.keyboard.press('Backquote');
  await expect(page.locator('.devpanel')).toBeHidden();
});

test.describe('手機直式', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('功能列收合成一個按鈕', async ({ page }) => {
    await startGame(page);
    await expect(page.locator('.menu-toggle')).toBeVisible();
    await expect(page.locator('.tool-log')).toBeHidden();
    await page.click('.menu-toggle');
    await expect(page.locator('.tool-log')).toBeVisible();
    const box = await page.locator('.tool-log').boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await page.click('.tool-log');
    await expect(page.locator('.log-overlay')).toBeVisible();
  });

  test('長按熱點顯示文字而不選擇', async ({ page }) => {
    await jumpTo(page, 'ch_hot');
    const spot = page.locator('.hotspot').first();
    const box = (await spot.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect(spot).toHaveClass(/show-label/);
    await expect(page.locator('#stage')).toHaveAttribute('data-scene', 'ch_hot');
  });
});
