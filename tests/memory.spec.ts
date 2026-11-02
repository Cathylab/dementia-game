import { expect, test, type Page } from '@playwright/test';
import { advance, currentText, jumpTo, openWithTestScript } from './helpers';

/** 直接設定看過的物件，再走到有記憶對照的結局 end_y。 */
async function toEnding(page: Page, seen: string[]) {
  await jumpTo(page, 't_end_choice');
  await page.evaluate((ids) => {
    (window as unknown as { __vn: { engine: { seen: string[] } } }).__vn.engine.seen = ids;
  }, seen);
  await page.locator('.choice[data-index="1"]').click();
  await expect(page.locator('#stage')).toHaveAttribute('data-scene', 'end_y');
  await expect(currentText(page)).toHaveText('結局 Y。');
}

const ALL = ['o_phone', 'o_glasses', 'o_cup', 'o_key', 'o_photo', 'o_letter'];

test.describe('記憶對照：inline（融入結局）', () => {
  test.beforeEach(async ({ page }) => {
    await openWithTestScript(page);
  });

  test('依第一次點的順序，最多 4 件，沒有 truth 的不算', async ({ page }) => {
    await toEnding(page, ALL);
    await advance(page);
    await expect(currentText(page)).toHaveText('阿明哥把東西一件一件拿出來。');
    await expect(page.locator('.memory-card')).not.toHaveClass(/open/);
    const expected = [
      ['o_phone', '女兒傳來新做的指甲。', '照片下面還有一句：媽，十點喔。'],
      ['o_cup', '杯子裡的茶早就涼了，上面浮著一層膜。', '那是今天早上泡的。'],
      ['o_key', '一串鑰匙。', '那是老家的鑰匙。'],
      ['o_photo', '一張照片。', '照片裡是我們三個人。'],
    ];
    for (const [id, desc, truth] of expected) {
      await advance(page);
      const card = page.locator('.memory-card');
      await expect(card).toHaveClass(/open/);
      await expect(card).toHaveAttribute('data-object', id);
      await expect(card.locator('.memory-desc')).toHaveText(desc);
      await expect(card.locator('.memory-desc')).toHaveCSS('text-decoration-line', 'line-through');
      await expect(page.locator('.namebox .name')).toHaveText('阿明哥');
      await expect(currentText(page)).toHaveText(truth);
    }
    await advance(page);
    await expect(currentText(page)).toHaveText('結局 Y 最後。');
    await expect(page.locator('.memory-card')).not.toHaveClass(/open/);
  });

  test('先顯示物件圖與劃掉的說明，再說出真相', async ({ page }) => {
    await openWithTestScript(page, 'timescale=1');
    await toEnding(page, ['o_phone']);
    await advance(page);
    await advance(page);
    await expect(page.locator('.memory-card .memory-image')).toHaveAttribute('data-name', 'phone_on_table');
    // 物件卡剛出現時台詞還沒開始
    await expect(currentText(page)).toHaveText('');
    await expect(currentText(page)).toHaveText('照片下面還有一句：媽，十點喔。', { timeout: 4000 });
  });

  test('沒有點過任何有 truth 的物件：只播 intro', async ({ page }) => {
    await toEnding(page, ['o_glasses']);
    await advance(page);
    await expect(currentText(page)).toHaveText('阿明哥把東西一件一件拿出來。');
    await advance(page);
    await expect(currentText(page)).toHaveText('結局 Y 最後。');
  });

  test('實際點物件後，記憶對照依點的順序出現', async ({ page }) => {
    await jumpTo(page, 'req_scene');
    for (const id of ['o_photo', 'o_key']) {
      await page.locator(`.object-spot[data-object="${id}"]`).click();
      await page.locator('.inspect').click();
    }
    await jumpTo(page, 't_end_choice');
    await page.locator('.choice[data-index="1"]').click();
    await expect(currentText(page)).toHaveText('結局 Y。');
    await advance(page);
    await advance(page);
    await expect(page.locator('.memory-card')).toHaveAttribute('data-object', 'o_photo');
    await expect(currentText(page)).toHaveText('照片裡是我們三個人。');
    await advance(page);
    await expect(page.locator('.memory-card')).toHaveAttribute('data-object', 'o_key');
  });
});

test.describe('記憶對照：page（結局後獨立一頁）', () => {
  test.beforeEach(async ({ page }) => {
    await openWithTestScript(page, undefined, { settings: { memoryReview: 'page' } });
  });

  test('結局場景裡的 memoryReview 跳過，結局畫面後多一頁對照表', async ({ page }) => {
    await toEnding(page, ALL);
    await advance(page);
    await expect(currentText(page)).toHaveText('結局 Y 最後。');
    await advance(page);
    await expect(page.locator('.ending-screen.open')).toBeVisible();
    await page.locator('.ending-screen .start-button').click();
    const pageEl = page.locator('.memory-page');
    await expect(pageEl).toHaveClass(/open/);
    await expect(pageEl.locator('tbody tr')).toHaveCount(4);
    await expect(pageEl.locator('tbody tr').first().locator('.memory-desc')).toHaveText('女兒傳來新做的指甲。');
    await expect(pageEl.locator('tbody tr').first().locator('.memory-truth')).toHaveText('照片下面還有一句：媽，十點喔。');
    await expect(pageEl.locator('.memory-scroll')).toHaveCSS('overflow-y', 'auto');
    await pageEl.locator('.memory-skip').click();
    await expect(page.locator('.title-screen')).toBeVisible();
  });

  test('沒有點過任何有 truth 的物件：顯示「你沒有留下任何記憶。」', async ({ page }) => {
    await toEnding(page, []);
    await advance(page);
    await advance(page);
    await page.locator('.ending-screen .start-button').click();
    await expect(page.locator('.memory-empty')).toHaveText('你沒有留下任何記憶。');
  });

  test('沒有 memoryReview 的結局不會多一頁', async ({ page }) => {
    await jumpTo(page, 't_end_choice');
    await page.locator('.choice[data-index="0"]').click();
    await expect(page.locator('#stage')).toHaveAttribute('data-scene', 'end_x');
    await expect(currentText(page)).toHaveText('結局 X。');
    await advance(page);
    await expect(page.locator('.ending-screen .start-button')).toHaveText('回到標題');
  });
});
