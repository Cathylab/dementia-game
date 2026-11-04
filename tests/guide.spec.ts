// 引導網站（需求書 5.1）：首頁、試玩片段、舊連結轉址、開始、步驟頁、記得做到哪裡、離線版「開始.html」。
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const OUT = fileURLToPath(new URL('../dist-offline/', import.meta.url));

async function noErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('首頁：一句話說明、開始按鈕、試玩片段、九個步驟、題材包與範例、製作紀錄', async ({ page }) => {
  const errors = await noErrors(page);
  await page.goto('./');
  await expect(page.locator('.g-hero h1')).toBeVisible();
  await expect(page.locator('[data-guide=begin]')).toHaveText('開始做我的遊戲');
  await expect(page.locator('iframe.g-clip')).toHaveAttribute('src', /play\.html\?.*clip=a4_s14/);
  await expect(page.locator('.g-overview li')).toHaveCount(9);
  await expect(page.locator('.g-overview')).toContainText('需要 AI');
  await expect(page.locator('[data-guide=packs]')).toContainText('失智症');
  await expect(page.locator('[data-guide=packs]')).toContainText('範例：玩《寫給未來的我》');
  await page.locator('.g-making summary').click();
  await expect(page.locator('.g-making')).toContainText('和 AI 分工');
  // 試玩片段在 iframe 裡是可以玩的遊戲
  const clip = page.frameLocator('iframe.g-clip');
  await expect(clip.locator('.project-badge')).toHaveText('試玩片段（約 1 分鐘）');
  expect(errors).toEqual([]);
});

test('以前分享的連結（首頁加參數）轉到遊戲頁', async ({ page }) => {
  await page.goto('./?dev=1&timescale=0.2');
  await expect(page).toHaveURL(/play\.html\?dev=1&timescale=0\.2$/);
  await expect(page.locator('.devpanel')).toBeVisible();
});

test('試玩片段：從指定的地方開始，離開場景時顯示片段結束，可以再玩一次', async ({ page }) => {
  await page.goto(`./play.html?project=${encodeURIComponent('examples/寫給未來的我')}&site=1&clip=a4_s14&from=6&timescale=0.2`);
  await expect(page.locator('.project-badge')).toHaveText('試玩片段（約 1 分鐘）');
  await page.click('.start-button');
  await expect(page.locator('#stage')).toHaveAttribute('data-scene', 'a4_s14', { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __vn: { engine: { index: number } } }).__vn.engine.index)).toBeGreaterThanOrEqual(6);
  await page.evaluate(() => (window as unknown as { __vn: { engine: { gotoScene(id: string): Promise<void> } } }).__vn.engine.gotoScene('a4_s15'));
  const end = page.locator('[data-clip=end]');
  await expect(end).toBeVisible();
  await expect(end).toContainText('片段結束');
  await expect(end.locator('a')).toHaveAttribute('href', /play\.html\?project=.*&site=1$/);
  await end.getByText('再玩一次').click();
  await expect(end).toBeHidden();
  await expect(page.locator('#stage')).toHaveAttribute('data-scene', 'a4_s14');
});

test('引導流程：從空白開始，看得到第幾步；上一步、跳過；關掉再打開回到同一步', async ({ page }) => {
  const errors = await noErrors(page);
  await page.goto('./');
  await page.click('[data-guide=begin]');
  await page.click('[data-guide=start-blank]');
  const progress = page.locator('[data-guide=progress]');
  await expect(progress).toContainText('第 1 步，共 9 步');
  await expect(progress).toContainText('還剩 8 步');
  await expect(page.locator('.g-step h1')).toHaveText('1. 選題材包與主題');
  await expect(page.locator('.g-project')).toHaveText('《我的遊戲》');
  await expect(page.locator('[data-guide=prev]')).toBeDisabled();
  // 第 1 步要寫下想讓玩家體會的事，才能下一步
  await expect(page.locator('[data-guide=next]')).toBeDisabled();
  await page.locator('textarea[name=guide-goal]').fill('讓玩家體會一件事');
  await page.click('[data-guide=next]');
  await expect(progress).toContainText('第 2 步');
  await page.click('[data-guide=skip]');
  await expect(progress).toContainText('第 3 步');
  await expect(page.locator('.g-pills li:nth-child(2) a')).toHaveClass(/skipped/);
  await page.click('[data-guide=prev]');
  await expect(progress).toContainText('第 2 步');
  // 隨時可以切到故事編輯器或試玩
  await expect(page.locator('[data-guide=open-editor]')).toHaveAttribute('href', 'play.html?story=1');
  await expect(page.locator('[data-guide=playtest]')).toHaveAttribute('href', 'play.html');

  // 關掉再打開：首頁有「繼續」，回到第 2 步
  await page.goto('./');
  await expect(page.locator('[data-guide=resume]')).toHaveText('繼續做《我的遊戲》（第 2 步）');
  await page.click('[data-guide=resume]');
  await expect(progress).toContainText('第 2 步');
  // 遊戲頁開的是這個本機專案
  await page.goto('./play.html');
  await expect(page.locator('.title-screen h1')).toHaveText('我的遊戲');
  await expect(page.locator('.project-badge')).toContainText('本機專案');
  expect(errors).toEqual([]);
});

test('已經有專案時開始新的：先確認，再取代', async ({ page }) => {
  await page.goto('./');
  await page.click('[data-guide=begin]');
  await page.click('[data-guide=start-blank]');
  await expect(page.locator('[data-guide=progress]')).toBeVisible();
  await page.goto('./#/start');
  await expect(page.locator('.g-warn')).toContainText('《我的遊戲》');
  page.once('dialog', (d) => void d.dismiss());
  await page.click('[data-guide=start-example]');
  await expect(page.locator('.g-choices')).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await page.click('[data-guide=start-example]');
  await expect(page.locator('.g-project')).toHaveText('《寫給未來的我》');
});

test('離線版「開始.html」：引導網站照樣能用，連結指到離線的遊戲 html', async ({ page }) => {
  const errors = await noErrors(page);
  await page.goto(pathToFileURL(join(OUT, '開始.html')).href);
  await expect(page.locator('.g-hero h1')).toBeVisible();
  await expect(page.locator('iframe.g-clip')).toHaveAttribute('src', /^%E7%8E%A9%20Demo\.html\?.*clip=a4_s14/);
  await expect(page.locator('[data-guide=play-demo]')).toHaveAttribute('href', /^%E7%8E%A9%20Demo\.html\?site=1$/);
  await expect(page.locator('[data-guide=packs]')).toContainText('一般故事');
  await page.click('[data-guide=begin]');
  await page.click('[data-guide=start-blank]');
  await expect(page.locator('[data-guide=progress]')).toContainText('第 1 步，共 9 步');
  await page.locator('textarea[name=guide-goal]').fill('離線的目標');
  await page.click('[data-guide=next]');
  // 等換到第 2 步（存檔完成）再離開
  await expect(page.locator('[data-guide=progress]')).toContainText('第 2 步');
  await page.goto(pathToFileURL(join(OUT, '開始.html')).href);
  await expect(page.locator('[data-guide=resume]')).toContainText('第 2 步');
  expect(errors).toEqual([]);
});
