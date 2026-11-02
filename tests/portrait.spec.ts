// 手機直式：背景圖比畫面寬很多，左右拖曳可以看到整張圖、找到畫面外的物件。
import { expect, test, type Page } from '@playwright/test';
import { advance, currentText, jumpTo, openWithTestScript } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const center = (page: Page, id: string) =>
  page.locator(`.object-spot[data-object="${id}"]`).evaluate((b) => {
    const r = b.getBoundingClientRect();
    return r.x + r.width / 2;
  });

async function dragBy(page: Page, dx: number) {
  await page.mouse.move(200, 300);
  await page.mouse.down();
  await page.mouse.move(200 + dx, 300, { steps: 8 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await openWithTestScript(page);
  await jumpTo(page, 'obj_scene');
  await expect(currentText(page)).toHaveText('物件第一句。');
});

test('畫面外的物件：邊緣出現提示箭頭；左右拖曳就能找到並點開', async ({ page }) => {
  await expect(page.locator('.swipe-hint')).toHaveClass(/show/);
  expect(await center(page, 'o_glasses')).toBeGreaterThan(390);
  await expect(page.locator('.edge-hint.right')).toBeVisible();
  for (let i = 0; i < 4 && (await center(page, 'o_glasses')) > 370; i++) await dragBy(page, -250);
  const x = await center(page, 'o_glasses');
  expect(x).toBeGreaterThan(20);
  expect(x).toBeLessThan(370);
  // 拖曳不會推進台詞
  await expect(currentText(page)).toHaveText('物件第一句。');
  await page.locator('.object-spot[data-object="o_glasses"]').click({ force: true });
  await expect(page.locator('.inspect')).toHaveClass(/open/);
});

test('拖曳不算點擊；放開後點一下照常推進台詞', async ({ page }) => {
  await dragBy(page, -120);
  await expect(currentText(page)).toHaveText('物件第一句。');
  await advance(page);
  await expect(currentText(page)).toHaveText('物件第二句。');
});

test('拖到盡頭時背景圖仍然蓋滿畫面', async ({ page }) => {
  for (const dx of [600, 600, 600]) await dragBy(page, dx);
  const r = await page.locator('.bg').evaluate((n) => n.getBoundingClientRect());
  expect(r.x).toBeLessThanOrEqual(1);
  expect(r.x + r.width).toBeGreaterThanOrEqual(389);
  for (const dx of [-600, -600, -600, -600]) await dragBy(page, dx);
  const r2 = await page.locator('.bg').evaluate((n) => n.getBoundingClientRect());
  expect(r2.x + r2.width).toBeGreaterThanOrEqual(389);
  expect(r2.x).toBeLessThanOrEqual(1);
});

test.describe('電腦橫式', () => {
  test.use({ viewport: { width: 1280, height: 720 }, hasTouch: false });
  test('橫式不能拖曳背景，也沒有滑動提示', async ({ page }) => {
    const pan = () => page.locator('.bg-pan').evaluate((n) => n.style.getPropertyValue('--pan'));
    const before = await pan();
    await dragBy(page, -300);
    expect(await pan()).toBe(before);
    await expect(page.locator('.swipe-hint')).not.toHaveClass(/show/);
  });
});
