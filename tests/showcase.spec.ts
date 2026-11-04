// 班級展示與互評表（需求書 6-8）。
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { zipSync } from 'fflate';
import { REVIEW_CRITERIA, reviewsCsv, reviewSummary, type Review, type ShowcaseWork } from '../src/guide/review';

const DEMO = JSON.parse(readFileSync(new URL('../examples/寫給未來的我/script.json', import.meta.url), 'utf8'));

function vnproj(title: string, group = ''): Buffer {
  const enc = new TextEncoder();
  const script = { ...DEMO, meta: { ...DEMO.meta, title } };
  const info = { format: 'vn-project', version: 1, title, exportedAt: '2026-01-01T00:00:00Z', ...(group ? { group } : {}) };
  return Buffer.from(zipSync({ 'project.json': enc.encode(JSON.stringify(info)), 'script.json': enc.encode(JSON.stringify(script)) }));
}

test('互評結果：CSV 有標題列、引號處理、平均分數', () => {
  const works: ShowcaseWork[] = [{ id: 'a', title: '外婆的廚房', group: '第1組', file: 'a.vnproj', addedAt: 0 }];
  const reviews: Review[] = [
    { work: 'a', reviewer: '第2組', scores: { feel: 3, clear: 2 }, feel: '外婆叫錯名字，"很難過"', suggest: '選項可以,再少一點', at: 0 },
    { work: 'a', reviewer: '第3組', scores: { feel: 2 }, feel: '', suggest: '', at: 0 },
  ];
  const csv = reviewsCsv(works, reviews);
  expect(csv.startsWith('﻿作品,組別,評的人,')).toBe(true);
  expect(csv).toContain('"外婆叫錯名字，""很難過"""');
  expect(csv).toContain('"選項可以,再少一點"');
  expect(csv.trim().split('\r\n')).toHaveLength(3);
  const s = reviewSummary('a', reviews);
  expect(s.count).toBe(2);
  expect(s.avg.feel).toBe(2.5);
  expect(s.avg.clear).toBe(2);
  expect(s.avg.respect).toBeNull();
  expect(REVIEW_CRITERIA.every((c) => c.levels.length === 3)).toBe(true);
});

test('班級展示：載入多個專案檔、輪流玩、互評、下載結果；自己的專案不受影響', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // 自己的本機專案
  await page.goto('./');
  await page.click('[data-guide=begin]');
  await page.click('[data-guide=start-blank]');
  await expect(page.locator('[data-guide=progress]')).toContainText('第 1 步');

  await page.goto('./#/');
  await page.click('[data-guide=showcase-link]');
  await expect(page.locator('h1')).toHaveText('班級展示');
  await page.setInputFiles('input[name=showcase-files]', [
    { name: '外婆的廚房.vnproj', mimeType: 'application/zip', buffer: vnproj('外婆的廚房', '第1組') },
    { name: '轉學.vnproj', mimeType: 'application/zip', buffer: vnproj('轉學第一天') },
    { name: '壞掉.vnproj', mimeType: 'application/zip', buffer: Buffer.from('not a zip') },
  ]);
  await expect(page.locator('[data-guide=showcase-status]')).toContainText('載入 2 個作品。沒有載入：壞掉.vnproj');
  const items = page.locator('.g-show-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('現在輪到這一組');
  await expect(items.nth(0).locator('input[name=showcase-group]')).toHaveValue('第1組');
  await items.nth(1).locator('input[name=showcase-group]').fill('第2組');

  // 下一組
  await page.click('[data-guide=showcase-next]');
  await expect(items.nth(1)).toContainText('現在輪到這一組');

  // 玩第二個作品
  await items.nth(1).locator('[data-guide=showcase-play]').click();
  await expect(page.locator('.title-screen h1')).toHaveText('轉學第一天');
  await expect(page.locator('[data-guide=showcase-back]')).toBeVisible();
  await page.click('[data-guide=showcase-back]');
  await expect(page.locator('h1')).toHaveText('班級展示');

  // 互評
  const second = page.locator('.g-show-item').nth(1);
  await second.locator('.g-review summary').click();
  await second.locator('input[name=review-reviewer]').fill('第1組');
  await second.locator('input[name=score-feel][value="3"]').check();
  await second.locator('input[name=score-respect][value="2"]').check();
  await second.locator('textarea[name=review-feel]').fill('沒有人叫出主角名字的那一刻');
  await second.locator('textarea[name=review-suggest]').fill('結局可以再留一點希望');
  await second.locator('[data-guide=review-submit]').click();
  await expect(page.locator('.g-show-item').nth(1).locator('[data-guide=review-summary]')).toContainText('1 份互評・平均（1～3）：玩的時候有感覺 3、尊重處境、沒有刻板印象 2');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-guide=review-download]')]);
  expect(dl.suggestedFilename()).toBe('互評結果.csv');
  const csv = await readFile(await dl.path(), 'utf8');
  expect(csv).toContain('轉學第一天,第2組,第1組,3,,2,,沒有人叫出主角名字的那一刻,結局可以再留一點希望');

  // 重新整理：作品、組別、互評都在
  await page.reload();
  await expect(page.locator('.g-show-item')).toHaveCount(2);
  await expect(page.locator('.g-show-item').nth(1).locator('input[name=showcase-group]')).toHaveValue('第2組');

  // 列印時只有紙本互評表
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.g-review-paper')).toHaveCount(2);
  await expect(page.locator('.g-review-paper').first()).toBeVisible();
  await expect(page.locator('.g-show-item').first()).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('.g-review-paper').first()).toBeHidden();

  // 自己的專案還是空白範本
  await page.goto('./play.html');
  await expect(page.locator('.title-screen h1')).not.toHaveText('轉學第一天');
  await expect(page.locator('[data-guide=showcase-back]')).toHaveCount(0);

  // 清空
  await page.goto('./#/showcase');
  page.on('dialog', (d) => void d.accept());
  await page.click('[data-guide=showcase-clear]');
  await expect(page.locator('.g-show-item')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('給老師的文件：教案、評分規準（表格）、安全守則，都標示是草稿', async ({ page }) => {
  await page.goto('./');
  await page.click('[data-guide=docs-link]');
  await expect(page.locator('h1')).toHaveText('給老師的文件');
  await page.click('[data-doc=plan]');
  await expect(page.locator('[data-teacher-doc=plan] h1')).toContainText('教案');
  await expect(page.locator('[data-teacher-doc=plan]')).toContainText('草稿');
  await page.goto('./#/docs/rubric');
  await expect(page.locator('[data-teacher-doc=rubric] table th').first()).toHaveText('向度');
  await expect(page.locator('[data-teacher-doc=rubric] tbody tr')).toHaveCount(6);
  await page.goto('./#/docs/safety');
  await expect(page.locator('[data-teacher-doc=safety]')).toContainText('需要輔導專業審閱');
  await expect(page.locator('[data-teacher-doc=safety]')).toContainText('1925');
  // 巢狀清單
  await expect(page.locator('[data-teacher-doc=safety] li ul li').first()).toBeVisible();
});
