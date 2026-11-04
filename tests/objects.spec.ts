import { expect, test } from '@playwright/test';
import { advance, currentText, engineValue, jumpTo, openWithTestScript } from './helpers';

const spot = (page: import('@playwright/test').Page, id: string) => page.locator(`.object-spot[data-object="${id}"]`);

test.describe('可以點的物件', () => {
  test.beforeEach(async ({ page }) => {
    await openWithTestScript(page);
    await jumpTo(page, 'obj_scene');
    await expect(currentText(page)).toHaveText('物件第一句。');
  });

  test('依 appearAt 出現，持續到場景結束', async ({ page }) => {
    await expect(spot(page, 'o_phone')).toBeVisible();
    await expect(spot(page, 'o_glasses')).toBeVisible();
    await expect(spot(page, 'o_cup')).toHaveCount(0);
    await advance(page);
    await advance(page);
    await expect(currentText(page)).toHaveText('物件第三句。');
    await expect(spot(page, 'o_cup')).toBeVisible();
    await expect(spot(page, 'o_phone')).toBeVisible();
  });

  test('點了跳出說明、暫停遊戲、不推進劇情；再點一下回到原本那句', async ({ page }) => {
    await spot(page, 'o_phone').click({ force: true });
    const inspect = page.locator('.inspect');
    await expect(inspect).toHaveClass(/open/);
    await expect(page.locator('.inspect-label')).toHaveText('手機');
    await expect(page.locator('.inspect-desc')).toHaveText('女兒傳來新做的指甲。');
    await expect(page.locator('.inspect-image')).toHaveAttribute('data-name', 'phone_on_table');
    expect(await engineValue<string>(page, 'phase')).toBe('inspect');
    // 空白鍵不會推進劇情，只會關掉說明
    await page.keyboard.press(' ');
    await expect(inspect).not.toHaveClass(/open/);
    await expect(currentText(page)).toHaveText('物件第一句。');
    await spot(page, 'o_phone').click({ force: true });
    await inspect.click();
    await expect(inspect).not.toHaveClass(/open/);
    await expect(currentText(page)).toHaveText('物件第一句。');
    expect(await engineValue<string>(page, 'phase')).toBe('text');
  });

  test('seen 只記一次並保留第一次點的順序，寫入對話紀錄', async ({ page }) => {
    for (const id of ['o_glasses', 'o_phone', 'o_glasses']) {
      await spot(page, id).click({ force: true });
      await page.locator('.inspect').click();
    }
    expect(await engineValue<string[]>(page, 'seen')).toEqual(['o_glasses', 'o_phone']);
    await expect(spot(page, 'o_glasses')).toHaveClass(/seen/);
    await page.click('.tool-log');
    await expect(page.locator('.log-row.object .log-text')).toHaveText(['（看了眼鏡）', '（看了手機）', '（看了眼鏡）']);
  });

  test('seen() 可以用在 if', async ({ page }) => {
    await spot(page, 'o_phone').click({ force: true });
    await page.locator('.inspect').click();
    await advance(page);
    await advance(page);
    await advance(page);
    await expect(currentText(page)).toHaveText('我剛剛看過手機。');
  });

  test('沒點過就不會出現 seen() 的句子', async ({ page }) => {
    await advance(page);
    await advance(page);
    await advance(page);
    await expect(currentText(page)).toHaveText('物件獨白。');
  });

  test('說明文字的效果：text_blur 與 name_fade', async ({ page }) => {
    await spot(page, 'o_glasses').click({ force: true });
    await expect(page.locator('.inspect-card')).toHaveClass(/fx-name-fade/);
    await expect(page.locator('.inspect-label')).toHaveText('那個東西');
    await page.locator('.inspect').click();
    await advance(page);
    await advance(page);
    await spot(page, 'o_cup').click({ force: true });
    await expect(page.locator('.inspect-card')).toHaveClass(/fx-text-blur/);
    expect(await page.locator('.inspect-desc .glitch-missing, .inspect-desc .glitch-block').count()).toBeGreaterThan(0);
  });

  test('選項出現時熱點隱藏', async ({ page }) => {
    for (let i = 0; i < 3; i++) await advance(page);
    await expect(currentText(page)).toHaveText('物件獨白。');
    await expect(spot(page, 'o_phone')).toBeVisible();
    await advance(page);
    await expect(page.locator('.choices.open .choice')).toHaveCount(2);
    await expect(spot(page, 'o_phone')).toBeHidden();
  });

  test('內心獨白播放中也能點；關掉後獨白重新計時再自動前進', async ({ page }) => {
    for (let i = 0; i < 3; i++) await advance(page);
    await expect(page.locator('.monologue')).toHaveClass(/show/);
    await spot(page, 'o_cup').click({ force: true });
    // 說明開著時不會自動前進
    await page.waitForTimeout(1500);
    await expect(page.locator('.choices.open')).toHaveCount(0);
    await page.locator('.inspect').click();
    await expect(page.locator('.choices.open .choice')).toHaveCount(2, { timeout: 5000 });
  });

  test('seen 納入回上一句的快照', async ({ page }) => {
    await advance(page);
    await expect(currentText(page)).toHaveText('物件第二句。');
    await spot(page, 'o_phone').click({ force: true });
    await page.locator('.inspect').click();
    await advance(page);
    expect(await engineValue<string[]>(page, 'seen')).toEqual(['o_phone']);
    await page.click('.tool-back');
    await expect(currentText(page)).toHaveText('物件第二句。');
    expect(await engineValue<string[]>(page, 'seen')).toEqual([]);
  });

  test('熱點明顯程度隨退化係數降低', async ({ page }) => {
    const alpha = () => page.locator('.objects').evaluate((n) => Number(n.style.getPropertyValue('--obj-alpha')));
    const clear = await alpha();
    await page.keyboard.press('Backquote');
    await page.locator('input[name=dev-degradation]').fill('1');
    await page.keyboard.press('Backquote');
    await advance(page);
    expect(await alpha()).toBeLessThan(clear / 3);
  });
});

