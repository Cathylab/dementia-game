// 老師代貼提示詞（需求書 6-6）：代貼單與回覆檔的格式、學生 → 老師工作台 → 學生的完整來回。
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { expect, test, type Download, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { parseReply, parseRequest, relayFileName, replyText, requestText } from '../src/guide/relay';

const DEMO_TEXT = readFileSync(new URL('../examples/寫給未來的我/script.json', import.meta.url), 'utf8');

test('格式：代貼單與回覆檔可以讀回來；不是的檔案回傳 null', () => {
  const req = { group: '三年二班第 3 組', title: '轉學第一天', step: 'outline', stepTitle: '分場大綱', prompt: '第一行\n第二行\n──── 不是結尾 ────' };
  expect(parseRequest(requestText(req))).toEqual(req);
  const rep = { group: '第 3 組', title: '轉學第一天', step: 'script', stepTitle: '完整劇本', answer: '{"a": 1}\n\n多行回答' };
  expect(parseReply(replyText(rep))).toEqual(rep);
  expect(parseRequest(replyText(rep))).toBeNull();
  expect(parseReply('隨便一段文字')).toBeNull();
  expect(parseRequest(requestText({ ...req, group: '' }))!.group).toBe('');
  expect(relayFileName('代貼單', { group: '三年二班 第3組', stepTitle: '分場大綱' })).toBe('代貼單-三年二班第3組-分場大綱.txt');
});

const text = async (d: Download) => readFile(await d.path(), 'utf8');

async function startClass(page: Page, group: string) {
  await page.goto('./');
  await page.click('[data-guide=begin]');
  await page.click('[data-guide=start-class]');
  await page.locator('input[name=guide-title]').fill('轉學第一天');
  await page.locator('textarea[name=guide-goal]').fill('體會轉學第一天');
  await page.locator('input[name=guide-group]').fill(group);
  await page.click('[data-guide=next]');
  await expect(page.locator('[data-guide=progress]')).toContainText('第 2 堂');
}

test('學生下載代貼單 → 老師工作台貼回答、下載回覆 → 學生讀取，自動填進貼上區', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startClass(page, '第3組');
  const outline = page.locator('[data-embed=outline]');
  await outline.locator('[data-guide=relay] summary').click();
  const [reqDl] = await Promise.all([page.waitForEvent('download'), outline.locator('[data-guide=relay-download]').click()]);
  expect(reqDl.suggestedFilename()).toBe('代貼單-第3組-分場大綱.txt');
  const reqText = await text(reqDl);
  expect(reqText).toContain('組別：第3組');
  expect(reqText).toContain('體會轉學第一天');

  // 老師工作台（同一台電腦示範；實際上是老師的電腦）
  await page.goto('./#/teacher');
  await expect(page.locator('h1')).toHaveText('老師工作台：代貼提示詞');
  await page.setInputFiles('input[name=teacher-files]', { name: reqDl.suggestedFilename(), mimeType: 'text/plain', buffer: Buffer.from(reqText) });
  const item = page.locator('.g-relay-item');
  await expect(item).toHaveCount(1);
  await expect(item.locator('h3')).toHaveText('第3組・分場大綱');
  await item.locator('textarea[name=teacher-answer]').fill('AI 的分場大綱：a1_s01 教室……a2_s01 走廊……結局……');
  const [repDl] = await Promise.all([page.waitForEvent('download'), item.locator('[data-guide=teacher-download]').click()]);
  expect(repDl.suggestedFilename()).toBe('回覆-第3組-分場大綱.txt');
  const repText = await text(repDl);
  // 重新整理後工作台的內容還在
  await page.reload();
  await expect(page.locator('.g-relay-item textarea[name=teacher-answer]')).toHaveValue(/AI 的分場大綱/);
  const [zipDl] = await Promise.all([page.waitForEvent('download'), page.click('[data-guide=teacher-download-all]')]);
  expect(Object.keys(unzipSync(new Uint8Array(await readFile(await zipDl.path()))))).toEqual(['回覆-第3組-分場大綱.txt']);

  // 學生讀取回覆
  await page.goto('./#/lesson/2');
  const back = page.locator('[data-embed=outline]');
  await back.locator('[data-guide=relay] summary').click();
  await back.locator('input[name=relay-reply]').setInputFiles({ name: '回覆.txt', mimeType: 'text/plain', buffer: Buffer.from(repText) });
  await expect(back.locator('[data-guide=relay-status]')).toContainText('已讀取老師的回覆（第3組）');
  await expect(back.locator('textarea[name=guide-paste]')).toHaveValue(/AI 的分場大綱/);
  await expect(back.locator('[data-guide=status]')).toContainText('可以進下一步');

  // 拿到別的步驟的回覆：擋下
  const wrong = replyText({ group: '第3組', title: '轉學第一天', step: 'script', stepTitle: '完整劇本', answer: 'x' });
  await back.locator('input[name=relay-reply]').setInputFiles({ name: 'w.txt', mimeType: 'text/plain', buffer: Buffer.from(wrong) });
  await expect(back.locator('[data-guide=relay-status]')).toContainText('不是這一步的');
  expect(errors).toEqual([]);
});

test('完整劇本那一步：讀取老師回覆的劇本後自動檢查', async ({ page }) => {
  await startClass(page, '第5組');
  await page.click('[data-guide=next]');
  const script = page.locator('[data-embed=script]');
  await script.locator('[data-guide=relay] summary').click();
  const reply = replyText({ group: '第5組', title: '轉學第一天', step: 'script', stepTitle: '完整劇本', answer: `好的，這是劇本：\n${DEMO_TEXT}` });
  await script.locator('input[name=relay-reply]').setInputFiles({ name: 'r.txt', mimeType: 'text/plain', buffer: Buffer.from(reply) });
  // 這一組選的是「一般故事」包：Demo 的效果只會是「建議修正」，不擋
  await expect(script.locator('[data-guide=result]')).toContainText('《寫給未來的我》：21 個場景');
  await expect(script.locator('[data-guide=result]')).not.toContainText('必須修正');
  await expect(script.locator('[data-guide=apply]')).toBeEnabled();
});

test('首頁有老師工作台的連結', async ({ page }) => {
  await page.goto('./');
  await page.click('[data-guide=teacher-link]');
  await expect(page.locator('h1')).toHaveText('老師工作台：代貼提示詞');
});
