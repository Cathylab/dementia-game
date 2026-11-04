// 試玩回饋第一輪：找找看（explore）、互動物件（required／attention／sfx／overlayWidth）、物件的 if、結局說明。
import { expect, test, type Page } from '@playwright/test';
import { checkScript } from '../src/checks';
import { validateScript } from '../src/script';
import type { Script, TextLine } from '../src/types';
import { advance, currentText, engineValue, jumpTo, openWithTestScript, testScript } from './helpers';

const spot = (page: Page, id: string) => page.locator(`.object-spot[data-object="${id}"]`);
const scene = (s: Script, id: string) => s.scenes.find((x) => x.id === id)!;

/** 無聲 WAV。 */
function wav(): Buffer {
  const n = 2400;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(8000, 24);
  buf.writeUInt32LE(16000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  return buf;
}

test.describe('找找看（explore）', () => {
  test.beforeEach(async ({ page }) => {
    await openWithTestScript(page, 'timescale=0.2', {
      mutate: (s) => ((scene(s, 'obj_scene').lines[0] as TextLine).explore = '這裡好像有東西可以看看。'),
    });
    await jumpTo(page, 'obj_scene');
    await expect(currentText(page)).toHaveText('物件第一句。');
  });

  test('顯示提示與「繼續」；點畫面、按空白鍵都不往下，按「繼續」才往下', async ({ page }) => {
    const bar = page.locator('.explore-bar');
    await expect(bar).toBeVisible();
    await expect(bar.locator('.explore-text')).toHaveText('這裡好像有東西可以看看。');
    await expect(page.locator('#stage')).toHaveClass(/exploring/);
    await advance(page);
    await page.keyboard.press(' ');
    await expect(currentText(page)).toHaveText('物件第一句。');
    // 物件照樣可以點，關掉說明卡後還在找找看
    await spot(page, 'o_phone').click({ force: true });
    await page.locator('.inspect').click();
    await expect(bar).toBeVisible();
    await page.locator('.explore-next').click();
    await expect(currentText(page)).toHaveText('物件第二句。');
    await expect(bar).toBeHidden();
    await expect(page.locator('#stage')).not.toHaveClass(/exploring/);
  });

  test('快轉遇到找找看會停下', async ({ page }) => {
    await page.click('.tool-skip');
    await page.waitForTimeout(400);
    await expect(currentText(page)).toHaveText('物件第一句。');
    await expect(page.locator('.tool-skip')).not.toHaveClass(/active/);
  });
});

test('找找看可以掛在主角的內心獨白上：獨白不自動往下，按「繼續」才往下', async ({ page }) => {
  await openWithTestScript(page, 'timescale=0.2', {
    mutate: (s) => ((scene(s, 'obj_scene').lines[4] as TextLine).explore = '找找看。'),
  });
  await jumpTo(page, 'obj_scene');
  for (let i = 0; i < 3; i++) await advance(page);
  await expect(page.locator('.monologue-text')).toHaveText('物件獨白。');
  await expect(page.locator('.explore-bar')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await engineValue<number>(page, 'index')).toBe(4);
  await page.locator('.explore-next').click();
  await expect(page.locator('.choices.open')).toBeVisible();
});

test.describe('互動物件：required、attention、sfx、overlayWidth', () => {
  test('一定要點：出現後劇情停住、物件會響，點過並關掉說明卡才能往下', async ({ page }) => {
    await page.route('**/assets/sfx/manifest.json', (r) => r.fulfill({ contentType: 'application/json', body: '["phone_ring.mp3"]' }));
    await page.route('**/assets/sfx/*.mp3', (r) => r.fulfill({ contentType: 'audio/mpeg', body: wav() }));
    await openWithTestScript(page, 'timescale=0.2', {
      mutate: (s) => {
        const o = scene(s, 'obj_scene').objects![0];
        Object.assign(o, { appearAt: 1, required: true, attention: 'ring', sfx: 'phone_ring', overlayWidth: 0.1 });
      },
    });
    await jumpTo(page, 'obj_scene');
    await expect(spot(page, 'o_phone')).toHaveCount(0);
    await advance(page);
    await expect(currentText(page)).toHaveText('物件第二句。');
    const phone = spot(page, 'o_phone');
    await expect(phone).toHaveAttribute('data-attention', 'ring');
    await expect(phone).toHaveClass(/required/);
    // 物件圖疊在背景上；點擊區至少 44px
    await expect(phone.locator('img.object-overlay')).toHaveAttribute('data-name', 'phone_on_table');
    const box = (await phone.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    await expect(page.locator('#stage')).toHaveAttribute('data-sfx-loops', 'phone_ring');
    // 擋住：點畫面不往下
    await advance(page);
    await expect(currentText(page)).toHaveText('物件第二句。');
    expect(await engineValue<string | null>(page, 'blocked')).toBe('required');
    // 點了就停止音效、不再震動
    await phone.click({ force: true });
    await expect(page.locator('.inspect')).toHaveClass(/open/);
    await expect(page.locator('#stage')).toHaveAttribute('data-sfx-loops', '');
    await page.locator('.inspect').click();
    await expect(phone).not.toHaveAttribute('data-attention', /.+/);
    await advance(page);
    await expect(currentText(page)).toHaveText('物件第三句。');
  });

  test('attention: glow 可以單獨使用（不搭配 required）', async ({ page }) => {
    await openWithTestScript(page, 'timescale=0.2', {
      mutate: (s) => (scene(s, 'obj_scene').objects![1].attention = 'glow'),
    });
    await jumpTo(page, 'obj_scene');
    await expect(spot(page, 'o_glasses')).toHaveAttribute('data-attention', 'glow');
    await advance(page);
    await expect(currentText(page)).toHaveText('物件第二句。');
  });

  test('手機直式：一定要點的物件在畫面外時，出現時自動平移到它', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openWithTestScript(page, 'timescale=0.2', {
      mutate: (s) => {
        const o = scene(s, 'obj_scene').objects![1];
        Object.assign(o, { x: 0.12, appearAt: 1, required: true });
      },
    });
    await jumpTo(page, 'obj_scene');
    await advance(page);
    await expect(currentText(page)).toHaveText('物件第二句。');
    // 物件的中心進到畫面裡（平移約 1 秒）
    await expect
      .poll(async () => {
        const b = (await spot(page, 'o_glasses').boundingBox())!;
        const cx = b.x + b.width / 2;
        return cx > 0 && cx < 390;
      }, { timeout: 5_000 })
      .toBe(true);
  });
});

test('說明卡：「放大」讓照片佔滿畫面、再按縮回，不會關掉說明卡；右上角可以關閉', async ({ page }) => {
  await openWithTestScript(page);
  await jumpTo(page, 'obj_scene');
  await spot(page, 'o_phone').click({ force: true });
  const inspect = page.locator('.inspect');
  await page.locator('.inspect-zoom').click();
  await expect(inspect).toHaveClass(/zoomed/);
  await expect(page.locator('.inspect-desc')).toBeHidden();
  await page.locator('.inspect-zoom').click();
  await expect(inspect).not.toHaveClass(/zoomed/);
  await expect(inspect).toHaveClass(/open/);
  await page.locator('.inspect-close').click();
  await expect(inspect).not.toHaveClass(/open/);
  await expect(currentText(page)).toHaveText('物件第一句。');
});

test('物件的 if：條件不成立時不出現', async ({ page }) => {
  await openWithTestScript(page, 'timescale=0.2', {
    mutate: (s) => (scene(s, 'obj_scene').objects![1].if = 'has("never_set")'),
  });
  await jumpTo(page, 'obj_scene');
  await expect(spot(page, 'o_phone')).toBeVisible();
  await expect(spot(page, 'o_glasses')).toHaveCount(0);
});

test('結局畫面顯示結局說明', async ({ page }) => {
  await openWithTestScript(page, 'timescale=0.2', {
    mutate: (s) => (s.endings.find((e) => e.scene === 'end_z')!.description = '這是結局說明。'),
  });
  await jumpTo(page, 'end_z');
  await advance(page);
  await expect(page.locator('.ending-screen.open .ending-desc')).toHaveText('這是結局說明。');
});

test('腳本檢查：新欄位格式不對時有白話說明', () => {
  const s = testScript();
  const sc = scene(s, 'obj_scene');
  Object.assign(sc.objects![0], { attention: 'blink', overlayWidth: 0.9, sfx: '電話', if: 'has(' });
  Object.assign(sc.objects![1], { overlayWidth: 0.1 });
  (sc.lines[1] as TextLine).explore = '找找看';
  (sc.lines[3] as TextLine).explore = '再找一次';
  s.meta.credits = 'x' as unknown as [];
  const problems = validateScript(s);
  const has = (re: RegExp) => expect(problems.some((p) => re.test(p)), re.source).toBe(true);
  has(/objects\[0\]\.attention：只能是 "ring" 或 "glow"/);
  has(/^（警告）obj_scene\.objects\[0\]：overlayWidth 0\.9 超出/);
  has(/^（警告）obj_scene\.objects\[1\]：有 overlayWidth 但沒有 image/);
  has(/objects\[0\]\.sfx：音效名稱只能用/);
  has(/objects\[0\]\.if/);
  has(/^（警告）obj_scene\.lines\[1\]：explore 之後才出現的物件 "o_cup"/);
  has(/^（警告）obj_scene\.lines\[1\]：同一個場景有兩次 explore/);
  has(/^（警告）meta\.credits/);
  // 每一則都有白話翻譯（不是「無法判讀」的保底訊息）
  for (const issue of checkScript(s)) expect(issue.fix, issue.tech).not.toBe('請照訊息修正；不確定的話，把下面的提示詞貼給 AI。');
});

test('正式腳本：6 個找找看、會響的手機，新欄位都通過檢查', async () => {
  const { readFileSync } = await import('node:fs');
  const demo = JSON.parse(readFileSync(new URL('../examples/寫給未來的我/script.json', import.meta.url), 'utf8')) as Script;
  const explores = demo.scenes.flatMap((s) => s.lines.filter((l) => (l as TextLine).explore).map(() => s.id));
  expect(explores).toEqual(['a1_s02', 'a2_s06', 'a2_s07', 'a3_s12', 'a4_s14', 'a4_s16']);
  const phone = demo.scenes.flatMap((s) => s.objects ?? []).find((o) => o.id === 'a1_phone')!;
  expect(phone).toMatchObject({ required: true, attention: 'ring', sfx: 'phone_ring' });
  expect(validateScript(demo).filter((p) => !p.startsWith('（警告）'))).toEqual([]);
});

test.describe('開發者面板：可以點的物件', () => {
  test('拖曳移動、調大小與第幾句出現、新增物件，儲存寫進劇本', async ({ page }) => {
    await openWithTestScript(page);
    await jumpTo(page, 'obj_scene');
    await page.keyboard.press('Backquote');
    const section = page.locator('details[data-section=可以點的物件]');
    await expect(section.locator('select[name=dev-object]')).toHaveValue('o_phone');
    await section.locator('input[name=dev-object-edit]').check();
    // 編輯時畫出場景裡所有物件（o_cup 第 2 句才出現，也畫出來）
    await expect(spot(page, 'o_cup')).toHaveAttribute('data-appear-at', '2');
    // 拖曳杯子（拖曳時自動選取）到背景中間附近
    const bg = (await page.locator('.objects-bg').boundingBox())!;
    const from = (await spot(page, 'o_cup').boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(bg.x + bg.width * 0.4, bg.y + bg.height * 0.6, { steps: 5 });
    await page.mouse.up();
    await expect(section.locator('select[name=dev-object]')).toHaveValue('o_cup');
    const cup = await page.evaluate(() => (window as unknown as { __vn: { engine: { getObject(id: string): { x: number; y: number } } } }).__vn.engine.getObject('o_cup'));
    expect(cup.x).toBeCloseTo(0.4, 1);
    expect(cup.y).toBeCloseTo(0.6, 1);
    await expect(section.locator('[data-dev=object-x]')).toContainText(cup.x.toFixed(3));
    // 沒有打開說明卡、沒有推進劇情
    await expect(page.locator('.inspect')).not.toHaveClass(/open/);
    await expect(currentText(page)).toHaveText('物件第一句。');
    // 大小、第幾句出現、一定要點
    await section.locator('input[name=dev-object-r]').fill('0.08');
    await section.locator('input[name=dev-object-appear]').fill('1');
    await section.locator('input[name=dev-object-appear]').press('Tab');
    await section.locator('input[name=dev-object-required]').check();
    await section.locator('select[name=dev-object-attention]').selectOption('ring');
    // 新增物件
    await section.locator('[data-dev=object-add]').click();
    await expect(section.locator('select[name=dev-object]')).toHaveValue('obj_scene_obj1');
    await expect(spot(page, 'obj_scene_obj1')).toBeVisible();
    // 儲存（網站版：下載 script.json）
    const [download] = await Promise.all([page.waitForEvent('download'), section.locator('[data-dev=object-save]').click()]);
    const saved = JSON.parse(await (await import('node:fs/promises')).readFile(await download.path(), 'utf8')) as Script;
    const objs = scene(saved, 'obj_scene').objects!;
    expect(objs[2]).toMatchObject({ id: 'o_cup', r: 0.08, appearAt: 1, required: true, attention: 'ring' });
    expect(objs.map((o) => o.id)).toContain('obj_scene_obj1');
    // 關掉編輯：回到一般的物件（o_cup 還沒出現）
    await section.locator('input[name=dev-object-edit]').uncheck();
    await expect(spot(page, 'o_cup')).toHaveCount(0);
  });
});
