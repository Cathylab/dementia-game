import { expect, test } from '@playwright/test';
import { ALL_FX } from '../src/types';
import { advance, jumpTo, openWithTestScript } from './helpers';

test.beforeEach(async ({ page }) => {
  await openWithTestScript(page);
});

test('name_fade：人名逐字變底線，最後變成「那個人」並露出特徵', async ({ page }) => {
  await jumpTo(page, 'fx_name');
  await expect(page.locator('.namebox')).toHaveClass(/fx-name-fade/);
  await expect(page.locator('.namebox .name')).toContainText('＿');
  await expect(page.locator('.namebox .name')).toHaveText('那個人');
  await expect(page.locator('.namebox')).toHaveAttribute('data-faded', '1');
  await expect(page.locator('.namebox .trait')).toHaveText('戴著藍色帽子');
  await advance(page);
  await expect(page.locator('.namebox')).not.toHaveClass(/fx-name-fade/);
});

test('text_blur：部分字元缺失或變成方塊', async ({ page }) => {
  await jumpTo(page, 'fx_text');
  await expect(page.locator('#stage')).toHaveClass(/fx-text-blur/);
  expect(await page.locator('.text .glitch-missing, .text .glitch-block').count()).toBeGreaterThan(0);
});

test('repeat_line：隔一兩句後同一句無預警再出現', async ({ page }) => {
  await jumpTo(page, 'fx_repeat');
  await expect(page.locator('#stage')).toHaveClass(/fx-repeat-line/);
  const texts: string[] = [];
  for (let i = 0; i < 4; i++) {
    await advance(page);
    await page.waitForTimeout(50);
    texts.push((await page.locator('.dialog .text').textContent()) ?? '');
    if (await page.locator('.dialog.fx-repeat').count()) break;
  }
  await expect(page.locator('.dialog')).toHaveClass(/fx-repeat/);
  await expect(page.locator('.dialog .text')).toHaveText('會重複的一句。');
  expect(texts.length).toBeGreaterThanOrEqual(2);
});

test('choice_vanish（list）：選項約三秒消失一個並重新排列', async ({ page }) => {
  await jumpTo(page, 'ch_vanish');
  const choices = page.locator('.choices');
  await expect(choices).toHaveClass(/fx-choice-vanish/);
  await expect(choices).toHaveAttribute('data-remaining', '4');
  await expect(choices).toHaveAttribute('data-remaining', '3', { timeout: 5000 });
  await expect(page.locator('.choice')).toHaveCount(3, { timeout: 5000 });
  await expect(choices).toHaveAttribute('data-remaining', '1', { timeout: 10000 });
  await expect(page.locator('.choice')).toHaveCount(1, { timeout: 5000 });
});

test('choice_vanish（hotspot）：熱點也會消失', async ({ page }) => {
  await jumpTo(page, 'ch_hot_vanish');
  await expect(page.locator('.choices')).toHaveClass(/fx-choice-vanish/);
  await expect(page.locator('.hotspot')).toHaveCount(3);
  await expect(page.locator('.hotspot')).toHaveCount(2, { timeout: 5000 });
});

test('flat_options：選項一律灰色同語氣，點哪個都走第一個選項的 goto', async ({ page }) => {
  await jumpTo(page, 'ch_flat');
  await expect(page.locator('.choices')).toHaveClass(/fx-flat-options/);
  await expect(page.locator('.choice .label')).toHaveText(['走 A。', '走 B。']);
  const bg = await page.locator('.choice').nth(0).evaluate((n) => getComputedStyle(n).backgroundColor);
  expect(await page.locator('.choice').nth(1).evaluate((n) => getComputedStyle(n).backgroundColor)).toBe(bg);
  await page.locator('.choice').nth(1).click();
  await expect(page.locator('#stage')).toHaveAttribute('data-scene', 'flat_a');
});

test('wrong_object（有前景）：手持物件被換掉', async ({ page }) => {
  await jumpTo(page, 'fx_wrong_fg');
  await expect(page.locator('.fg')).toBeVisible();
  await expect(page.locator('#stage')).toHaveClass(/fx-wrong-object/);
  await expect(page.locator('.fg')).toHaveAttribute('data-wrong', 'phone');
});

test('wrong_object（無前景）：背景上多一個物件', async ({ page }) => {
  await jumpTo(page, 'fx_wrong_bg');
  await expect(page.locator('#stage')).toHaveClass(/fx-wrong-object/);
  await expect(page.locator('.bg-pan .wrong-object')).toHaveCount(1);
});

