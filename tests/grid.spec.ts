// 小作品範本「照格子填」（需求書 6-2）：格子 → 劇本，檢查通過、兩個結局都走得到；畫面上填完產生劇本並能玩。
import { expect, test, type Page } from '@playwright/test';
import { checkScript } from '../src/checks';
import { emptyGrid, gridMissing, gridToScript, type Grid } from '../src/guide/grid';
import { LEGACY_PACK, PLAIN_PACK } from '../src/pack';
import { isChoice } from '../src/types';
import { reachableEndings } from './simulate';

function filled(scenes = 3): Grid {
  const g = emptyGrid();
  g.chars = [
    { name: '媽媽', relation: '母親' },
    { name: '小美', relation: '同學' },
  ];
  g.scenes.length = scenes;
  g.scenes.forEach((s, i) => {
    s.title = `第${i + 1}天・教室`;
    s.happen = '早上八點，教室裡很吵。\n沒有人認識我。';
    s.lines = [
      { who: 0, text: '要加油喔。' },
      { who: 1, text: '你從哪裡轉來的？' },
      { who: 'player', text: '我該怎麼回答？' },
    ];
    s.prompt = '你要怎麼回答？';
    s.options = [
      { text: '笑著說出來', reply: '她點點頭。' },
      { text: '假裝沒聽到', reply: '她轉過頭去。' },
    ];
    s.better = 0;
    s.effect = i === 1 ? 'muffle' : '';
  });
  g.endings = [
    { title: '新朋友', text: '下課時，有人叫了我的名字。' },
    { title: '一個人', text: '放學的路很長。' },
  ];
  return g;
}

test('格子 → 劇本：3 個場景、3 次選擇、2 個結局，檢查沒有問題，兩個結局都走得到', () => {
  const g = filled(3);
  expect(gridMissing(g)).toEqual([]);
  const script = gridToScript(g, { title: '轉學第一天', pack: 'dementia' });
  expect(script.scenes.filter((s) => !s.id.startsWith('end_'))).toHaveLength(3);
  expect(script.scenes.flatMap((s) => s.lines).filter(isChoice)).toHaveLength(3);
  expect(script.endings).toHaveLength(2);
  expect(script.characters.map((c) => c.name)).toEqual(['媽媽', '小美']);
  expect(script.scenes[0].title).toBe('第1天・教室');
  expect(checkScript(script, LEGACY_PACK)).toEqual([]);
  expect([...reachableEndings(script).keys()].sort()).toEqual(['ending_a', 'ending_b']);
  // 一般故事包：效果會被提醒（警告），但不擋
  const plain = checkScript(gridToScript(g, { title: 'x', pack: 'plain' }), PLAIN_PACK);
  expect(plain.every((x) => x.level === 'warning')).toBe(true);
});

test('格子 → 劇本：2 個場景也可以；沒填的格子列出來', () => {
  const g = filled(2);
  const two = gridToScript(g, { title: 'x', pack: 'plain' });
  expect(checkScript(two, PLAIN_PACK).filter((x) => x.level === 'error')).toEqual([]);
  expect([...reachableEndings(two).keys()].sort()).toEqual(['ending_a', 'ending_b']);
  const empty = emptyGrid();
  const missing = gridMissing(empty);
  expect(missing).toContain('第 1 場：時間・地點');
  expect(missing).toContain('第 1 場：選項 1 的文字');
  expect(missing).toContain('結局 1 的內容');
});

async function fillScene(page: Page, i: number) {
  const s = page.locator(`[data-grid-scene="${i}"]`);
  await s.locator('input[name=grid-title]').fill(`第${i + 1}天・教室`);
  await s.locator('textarea[name=grid-happen]').fill('早上八點，教室裡很吵。');
  await s.locator('input[name=grid-line]').nth(1).fill('你從哪裡轉來的？');
  await s.locator('input[name=grid-option]').nth(0).fill('笑著說出來');
  await s.locator('input[name=grid-reply]').nth(0).fill('她點點頭。');
  await s.locator('input[name=grid-option]').nth(1).fill('假裝沒聽到');
}

test('課堂模式第 2 堂：照格子填，產生劇本並套用，然後可以玩到結局', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.click('[data-guide=begin]');
  await page.click('[data-guide=start-class]');
  await page.locator('input[name=guide-title]').fill('轉學第一天');
  await page.locator('textarea[name=guide-goal]').fill('讓同學體會轉學第一天');
  await page.click('[data-guide=next]');
  await expect(page.locator('[data-embed=grid]')).toBeVisible();

  // 還沒填就按：列出沒填的格子
  page.on('dialog', (d) => void d.accept());
  await page.click('[data-guide=grid-make]');
  await expect(page.locator('[data-guide=grid-result]')).toContainText('還有這些格子沒填');

  await page.locator('input[name=grid-char-name]').first().fill('小美');
  await page.locator('input[name=grid-char-name]').first().press('Tab');
  await page.selectOption('select[name=grid-scene-count]', '2');
  await fillScene(page, 0);
  await fillScene(page, 1);
  await page.locator('textarea[name=grid-ending-text]').nth(0).fill('下課時，有人叫了我的名字。');
  await page.locator('textarea[name=grid-ending-text]').nth(1).fill('放學的路很長。');
  await page.click('[data-guide=grid-make]');
  await expect(page.locator('[data-guide=grid-done]')).toContainText('已產生《轉學第一天》：2 個場景');

  // 重新打開：格子內容還在
  await page.goto('./#/lesson/2');
  await expect(page.locator('[data-grid-scene="1"] input[name=grid-title]')).toHaveValue('第2天・教室');

  await page.goto('./play.html?timescale=0.2');
  await expect(page.locator('.title-screen h1')).toHaveText('轉學第一天');
  await page.click('.start-button');
  for (let i = 0; i < 30 && !(await page.locator('.ending-screen.open').isVisible()); i++) {
    if (await page.locator('.choices.open .choice').count()) {
      await page.locator('.choices.open .choice').first().click();
      continue;
    }
    await page.waitForFunction(() => (window as unknown as { __vn: { engine: { phase: string } } }).__vn.engine.phase !== 'busy');
    await page.locator('#stage').click({ position: { x: 150, y: 620 } });
  }
  await expect(page.locator('.ending-screen.open')).toBeVisible();
  await expect(page.locator('.ending-screen')).toContainText('結局 1');
  expect(errors).toEqual([]);
});

test('完整模式第 5 步也可以改用格子', async ({ page }) => {
  await page.goto('./');
  await page.click('[data-guide=begin]');
  await page.click('[data-guide=start-blank]');
  await expect(page.locator('[data-guide=progress]')).toContainText('第 1 步');
  await page.goto('./#/step/5');
  await page.locator('[data-guide=grid-alt] summary').click();
  await expect(page.locator('[data-guide=grid-alt] [data-embed=grid]')).toBeVisible();
});
