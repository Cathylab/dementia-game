import { expect, test } from '@playwright/test';
import { advance, currentText, engineValue, jumpTo, openWithTestScript } from './helpers';

test.describe('if 條件', () => {
  test('有旗標時：if 不成立的台詞整句跳過、不寫入紀錄、不觸發效果', async ({ page }) => {
    await openWithTestScript(page);
    await jumpTo(page, 'if_setup');
    await page.locator('.choice[data-index="0"]').click();
    await expect(page.locator('#stage')).toHaveAttribute('data-scene', 'if_lines');
    await expect(currentText(page)).toHaveText('第一句。');
    await advance(page);
    await expect(currentText(page)).toHaveText('只有 flag_a 才看得到。');
    await advance(page);
    // 「沒有 flag_a」與「trust 夠高」兩句都跳過
    await expect(currentText(page)).toHaveText('最後一句。');
    await expect(page.locator('#stage')).not.toHaveClass(/fx-desaturate/);
    await page.click('.tool-log');
    const log = await page.locator('.log-text').allTextContents();
    expect(log).toContain('只有 flag_a 才看得到。');
    expect(log).not.toContain('沒有 flag_a 才看得到。');
    expect(log).not.toContain('trust 夠高才看得到。');
  });

  test('沒有旗標時走另一句；選項的 if 不成立就不出現', async ({ page }) => {
    await openWithTestScript(page);
    await jumpTo(page, 'if_setup');
    await page.locator('.choice[data-index="1"]').click();
    await expect(currentText(page)).toHaveText('第一句。');
    await advance(page);
    await expect(currentText(page)).toHaveText('沒有 flag_a 才看得到。');
    await advance(page);
    await expect(currentText(page)).toHaveText('最後一句。');
    await advance(page);
    await expect(page.locator('.choice')).toHaveCount(1);
    await expect(page.locator('.choice').first()).toHaveAttribute('data-index', '0');
  });

  test('選項依 if 篩選，data-index 保留腳本裡的原始位置', async ({ page }) => {
    await openWithTestScript(page);
    await jumpTo(page, 'if_setup');
    await page.locator('.choice[data-index="0"]').click();
    await expect(currentText(page)).toHaveText('第一句。');
    for (let i = 0; i < 3; i++) await advance(page);
    await expect(page.locator('.choice')).toHaveCount(2);
    await expect(page.locator('.choice').nth(1)).toHaveAttribute('data-index', '1');
    await expect(page.locator('.choice[data-index="2"]')).toHaveCount(0);
  });

  test('條件在播到那一句時才判定', async ({ page }) => {
    await openWithTestScript(page);
    await jumpTo(page, 'if_setup');
    await page.locator('.choice[data-index="0"]').click();
    await expect(currentText(page)).toHaveText('第一句。');
    await advance(page);
    await expect(currentText(page)).toHaveText('只有 flag_a 才看得到。');
    // 在下一句播出前把 trust 調到 1
    await page.keyboard.press('Backquote');
    await page.locator('.dev-stat[data-stat=trust] button').nth(1).click();
    await page.keyboard.press('Backquote');
    await advance(page);
    await expect(currentText(page)).toHaveText('trust 夠高才看得到。');
  });

  test('回上一句回到上一句實際顯示過的台詞', async ({ page }) => {
    await openWithTestScript(page);
    await jumpTo(page, 'if_setup');
    await page.locator('.choice[data-index="0"]').click();
    await expect(currentText(page)).toHaveText('第一句。');
    await advance(page);
    await advance(page);
    await expect(currentText(page)).toHaveText('最後一句。');
    await page.click('.tool-back');
    await expect(currentText(page)).toHaveText('只有 flag_a 才看得到。');
  });

  test('一組選項全部不成立時直接播下一句', async ({ page }) => {
    await openWithTestScript(page, undefined, {
      mutate: (s) => {
        const scene = s.scenes.find((x) => x.id === 'if_lines')!;
        const choice = scene.lines[5] as { choice: { if?: string }[] };
        for (const o of choice.choice) o.if = 'false';
      },
    });
    await jumpTo(page, 'if_lines');
    await expect(currentText(page)).toHaveText('第一句。');
    await advance(page);
    await advance(page);
    await expect(currentText(page)).toHaveText('最後一句。');
    await advance(page);
    await expect(currentText(page)).toHaveText('選項之後。');
    await expect(page.locator('.choices.open')).toHaveCount(0);
  });

  test('結局條件可以用 has()', async ({ page }) => {
    await openWithTestScript(page);
    await jumpTo(page, 't_end_choice');
    await page.locator('.choice[data-index="1"]').click();
    await expect(page.locator('#stage')).toHaveAttribute('data-scene', 'end_y');
    expect(await engineValue<string[]>(page, 'flags')).toContain('flag_y');
  });
});
