// 配音（v3）：播放、缺檔安靜、自動模式等聲音、略過不播、配音音量、紀錄重播、記憶對照、
// 選項提示、腳本檢查、開發者頁面「配音總表」。
import { readdir, readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { validateScript } from '../src/script';
import type { Script } from '../src/types';
import { voiceEntries } from '../src/voice';
import { advance, currentText, engineValue, jumpTo, openWithTestScript, startGame, testScript } from './helpers';

/** 產生指定秒數的 WAV（decodeAudioData 會依內容判斷格式，副檔名 .mp3 也能解）。 */
function wav(seconds: number): Buffer {
  const sr = 8000;
  const n = Math.round(sr * seconds);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / sr) * 2 * Math.PI * 330) * 4000), 44 + i * 2);
  return b;
}

/** 假裝 examples/寫給未來的我/assets/voice 裡有這些檔案（manifest 與檔案本身）。 */
async function serveVoices(page: Page, files: Record<string, number>) {
  await page.route('**/assets/voice/manifest.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(Object.keys(files)) }));
  for (const [file, seconds] of Object.entries(files)) {
    await page.route(`**/assets/voice/${file}`, (r) => r.fulfill({ contentType: file.endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg', body: wav(seconds) }));
  }
}

const stage = (page: Page) => page.locator('#stage');
const voicePlaying = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vn: { view: { audio: { voicePlaying: boolean } } } }).__vn.view.audio.voicePlaying);

test.describe('播放', () => {
  test('有音檔：台詞開始顯示時播放；點下一句時停止', async ({ page }) => {
    await serveVoices(page, { 't_start_01_amin.mp3': 3 });
    await openWithTestScript(page);
    await startGame(page);
    await advance(page);
    await expect(currentText(page)).toHaveText('角色第一句。');
    await expect(stage(page)).toHaveAttribute('data-voice', 't_start_01_amin');
    await expect(stage(page)).toHaveAttribute('data-voice-state', 'playing');
    await advance(page);
    // 下一句（獨白）也有編號但沒有音檔：上一句的聲音已停止，不會重疊
    await expect(stage(page)).toHaveAttribute('data-voice', 't_start_02_player');
    expect(await voicePlaying(page)).toBe(false);
  });

  test('找不到 .mp3 時改用 .ogg', async ({ page }) => {
    await serveVoices(page, { 't_start_01_amin.ogg': 3 });
    const requested: string[] = [];
    page.on('request', (r) => r.url().includes('/assets/voice/t_start') && requested.push(r.url()));
    await openWithTestScript(page);
    await startGame(page);
    await advance(page);
    await expect(stage(page)).toHaveAttribute('data-voice-state', 'playing');
    expect(requested.some((u) => u.endsWith('t_start_01_amin.ogg'))).toBe(true);
    expect(requested.some((u) => u.endsWith('.mp3'))).toBe(false);
  });

  test('缺檔：安靜播過，不請求音檔、主控台沒有錯誤', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    const requested: string[] = [];
    page.on('request', (r) => /\/assets\/voice\/(?!manifest)/.test(r.url()) && requested.push(r.url()));
    await openWithTestScript(page);
    await startGame(page);
    await advance(page);
    await expect(currentText(page)).toHaveText('角色第一句。');
    await expect(stage(page)).toHaveAttribute('data-voice-state', 'missing');
    await advance(page);
    await expect(currentText(page)).toHaveText('獨白第一句。');
    expect(requested).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('任何 speaker 都可以配音（這裡是主角的獨白）', async ({ page }) => {
    await serveVoices(page, { 't_start_02_player.mp3': 3 });
    await openWithTestScript(page);
    await startGame(page);
    await advance(page);
    await advance(page);
    await expect(page.locator('.monologue')).toHaveClass(/show/);
    await expect(stage(page)).toHaveAttribute('data-voice', 't_start_02_player');
    await expect(stage(page)).toHaveAttribute('data-voice-state', 'playing');
  });

  test('回上一句：重播那句的配音', async ({ page }) => {
    await serveVoices(page, { 't_start_01_amin.mp3': 3 });
    await openWithTestScript(page);
    await startGame(page);
    await advance(page);
    await expect(stage(page)).toHaveAttribute('data-voice-state', 'playing');
    await advance(page);
    expect(await voicePlaying(page)).toBe(false);
    await page.click('.tool-back');
    await expect(currentText(page)).toHaveText('角色第一句。');
    await expect(stage(page)).toHaveAttribute('data-voice-state', 'playing');
  });

  test('自動模式：等聲音播完才往下', async ({ page }) => {
    await serveVoices(page, { 't_start_01_amin.mp3': 2.5 });
    await openWithTestScript(page);
    await startGame(page);
    await advance(page);
    await expect(stage(page)).toHaveAttribute('data-voice-state', 'playing');
    await page.click('.tool-auto');
    // 沒有配音時約 0.3 秒就會往下；有配音要等 2.5 秒
    await page.waitForTimeout(1200);
    expect(await engineValue<number>(page, 'index')).toBe(1);
    await expect.poll(() => engineValue<number>(page, 'index'), { timeout: 5000 }).toBeGreaterThan(1);
  });

  test('快轉中不播配音', async ({ page }) => {
    await serveVoices(page, { 't_start_01_amin.mp3': 3 });
    await openWithTestScript(page);
    await startGame(page);
    await page.click('.tool-skip');
    await expect(page.locator('.choices.open .choice')).toHaveCount(2, { timeout: 5000 });
    expect(await stage(page).getAttribute('data-voice-state')).not.toBe('playing');
  });

  test('配音音量 0 等於關閉配音', async ({ page }) => {
    await serveVoices(page, { 't_start_01_amin.mp3': 3 });
    await openWithTestScript(page, undefined, { settings: { voiceVolume: 0 } });
    await startGame(page);
    await advance(page);
    await expect(currentText(page)).toHaveText('角色第一句。');
    await page.waitForTimeout(300);
    expect(await stage(page).getAttribute('data-voice-state')).not.toBe('playing');
  });

  test('選項的 prompt 有 voice 時，選項出現就播', async ({ page }) => {
    await serveVoices(page, { 'req_scene_01_amin.mp3': 3 });
    await openWithTestScript(page);
    await jumpTo(page, 'req_scene');
    await advance(page);
    await expect(page.locator('.choices.open')).toHaveCount(1);
    await expect(stage(page)).toHaveAttribute('data-voice', 'req_scene_01_amin');
    await expect(stage(page)).toHaveAttribute('data-voice-state', 'playing');
  });

  test('對話紀錄：有配音的句子有小喇叭，點了重播', async ({ page }) => {
    await serveVoices(page, { 't_start_01_amin.mp3': 3 });
    await openWithTestScript(page);
    await startGame(page);
    await advance(page);
    await advance(page);
    await page.click('.tool-log');
    // 獨白那句也有編號但還沒有音檔：不顯示喇叭
    await expect(page.locator('.log-row .voice-replay:visible')).toHaveCount(1);
    const speaker = page.locator('.log-row .voice-replay[data-voice="t_start_01_amin"]');
    await expect(speaker).toBeVisible();
    await speaker.click();
    await expect(stage(page)).toHaveAttribute('data-voice-state', 'playing');
  });

  test('記憶對照：說出 truth 時播 truthVoice', async ({ page }) => {
    await serveVoices(page, { 'mr_o_phone_amin.mp3': 3 });
    await openWithTestScript(page);
    await jumpTo(page, 't_end_choice');
    await page.evaluate(() => ((window as unknown as { __vn: { engine: { seen: string[] } } }).__vn.engine.seen = ['o_phone']));
    await page.locator('.choice[data-index="1"]').click();
    await expect(currentText(page)).toHaveText('結局 Y。');
    await advance(page);
    await advance(page);
    await expect(page.locator('.memory-card')).toHaveAttribute('data-object', 'o_phone');
    await expect(stage(page)).toHaveAttribute('data-voice', 'mr_o_phone_amin');
    await expect(stage(page)).toHaveAttribute('data-voice-state', 'playing');
  });
});

test.describe('設定', () => {
  test('設定畫面有配音音量，預設 0.9；可由 settingsDefaults.voiceVolume 改', async ({ page }) => {
    await openWithTestScript(page);
    await startGame(page);
    await page.click('.tool-settings');
    await expect(page.locator('.settings-overlay')).toContainText('配音音量');
    await expect(page.locator('.settings-overlay')).toContainText('音樂與音效音量');
    await expect(page.locator('input[name=voiceVolume]')).toHaveValue('0.9');
  });

  test('settingsDefaults.voiceVolume', async ({ page }) => {
    await openWithTestScript(page, undefined, { mutate: (s) => (s.meta.settingsDefaults = { voiceVolume: 0.5 }) });
    await startGame(page);
    await page.click('.tool-settings');
    await expect(page.locator('input[name=voiceVolume]')).toHaveValue('0.5');
  });
});

test.describe('腳本檢查：配音', () => {
  test('測試腳本與正式腳本都沒有問題', async () => {
    expect(validateScript(testScript())).toEqual([]);
  });

  test('編號重複、choice 有 voice 沒 prompt、truthVoice 沒 truth、格式不對', () => {
    const s = testScript();
    const start = s.scenes.find((x) => x.id === 't_start')!;
    (start.lines[3] as { voice?: string }).voice = 't_start_01_amin';
    const choice = s.scenes.find((x) => x.id === 't_end_choice')!.lines[0] as { voice?: string };
    choice.voice = 't_end_choice_01_amin';
    const glasses = s.scenes.find((x) => x.id === 'obj_scene')!.objects![1];
    glasses.truthVoice = 'mr_o_glasses_amin';
    (s.scenes.find((x) => x.id === 'expr_scene')!.lines[0] as { voice?: string }).voice = 'wrong_name';
    const problems = validateScript(s).join('\n');
    expect(problems).toContain('配音編號 "t_start_01_amin" 重複');
    expect(problems).toContain('choice 有 voice 但沒有 prompt');
    expect(problems).toContain('有 truthVoice 但沒有 truth');
    expect(problems).toContain('（警告）expr_scene.lines[0]：配音編號 "wrong_name" 不符合');
  });

  test('正式腳本：65 個配音編號、不重複', async () => {
    const real = JSON.parse(await readFile(new URL('../examples/寫給未來的我/script.json', import.meta.url), 'utf8')) as Script;
    const entries = voiceEntries(real);
    expect(entries).toHaveLength(65);
    expect(new Set(entries.map((e) => e.id)).size).toBe(65);
    expect(validateScript(real)).toEqual([]);
  });
});

test.describe('開發者頁面：配音總表', () => {
  test('正式腳本：65 句，有無音檔與 examples/寫給未來的我/assets/voice 裡的檔案一致', async ({ page }) => {
    const files = (await readdir(new URL('../examples/寫給未來的我/assets/voice/', import.meta.url))).filter((f) => /\.(mp3|ogg)$/.test(f));
    const has = new Set(files.map((f) => f.replace(/\.(mp3|ogg)$/, '')));
    const real = JSON.parse(await readFile(new URL('../examples/寫給未來的我/script.json', import.meta.url), 'utf8')) as Script;
    const present = voiceEntries(real).filter((e) => has.has(e.id)).length;
    await page.goto('./play.html?voice=1');
    await expect(page.locator('.voice-desk')).toHaveAttribute('data-ready', '1', { timeout: 30000 });
    await expect(page.locator('.vd-table tbody tr')).toHaveCount(65);
    await expect(page.locator('[data-count=total]')).toHaveText('共 65 句');
    await expect(page.locator('[data-count=has]')).toHaveText(`有音檔 ${present}`);
    await expect(page.locator('[data-count=missing]')).toHaveText(`缺檔 ${65 - present}`);
  });

  test('探測、統計、篩選、試聽、匯出', async ({ page }) => {
    await serveVoices(page, { 't_start_01_amin.mp3': 1, 'mr_o_phone_amin.ogg': 1 });
    await page.route('**/script.json', async (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(testScript()) }));
    await page.goto('./play.html?voice=1');
    await expect(page.locator('.voice-desk')).toHaveAttribute('data-ready', '1');
    await expect(page.locator('.vd-table tbody tr')).toHaveCount(4);
    await expect(page.locator('[data-count=has]')).toHaveText('有音檔 2');
    await expect(page.locator('[data-count=missing]')).toHaveText('缺檔 2');
    await expect(page.locator('tr[data-id="mr_o_phone_amin"] .vd-status')).toHaveText('有（.ogg）');
    await expect(page.locator('.vd-by-speaker tr[data-speaker=amin]')).toContainText('2 / 3');
    // 篩選
    await page.locator('input[name=vd-missing-only]').check();
    await expect(page.locator('.vd-table tbody tr:visible')).toHaveCount(2);
    await page.locator('input[name=vd-missing-only]').uncheck();
    await page.selectOption('select[name=vd-speaker]', 'player');
    await expect(page.locator('.vd-table tbody tr:visible')).toHaveCount(1);
    await page.selectOption('select[name=vd-speaker]', '');
    await page.selectOption('select[name=vd-scene]', 'obj_scene');
    await expect(page.locator('.vd-table tbody tr:visible')).toHaveCount(1);
    // 缺檔的試聽鈕不能按
    await expect(page.locator('tr[data-id="t_start_02_player"] .vd-play')).toBeDisabled();
    await expect(page.locator('tr[data-id="t_start_01_amin"] .vd-play')).toBeEnabled();
    // 匯出：預設只含缺檔
    const [d1] = await Promise.all([page.waitForEvent('download'), page.click('[data-vd=export]')]);
    expect(d1.suggestedFilename()).toBe('voice-lines.json');
    const missing = JSON.parse(await readFile(await d1.path(), 'utf8'));
    expect(missing).toEqual([
      { id: 't_start_02_player', scene: 't_start', speaker: 'player', text: '獨白第一句。' },
      { id: 'req_scene_01_amin', scene: 'req_scene', speaker: 'amin', text: '要怎麼辦？' },
    ]);
    await page.locator('input[name=vd-export-missing]').uncheck();
    const [d2] = await Promise.all([page.waitForEvent('download'), page.click('[data-vd=export]')]);
    expect(JSON.parse(await readFile(await d2.path(), 'utf8'))).toHaveLength(4);
  });

  test('整場試聽：依序播放該場景有音檔的句子', async ({ page }) => {
    await serveVoices(page, { 't_start_01_amin.mp3': 0.4, 't_start_02_player.mp3': 0.4 });
    await page.route('**/script.json', async (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(testScript()) }));
    await page.goto('./play.html?voice=1');
    await expect(page.locator('.voice-desk')).toHaveAttribute('data-ready', '1');
    await page.selectOption('select[name=vd-play-scene]', 't_start');
    await page.click('[data-vd=play-scene]');
    await expect(page.locator('.vd-play-status')).toContainText('1 / 2');
    await expect(page.locator('.vd-play-status')).toContainText('2 / 2', { timeout: 5000 });
    await expect(page.locator('.vd-play-status')).toHaveText('播完了。', { timeout: 5000 });
  });
});
