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

/** 一路點到結局；遇到選項時依 pick(場景 id) 決定點第幾個。 */
async function playToEnding(page: Page, pick: (sceneId: string) => number) {
  const stage = page.locator('#stage');
  const ending = page.locator('.ending-screen.open');
  for (let i = 0; i < 400; i++) {
    if (await ending.isVisible()) return;
    const items = page.locator('.choices.open .choice:not(.vanishing), .choices.open .hotspot:not(.vanishing)');
    if ((await items.count()) > 0) {
      const scene = (await stage.getAttribute('data-scene')) ?? '';
      const index = pick(scene);
      const target = page.locator(`.choices.open [data-index="${index}"]:not(.vanishing)`);
      await (((await target.count()) > 0 ? target : items.first()).click({ timeout: 2000 }));
    } else {
      await stage.click({ position: { x: 400, y: 200 } });
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
  await playToEnding(page, () => 0);
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
    const picks = new Map(path.map((p) => p.split('#') as [string, string]));
    await playToEnding(page, (scene) => Number(picks.get(scene) ?? 0));
    await expect(page.locator('.ending-screen')).toHaveAttribute('data-ending-id', endingId);
  });
}