test('time_skip：眨眼換成另一個背景，數秒後切回', async ({ page }) => {
  await jumpTo(page, 'fx_time');
  await expect(page.locator('#stage')).toHaveClass(/fx-time-skip/);
  await expect(page.locator('.bg')).toHaveAttribute('data-name', 'old_school');
  await expect(page.locator('.bg')).toHaveAttribute('data-name', 'test_room', { timeout: 5000 });
  await expect(page.locator('#stage')).not.toHaveClass(/fx-time-skip/);
});

test('desaturate：飽和度降低、可疊加、不會自己恢復', async ({ page }) => {
  await jumpTo(page, 'fx_desat');
  const stage = page.locator('#stage');
  await expect(stage).toHaveClass(/fx-desaturate/);
  const first = Number(await stage.getAttribute('data-desat'));
  expect(first).toBeGreaterThan(0);
  await advance(page);
  await expect.poll(async () => Number(await stage.getAttribute('data-desat'))).toBeGreaterThan(first);
  const sat = await stage.evaluate((n) => Number(n.style.getPropertyValue('--sat')));
  expect(sat).toBeLessThan(1);
  await jumpTo(page, 'fx_text');
  await expect(stage).toHaveClass(/fx-desaturate/);
});

test('focus_drift：角色變糊、對焦移到背景', async ({ page }) => {
  await jumpTo(page, 'fx_focus');
  await expect(page.locator('#stage')).toHaveClass(/fx-focus-drift/);
  await expect.poll(() => page.locator('.char-layer').evaluate((n) => getComputedStyle(n).filter)).toContain('blur(7px)');
});

test('look_around：背景左右平移', async ({ page }) => {
  await jumpTo(page, 'fx_look');
  await expect(page.locator('#stage')).toHaveClass(/fx-look-around/);
  expect(await page.locator('.bg').evaluate((n) => getComputedStyle(n).animationName)).toBe('look-around');
});

test('muffle：音訊低通並降音量', async ({ page }) => {
  await jumpTo(page, 'fx_muffle');
  await expect(page.locator('#stage')).toHaveClass(/fx-muffle/);
  await expect(page.locator('#stage')).toHaveAttribute('data-muffle', '1');
});

test('退化係數依幕決定，開發者面板可覆寫', async ({ page }) => {
  await jumpTo(page, 'fx_text');
  await expect(page.locator('#stage')).toHaveAttribute('data-degradation', '0.00');
  await jumpTo(page, 'ui_scene');
  await expect(page.locator('#stage')).toHaveAttribute('data-degradation', '0.50');
  await jumpTo(page, 'act3');
  await expect(page.locator('#stage')).toHaveAttribute('data-degradation', '1.00');
  // 暗角隨退化加重（有 CSS 過渡，所以用 poll）
  await expect.poll(() => page.locator('.vignette').evaluate((n) => Number(getComputedStyle(n).opacity))).toBeGreaterThan(0.8);
  await page.keyboard.press('Backquote');
  await page.locator('input[name=dev-degradation]').fill('0.25');
  await expect(page.locator('#stage')).toHaveAttribute('data-degradation', '0.25');
});

test('開發者面板可以手動觸發每一個效果', async ({ page }) => {
  await jumpTo(page, 'fx_focus');
  await page.keyboard.press('Backquote');
  const expectations: Record<string, () => Promise<void>> = {
    name_fade: () => expect(page.locator('.namebox')).toHaveClass(/fx-name-fade/),
    text_blur: () => expect(page.locator('#stage')).toHaveClass(/fx-text-blur/),
    repeat_line: () => expect(page.locator('#stage')).toHaveClass(/fx-repeat-line/),
    choice_vanish: () => expect(page.locator('.choices')).toHaveClass(/fx-choice-vanish/),
    flat_options: () => expect(page.locator('.choices')).toHaveClass(/fx-flat-options/),
    wrong_object: () => expect(page.locator('#stage')).toHaveClass(/fx-wrong-object/),
    time_skip: () => expect(page.locator('#stage')).toHaveClass(/fx-time-skip/),
    desaturate: () => expect(page.locator('#stage')).toHaveClass(/fx-desaturate/),
    focus_drift: () => expect(page.locator('#stage')).toHaveClass(/fx-focus-drift/),
    look_around: () => expect(page.locator('#stage')).toHaveClass(/fx-look-around/),
    muffle: () => expect(page.locator('#stage')).toHaveAttribute('data-muffle', '1'),
  };
  expect(Object.keys(expectations).sort()).toEqual([...ALL_FX].sort());
  for (const fx of ALL_FX) {
    await page.click(`[data-fx=${fx}]`);
    await expectations[fx]();
  }
});