test.describe('手機直式', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test('長按物件顯示名稱而不打開說明', async ({ page }) => {
    // 直式畫面只看得到背景圖中間一段，把物件放在中間
    await openWithTestScript(page, undefined, {
      mutate: (s) => {
        const o = s.scenes.find((x) => x.id === 'obj_scene')!.objects![0];
        o.x = 0.5;
      },
    });
    await jumpTo(page, 'obj_scene');
    const s = spot(page, 'o_phone');
    const box = (await s.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect(s).toHaveClass(/show-label/);
    await expect(page.locator('.inspect')).not.toHaveClass(/open/);
  });
});

test('熱點的座標是背景圖上的位置，跟著背景一起平移', async ({ page }) => {
  await openWithTestScript(page);
  await jumpTo(page, 'obj_scene');
  await expect(currentText(page)).toHaveText('物件第一句。');
  const measure = () =>
    page.evaluate(() => {
      const bg = document.querySelector('.bg')!.getBoundingClientRect();
      const spot = document.querySelector('.object-spot[data-object="o_phone"]')!.getBoundingClientRect();
      // 佔位背景是 2304×1080；background-size: cover 後的圖片範圍
      const ratio = 2304 / 1080;
      const imgH = Math.max(bg.height, bg.width / ratio);
      const imgW = imgH * ratio;
      const left = bg.left + (bg.width - imgW) / 2;
      const top = bg.top + (bg.height - imgH) / 2;
      return { dx: spot.x + spot.width / 2 - (left + 0.75 * imgW), dy: spot.y + spot.height / 2 - (top + 0.3 * imgH), bgLeft: bg.left };
    });
  const a = await measure();
  expect(Math.abs(a.dx)).toBeLessThan(3);
  expect(Math.abs(a.dy)).toBeLessThan(3);
  // 視線平移後仍貼在同一個位置
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>('.bg-pan, .objects-pan')) el.style.transition = 'none';
    (window as unknown as { __vn: { view: { panTo(p: number): void } } }).__vn.view.panTo(-6);
  });
  const b = await measure();
  expect(Math.abs(b.bgLeft - a.bgLeft)).toBeGreaterThan(20);
  expect(Math.abs(b.dx)).toBeLessThan(3);
  expect(Math.abs(b.dy)).toBeLessThan(3);
});

test('畫面下方（台詞區、功能列空白處）的物件也點得到', async ({ page }) => {
  await openWithTestScript(page, undefined, {
    mutate: (s) => {
      const objs = s.scenes.find((x) => x.id === 'obj_scene')!.objects!;
      objs[0].y = 0.8;
      objs[0].x = 0.4;
      objs[1].y = 0.88;
      objs[1].x = 0.3;
    },
  });
  await jumpTo(page, 'obj_scene');
  await expect(currentText(page)).toHaveText('物件第一句。');
  for (const id of ['o_phone', 'o_glasses']) {
    const hit = await spot(page, id).evaluate((b) => {
      const r = b.getBoundingClientRect();
      return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
    expect(hit, id).toBe(true);
  }
  await spot(page, 'o_phone').click({ force: true });
  await expect(page.locator('.inspect')).toHaveClass(/open/);
});
