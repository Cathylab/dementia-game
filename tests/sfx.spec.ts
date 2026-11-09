// 音效（sfx）與台詞中換音樂：播放、腳本檢查、故事編輯器的「♪ 聲音」、上傳。
import { expect, test, type Page } from '@playwright/test';
import { assetNames } from '../src/assetnames';
import { validateScript } from '../src/script';
import type { Script, TextLine } from '../src/types';
import { advance, openWithTestScript, startGame, testScript } from './helpers';

/** 無聲 WAV。 */
function wav(seconds = 0.3): Buffer {
  const sr = 8000;
  const n = Math.round(sr * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  return buf;
}

async function serveSfx(page: Page, files: string[]): Promise<string[]> {
  const requested: string[] = [];
  await page.route('**/assets/sfx/manifest.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(files) }));
  await page.route('**/assets/sfx/*.mp3', (r) => {
    requested.push(r.request().url());
    return r.fulfill({ contentType: 'audio/mpeg', body: wav() });
  });
  return requested;
}

const withSfx = (s: Script) => {
  (s.scenes[0].lines[0] as TextLine).sfx = 'ding';
  (s.scenes[0].lines[3] as TextLine).sfx = 'missing_one';
};

test('台詞的 sfx：出現時播一次；缺檔時不發請求', async ({ page }) => {
  const requested = await serveSfx(page, ['ding.mp3']);
  await openWithTestScript(page, 'timescale=0.2', { mutate: withSfx });
  await startGame(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-sfx', 'ding');
  await expect(page.locator('#stage')).toHaveAttribute('data-sfx-state', /playing|ended/);
  for (let i = 0; i < 3; i++) await advance(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-sfx', 'missing_one');
  await expect(page.locator('#stage')).toHaveAttribute('data-sfx-state', 'missing');
  expect(requested.some((u) => u.includes('missing_one'))).toBe(false);
  expect(requested.some((u) => u.endsWith('/ding.mp3'))).toBe(true);
});

test('腳本檢查與素材清單：sfx 名稱格式；音效算進素材', () => {
  const s = testScript();
  withSfx(s);
  expect(validateScript(s).filter((p) => p.includes('sfx'))).toEqual([]);
  expect(assetNames(s, 'sfx')).toEqual(['ding', 'missing_one']);
  (s.scenes[0].lines[0] as TextLine).sfx = '門鈴 聲';
  expect(validateScript(s).some((p) => p.includes('t_start.lines[0].sfx'))).toBe(true);
});

test('故事編輯器：在台詞設定音效、從這句開始換音樂或停止', async ({ page }) => {
  await serveSfx(page, ['ding.mp3']);
  await openWithTestScript(page);
  await page.keyboard.press('Backquote');
  await page.click('[data-dev=story]');
  await page.click('.story-scene-item[data-scene=t_start]');
  const line = page.locator('.story-line[data-line="1"]');
  await expect(line.locator('.story-sound')).toBeHidden();
  await line.locator('[data-story=sound]').click();
  await line.locator('input[name=story-sfx]').fill('ding');
  await line.locator('input[name=story-sfx]').press('Tab');
  await line.locator('select[name=story-line-music-mode]').selectOption('set');
  await line.locator('input[name=story-line-music]').fill('rain_night');
  await line.locator('input[name=story-line-music]').press('Tab');
  await line.locator('[data-story=hear-sfx]').click();
  await expect(page.locator('#stage')).toHaveAttribute('data-sfx', 'ding');

  const stop = page.locator('.story-line[data-line="2"]');
  await stop.locator('[data-story=sound]').click();
  await stop.locator('select[name=story-line-music-mode]').selectOption('stop');

  const lines = await page.evaluate(() => (window as unknown as { __vn: { engine: { script: Script } } }).__vn.engine.script.scenes[0].lines);
  expect(lines[1]).toMatchObject({ sfx: 'ding', music: 'rain_night' });
  expect((lines[2] as TextLine).music).toBeNull();
  await expect(page.locator('.story-problems')).toContainText('沒有問題');

  // 有設定的台詞重畫後預設打開
  await page.click('.story-scene-item[data-scene=pose]');
  await page.click('.story-scene-item[data-scene=t_start]');
  await expect(page.locator('.story-line[data-line="1"] .story-sound')).toBeVisible();
  await expect(page.locator('.story-line[data-line="0"] .story-sound')).toBeHidden();
});

test('上傳素材：音效放進遊戲後馬上播一次，之後台詞也播得到', async ({ page }) => {
  await page.route('**/assets/sfx/manifest.json', (r) => r.fulfill({ contentType: 'application/json', body: '[]' }));
  await openWithTestScript(page, 'timescale=0.2', { mutate: withSfx });
  await startGame(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-sfx-state', 'missing');
  await page.keyboard.press('Backquote');
  await page.selectOption('select[name=dev-upload-kind]', 'sfx');
  await expect(page.locator('select[name=dev-upload-name] option[value=ding]')).toHaveText('ding（缺）');
  await page.setInputFiles('input[name=dev-upload-file]', { name: 'ding.wav', mimeType: 'audio/wav', buffer: wav() });
  await expect(page.locator('details[data-section=上傳素材]')).toContainText('1 / 1 個檔案已放進遊戲');
  await expect(page.locator('#stage')).toHaveAttribute('data-sfx-state', /playing|ended/);
  const has = await page.evaluate(() =>
    (window as unknown as { __vn: { view: { audio: { hasSfx(n: string): Promise<boolean> } } } }).__vn.view.audio.hasSfx('ding'),
  );
  expect(has).toBe(true);
});

test('meta.sfxVolume：每個音效各自的音量；開發者面板可調、試聽；格式錯誤會警告', async ({ page }) => {
  const s0 = testScript();
  withSfx(s0);
  s0.meta.sfxVolume = { ding: 0.4 };
  expect(validateScript(s0).filter((p) => p.includes('sfxVolume'))).toEqual([]);
  s0.meta.sfxVolume = { ding: 2 };
  expect(validateScript(s0)).toContain('（警告）meta.sfxVolume.ding 必須是 0～1 的數字');

  await serveSfx(page, ['ding.mp3']);
  await openWithTestScript(page, 'timescale=0.2', {
    mutate: (s) => {
      withSfx(s);
      s.meta.sfxVolume = { ding: 0.4 };
    },
  });
  await startGame(page);
  await expect(page.locator('#stage')).toHaveAttribute('data-sfx', 'ding');
  await expect(page.locator('#stage')).toHaveAttribute('data-sfx-level', '0.4');

  await page.keyboard.press('Backquote');
  const range = page.locator('input[name="dev-sfx-volume-ding"]');
  await expect(range).toHaveValue('0.4');
  await range.fill('0.75');
  expect(await page.evaluate(() => (window as any).__vn.engine.script.meta.sfxVolume)).toEqual({ ding: 0.75 });
  await page.click('[data-dev=sfx-preview][data-sfx=ding]');
  await expect(page.locator('#stage')).toHaveAttribute('data-sfx-level', '0.75');
  // 沒寫的音效當 1
  await page.click('[data-dev=sfx-preview][data-sfx=missing_one]');
  await expect(page.locator('#stage')).toHaveAttribute('data-sfx-level', '1');
});
