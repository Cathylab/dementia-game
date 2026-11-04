// 階段二 B-7 成效評估：玩前、玩後問卷（survey.json），匿名、只存在瀏覽器，開發者面板統計與匯出 CSV。
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { surveyCsv, surveyStats, validateSurvey, type Survey } from '../src/survey';
import { advance, jumpTo, openWithTestScript } from './helpers';

const SURVEY: Survey = {
  title: '小問卷',
  intro: '匿名，只存在這台電腦。',
  pre: [
    { id: 'know', text: '你對失智症了解多少？', type: 'scale', minLabel: '很少', maxLabel: '很多', required: true },
    { id: 'role', text: '你是？', type: 'choice', options: ['學生', '家屬', '其他'] },
  ],
  post: [
    { id: 'know', text: '你對失智症了解多少？', type: 'scale' },
    { id: 'note', text: '想說的話', type: 'text' },
  ],
};

async function withSurvey(page: Page, survey: Survey | null = SURVEY) {
  await page.route('**/projects.json', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ dir: 'examples/寫給未來的我', kind: 'example', title: 'x', survey: !!survey }]) }),
  );
  if (survey) await page.route('**/survey.json', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(survey) }));
  await openWithTestScript(page);
}

test('問卷格式檢查', () => {
  expect(validateSurvey(SURVEY)).toEqual([]);
  expect(validateSurvey({ pre: [{ id: 'a b', text: '', type: 'choice', options: ['x'] }] }).length).toBe(3);
});

test('玩前問卷：開始之後先填，必答沒填會提醒；可以略過', async ({ page }) => {
  await withSurvey(page);
  await page.click('.start-button');
  const form = page.locator('.survey-form[data-survey=pre]');
  await expect(form).toContainText('匿名，只存在這台電腦');
  await form.locator('[data-survey-action=submit]').click();
  await expect(form.locator('.survey-error')).toContainText('第 1 題');
  await form.locator('[data-q=know] input[value="4"]').check({ force: true });
  await form.locator('[data-q=role] input[value="家屬"]').check({ force: true });
  await form.locator('[data-survey-action=submit]').click();
  await expect(form).toHaveCount(0);
  await expect(page.locator('#stage')).toHaveAttribute('data-phase', /text|choice/, { timeout: 15_000 });
  const saved = await page.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith('vn-survey:'))?.[1]);
  expect(JSON.parse(saved!)[0].pre).toEqual({ know: 4, role: '家屬' });
});

test('玩後問卷：結局「回到標題」之前填；開發者面板有統計、可以匯出 CSV', async ({ page }) => {
  await withSurvey(page);
  await page.click('.start-button');
  await page.locator('[data-survey-action=skip]').click();
  await jumpTo(page, 'end_z');
  await advance(page);
  await page.locator('.ending-screen.open .start-button').click();
  const form = page.locator('.survey-form[data-survey=post]');
  await form.locator('[data-q=know] input[value="5"]').check({ force: true });
  await form.locator('[data-q=note] textarea').fill('謝謝，"很有感"');
  await form.locator('[data-survey-action=submit]').click();
  await expect(page.locator('.title-screen')).toHaveClass(/open/);

  await page.keyboard.press('Backquote');
  const stats = page.locator('[data-dev=survey-stats]');
  await expect(stats).toContainText('1 次遊玩');
  await expect(stats.locator('[data-q=post_know]')).toContainText('平均 5');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-dev=survey-csv]')]);
  const csv = await readFile(await download.path(), 'utf8');
  expect(csv.split('\r\n')[0]).toBe('﻿session,started_at,ending,pre_know,pre_role,post_know,post_note');
  expect(csv).toContain(',ending_z,,,5,"謝謝，""很有感"""');
});

test('沒有 survey.json：不問、不發請求', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (r) => r.url().includes('survey.json') && requested.push(r.url()));
  await withSurvey(page, null);
  await page.click('.start-button');
  await expect(page.locator('#stage')).toHaveAttribute('data-phase', /text|choice/, { timeout: 15_000 });
  expect(requested).toEqual([]);
  await page.keyboard.press('Backquote');
  await expect(page.locator('details[data-section=問卷結果]')).toHaveCount(0);
});

test('統計與 CSV（純函式）', () => {
  const sessions = [
    { id: 'a', startedAt: 0, pre: { know: 2, role: '學生' }, post: { know: 4 } },
    { id: 'b', startedAt: 0, pre: { know: 4, role: '學生' } },
  ];
  const st = surveyStats(SURVEY, sessions);
  expect(st.find((s) => s.part === 'pre' && s.q.id === 'know')!.average).toBe(3);
  expect(st.find((s) => s.q.id === 'role')!.counts).toEqual({ 學生: 2, 家屬: 0, 其他: 0 });
  expect(surveyCsv(SURVEY, sessions).split('\r\n')).toHaveLength(3);
});
