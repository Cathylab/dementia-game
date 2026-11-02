import { expect, test } from '@playwright/test';
import { advance, currentText, engineValue, jumpTo, openWithTestScript } from './helpers';

const LOCKED_TEXT = '你好像記得什麼，但想不起來。';

async function toChoice(page: import('@playwright/test').Page, click: string[] = []) {
  await jumpTo(page, 'req_scene');
  await expect(currentText(page)).toHaveText('隱藏選項之前。');
  for (const id of click) {
    await page.locator(`.object-spot[data-object="${id}"]`).click();
    await page.locator('.inspect').click();
  }
  await advance(page);
  await expect(page.locator('.choices.open .choice')).toHaveCount(4);
}

test.describe('隱藏選項 requires', () => {
  test('沒點過物件：選項出現但灰掉、不能按，顯示預設文字', async ({ page }) => {
    await openWithTestScript(page);
    await toChoice(page);
    const locked = page.locator('.choice[data-index="2"]');
    await expect(locked).toBeDisabled();
    await expect(locked).toHaveClass(/locked/);
    await expect(locked).toHaveText(LOCKED_TEXT);
    await expect(page.locator('.choice[data-index="3"]')).toHaveText(LOCKED_TEXT);
    await locked.click({ force: true });
    await expect(page.locator('#stage')).toHaveAttribute('data-scene', 'req_scene');
    await expect(page.locator('.choice[data-index="0"]')).toBeEnabled();
  });

  test('點過物件就解鎖；陣列要全部點過', async ({ page }) => {
    await openWithTestScript(page);
    await toChoice(page, ['o_key']);
    await expect(page.locator('.choice[data-index="2"]')).toBeEnabled();
    await expect(page.locator('.choice[data-index="2"]')).toHaveText('拿出鑰匙');
    await expect(page.locator('.choice[data-index="3"]')).toBeDisabled();
  });

  test('選了隱藏選項：設下 hidden_ 旗標，結局的專屬內容出現', async ({ page }) => {
    await openWithTestScript(page);
    await toChoice(page, ['o_key']);
    await page.locator('.choice[data-index="2"]').click();
    await expect(page.locator('#stage')).toHaveAttribute('data-scene', 'end_x');
    expect(await engineValue<string[]>(page, 'flags')).toContain('hidden_key');
    await expect(currentText(page)).toHaveText('結局 X。');
    await advance(page);
    await expect(currentText(page)).toHaveText('鑰匙的專屬內容。');
  });

  test('「隱藏選項提示」打開時顯示缺少的物件名稱', async ({ page }) => {
    await openWithTestScript(page, undefined, { settings: { hiddenHints: true } });
    await toChoice(page, ['o_key']);
    await expect(page.locator('.choice[data-index="3"]')).toHaveText('照片？');
  });

  test('提示顯示所有沒點過的物件，以「、」連接', async ({ page }) => {
    await openWithTestScript(page, undefined, { settings: { hiddenHints: true } });
    await toChoice(page);
    await expect(page.locator('.choice[data-index="2"]')).toHaveText('鑰匙？');
    await expect(page.locator('.choice[data-index="3"]')).toHaveText('鑰匙？、照片？');
  });

  test('hotspot 模式：灰掉的熱點不能按', async ({ page }) => {
    await openWithTestScript(page, undefined, {
      mutate: (s) => {
        const line = s.scenes.find((x) => x.id === 'req_scene')!.lines[1] as { mode: string; choice: { x?: number; y?: number }[] };
        line.mode = 'hotspot';
        line.choice.forEach((o, i) => Object.assign(o, { x: 0.15 + i * 0.2, y: 0.3 }));
      },
    });
    await jumpTo(page, 'req_scene');
    await advance(page);
    const locked = page.locator('.hotspot[data-index="2"]');
    await expect(locked).toBeDisabled();
    await locked.hover({ force: true });
    await expect(locked.locator('.label')).toHaveText(LOCKED_TEXT);
  });
});
