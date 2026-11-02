import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { Script } from '../src/types';
import { reachableEndings } from './simulate';

const demo = JSON.parse(readFileSync(new URL('../public/script.json', import.meta.url), 'utf8')) as Script;

async function open(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('dementia-vn-settings', JSON.stringify({ textSpeed: 100, volume: 0.2 }));
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./?timescale=0.5');
  return errors;
}

/** 依模擬器給的路線決定要點的物件與選項。 */
interface Plan {
  /** `場景#句` → 選項 index */
  pick: (sceneId: string, line: number) => number;
  /** 要點的物件 id */
  clicks?: string[];
}

/** 一路點到結局；遇到選項時依 plan 決定點第幾個，路上順手點物件。 */
async function playToEnding(page: Page, plan: Plan) {
  const stage = page.locator('#stage');
  const ending = page.locator('.ending-screen.open, .memory-page.open');
  const pending = new Set(plan.clicks ?? []);
  for (let i = 0; i < 600; i++) {
    if (await ending.first().isVisible()) return;
    if (await page.locator('.inspect.open').count()) {
      await page.locator('.inspect.open').click();
      continue;
    }
    for (const id of [...pending]) {
      const spot = page.locator(`.object-spot[data-object="${id}"]`);
      if ((await stage.getAttribute('data-phase')) === 'text' && (await spot.count()) && (await spot.isVisible())) {
        await spot.click({ force: true });
        pending.delete(id);
      }
    }
    if (await page.locator('.inspect.open').count()) continue;
    const items = page.locator('.choices.open .choice:not(.vanishing):not(:disabled), .choices.open .hotspot:not(.vanishing):not(:disabled)');
    if ((await items.count()) > 0) {
      const scene = (await stage.getAttribute('data-scene')) ?? '';
      const line = await page.evaluate(() => (window as unknown as { __vn: { engine: { index: number } } }).__vn.engine.index);
      const index = plan.pick(scene, line);
      const target = page.locator(`.choices.open [data-index="${index}"]:not(.vanishing):not(:disabled)`);
      await ((await target.count()) > 0 ? target : items.first()).click({ timeout: 2000 });
    } else {
      await stage.click({ position: { x: 190, y: 620 } });
    }
    await page.waitForTimeout(60);
  }
  throw new Error('沒有走到結局');
}

test('載入腳本並顯示標題', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('.title-screen h1')).toHaveText(demo.meta.title);
  await page.click('.start-button');
  await expect(page.locator('#stage')).toHaveAttribute('data-scene', demo.scenes[0].id);
  await expect(page.locator('.dialog .text, .monologue-text').first()).not.toBeEmpty();
  expect(errors).toEqual([]);
});

test('一路選第一個選項可以走到結局，並能回到標題', async ({ page }) => {
  const errors = await open(page);
  await page.click('.start-button');
  await playToEnding(page, { pick: () => 0 });
  const id = await page.locator('.ending-screen').getAttribute('data-ending-id');
  expect(demo.endings.map((e) => e.id)).toContain(id);
  await page.click('.ending-screen .start-button');
  await expect(page.locator('.title-screen')).toBeVisible();
  expect(errors).toEqual([]);
});

// 依模擬器找出的路線，實際在瀏覽器裡把每個結局都走一次。
for (const [endingId, path] of reachableEndings(demo)) {
  test(`可以實際走到結局 ${endingId}`, async ({ page }) => {
    await open(page);
    await page.click('.start-button');
    const picks = new Map(
      path.filter((p) => !p.startsWith('click:')).map((p) => {
        const [scene, line, index] = p.split('#');
        return [`${scene}#${line}`, Number(index)] as const;
      }),
    );
    const clicks = path.filter((p) => p.startsWith('click:')).map((p) => p.slice(6));
    await playToEnding(page, { pick: (scene, line) => picks.get(`${scene}#${line}`) ?? 0, clicks });
    await expect(page.locator('.ending-screen')).toHaveAttribute('data-ending-id', endingId);
  });
}
