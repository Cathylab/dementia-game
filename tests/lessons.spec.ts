// 課堂模式（需求書 6-1）：4 到 6 堂課，每堂一張任務卡。
import { expect, test } from '@playwright/test';
import { LESSON_MINUTES, LESSONS } from '../src/guide/lessons';
import { STEPS } from '../src/guide/steps';

test('任務卡的設計：4 到 6 堂，每堂在一節課內做得完，用到的步驟都存在', () => {
  expect(LESSONS.length).toBeGreaterThanOrEqual(4);
  expect(LESSONS.length).toBeLessThanOrEqual(6);
  // 九個步驟，加上不在步驟裡的工具（照格子填）
  const stepIds = new Set([...STEPS.map((s) => s.id), 'grid', 'sources', 'stereotype', 'drawings']);
  for (const l of LESSONS) {
    const total = l.tasks.reduce((sum, t) => sum + t.minutes, 0);
    expect(total, l.title).toBeLessThanOrEqual(LESSON_MINUTES);
    for (const id of l.steps) expect(stepIds.has(id), `${l.title} 用到 ${id}`).toBe(true);
    expect(new Set(l.tasks.map((t) => t.id)).size).toBe(l.tasks.length);
  }
  // 九個步驟裡需要動手的部分都有排進某一堂（三個方向、設計表、美術需求在課堂版省略）
  const used = new Set(LESSONS.flatMap((l) => l.steps));
  for (const id of ['theme', 'outline', 'script', 'assets', 'playtest', 'publish']) expect(used.has(id), id).toBe(true);
});

test('課堂模式：任務卡、打勾記得、嵌入步驟工具、換堂、切到完整步驟', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('[data-guide=class-hint]')).toContainText('課堂模式');
  await page.click('[data-guide=begin]');
  await page.click('[data-guide=start-class]');
  const progress = page.locator('[data-guide=progress]');
  await expect(progress).toContainText(`第 1 堂，共 ${LESSONS.length} 堂`);
  await expect(page.locator('[data-lesson=l1] h1')).toHaveText(LESSONS[0].title);
  await expect(page.locator('[data-lesson=l1] .g-tasks li')).toHaveCount(LESSONS[0].tasks.length);
  // 第一堂嵌入「選題材包與主題」：課堂模式預設短篇
  await expect(page.locator('[data-embed=theme]')).toBeVisible();
  await expect(page.locator('input[name=guide-length][value=short]')).toBeChecked();
  await page.locator('input[name=guide-title]').fill('課堂作品');
  await page.locator('textarea[name=guide-goal]').fill('讓同學體會轉學第一天');
  await page.locator('input[data-task="l1.play"]').check();
  await page.locator('input[data-task="l1.roles"]').check();

  // 下一堂：分場大綱
  await page.click('[data-guide=next]');
  await expect(progress).toContainText('第 2 堂');
  await expect(page.locator('[data-embed=outline]')).toBeVisible();
  await expect(page.locator('[data-guide=prompt]')).toContainText('讓同學體會轉學第一天');

  // 重新打開：首頁顯示「第 2 堂」，第一堂的勾還在
  await page.goto('./');
  await expect(page.locator('[data-guide=resume]')).toHaveText('繼續做《課堂作品》（第 2 堂）');
  await page.goto('./#/lesson/1');
  await expect(page.locator('input[data-task="l1.play"]')).toBeChecked();
  await expect(page.locator('input[data-task="l1.theme"]')).not.toBeChecked();

  // 列印時只留任務卡
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('[data-embed=theme]')).toBeHidden();
  await expect(page.locator('[data-lesson=l1]')).toBeVisible();
  await page.emulateMedia({ media: 'screen' });

  // 改用完整的九個步驟，內容共用
  await page.click('[data-guide=to-full]');
  await expect(progress).toContainText('第 1 步，共 9 步');
  await expect(page.locator('textarea[name=guide-goal]')).toHaveValue('讓同學體會轉學第一天');
  await page.goto('./');
  await expect(page.locator('[data-guide=resume]')).toContainText('步）');
  expect(errors).toEqual([]);
});
