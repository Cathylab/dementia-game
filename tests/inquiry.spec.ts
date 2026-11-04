// 分組角色卡、查證引導、刻板印象檢查清單（需求書 6-3、6-4）。
import { expect, test } from '@playwright/test';
import { ROLES, roleTasks, STEREOTYPE_CHECKLIST } from '../src/guide/roles';
import { LESSONS } from '../src/guide/lessons';

test('角色卡：四個角色，每個角色在至少三堂課有事做；每個任務都有人負責', () => {
  expect(ROLES.map((r) => r.id)).toEqual(['編劇', '美術', '查證', '測試員']);
  for (const r of ROLES) expect(roleTasks(r.id).length, r.id).toBeGreaterThanOrEqual(3);
  const ids = new Set(ROLES.map((r) => r.id as string).concat('全組'));
  for (const l of LESSONS) for (const t of l.tasks) expect(ids.has(t.role ?? ''), `${l.title}：${t.text}`).toBe(true);
});

test('角色卡頁面：四張卡，從首頁與任務卡都能打開', async ({ page }) => {
  await page.goto('./');
  await page.click('[data-guide=roles-link]');
  await expect(page.locator('h1')).toHaveText('分組角色卡');
  await expect(page.locator('.g-role-card')).toHaveCount(4);
  await expect(page.locator('[data-role=查證]')).toContainText('資料來源表');
  await expect(page.locator('[data-role=查證] .g-role-tasks')).toContainText('第 1 堂');
});

test('課堂模式：資料來源表記得內容，並放進之後的提示詞；試玩那堂有刻板印象檢查清單', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.click('[data-guide=begin]');
  await page.click('[data-guide=start-class]');
  await page.locator('input[name=guide-title]').fill('外婆的廚房');
  await page.locator('textarea[name=guide-goal]').fill('體會外婆忘記事情時的心情');
  const src = page.locator('[data-embed=sources]');
  await expect(src).toBeVisible();
  await src.locator('input[name=source-claim]').fill('想不起熟人的名字');
  await src.locator('input[name=source-source]').fill('台灣失智症協會');
  await src.locator('[data-guide=source-add]').click();
  await expect(src.locator('fieldset[data-source]')).toHaveCount(2);
  await src.locator('input[name=source-claim]').nth(1).fill('分不清白天晚上');
  await src.locator('input[name=source-source]').nth(1).fill('衛生福利部');

  // 下一堂的提示詞帶著查證過的資料
  await page.click('[data-guide=next]');
  await expect(page.locator('[data-guide=progress]')).toContainText('第 2 堂');
  const prompt = page.locator('[data-embed=outline] [data-guide=prompt]');
  await expect(prompt).toContainText('查證過的資料');
  await expect(prompt).toContainText('想不起熟人的名字：台灣失智症協會');
  await expect(prompt).toContainText('分不清白天晚上：衛生福利部');
  // 同一張表在第 2 堂也能繼續補
  await expect(page.locator('[data-embed=sources] fieldset[data-source]')).toHaveCount(2);

  // 刪除一筆
  await page.goto('./#/lesson/1');
  await page.locator('[data-source="1"] button', { hasText: '刪除' }).click();
  await expect(page.locator('[data-embed=sources] fieldset[data-source]')).toHaveCount(1);

  // 試玩那一堂：檢查清單
  const n = LESSONS.findIndex((l) => l.steps.includes('stereotype')) + 1;
  await page.goto(`./#/lesson/${n}`);
  const list = page.locator('[data-embed=stereotype]');
  await expect(list.locator('input[name=stereotype-check]')).toHaveCount(STEREOTYPE_CHECKLIST.length);
  await list.locator('input[name=stereotype-check]').nth(0).check();
  await list.locator('input[name=stereotype-check]').nth(2).check();
  await expect(list.locator('[data-guide=stereotype-count]')).toContainText(`2 / ${STEREOTYPE_CHECKLIST.length}`);
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('[data-embed=stereotype] input[name=stereotype-check]').nth(2)).toBeChecked();
  await expect(page.locator('[data-embed=stereotype] input[name=stereotype-check]').nth(1)).not.toBeChecked();
  expect(errors).toEqual([]);
});

test('完整模式：第 1 步可以展開資料來源表，第 8 步可以展開刻板印象檢查清單', async ({ page }) => {
  await page.goto('./');
  await page.click('[data-guide=begin]');
  await page.click('[data-guide=start-blank]');
  await expect(page.locator('[data-guide=progress]')).toContainText('第 1 步');
  await page.locator('[data-guide=sources-alt] summary').click();
  await expect(page.locator('[data-guide=sources-alt] [data-embed=sources]')).toBeVisible();
  await page.goto('./#/step/8');
  await page.locator('[data-guide=stereotype-alt] summary').click();
  await expect(page.locator('[data-guide=stereotype-alt] input[name=stereotype-check]')).toHaveCount(STEREOTYPE_CHECKLIST.length);
});
