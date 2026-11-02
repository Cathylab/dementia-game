import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { structureOf } from '../src/editable';
import type { Script } from '../src/types';
import { currentText, openWithTestScript, testScript } from './helpers';

const field = (page: Page, path: string) => page.locator(`.editor-field[data-path="${path}"] textarea`);
const FIRST = 'scenes.0.lines.0.text';
const scriptValue = (page: Page, path: string) =>
  page.evaluate((p) => p.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], (window as unknown as { __vn: { engine: { script: unknown } } }).__vn.engine.script), path);

test.describe('文字編輯', () => {
  test.beforeEach(async ({ page }) => {
    await openWithTestScript(page, 'timescale=0.2&edit=1');
    await expect(page.locator('.editor')).toHaveClass(/open/);
  });

  test('列出可以改的文字；結構欄位不能改', async ({ page }) => {
    await expect(field(page, FIRST)).toHaveValue('旁白第一句。');
    await expect(page.locator('.editor-field[data-kind="option.text"]').first()).toBeVisible();
    await expect(page.locator('.editor-field[data-kind="object.truth"]').first()).toBeVisible();
    await expect(page.locator('.editor-field[data-kind="ending.title"]')).toHaveCount(3);
    await expect(page.locator('.editor-field[data-kind="memoryReview.intro"]')).toHaveCount(1);
    // if 只顯示、不能編輯
    await expect(page.locator('.editor-field[data-path="scenes.0.lines.0.text"]')).toBeVisible();
    await expect(page.locator('.editor-note').filter({ hasText: 'if: has("flag_a")' }).first()).toBeVisible();
    expect(await page.locator('.editor textarea').evaluateAll((ts) => ts.every((t) => t.closest('.editor-field')))).toBe(true);
    await expect(page.locator('.editor-field[data-path$=".goto"], .editor-field[data-path$=".if"]')).toHaveCount(0);
  });

  test('修改立即套用到遊戲；試播從那一句開始', async ({ page }) => {
    await field(page, FIRST).fill('改過的第一句。');
    expect(await scriptValue(page, FIRST)).toBe('改過的第一句。');
    await expect(page.locator('.editor-status')).toHaveText('有未儲存的變更');
    await page.locator('.editor-field[data-path="scenes.0.lines.0.text"] .editor-play').click();
    await expect(page.locator('.editor')).not.toHaveClass(/open/);
    await expect(currentText(page)).toHaveText('改過的第一句。');
  });

  test('復原與重做（按鈕與快捷鍵）', async ({ page }) => {
    const a = field(page, FIRST);
    const b = field(page, 'scenes.0.lines.1.text');
    await a.fill('一');
    await page.waitForTimeout(900);
    await a.fill('一二');
    await page.waitForTimeout(900);
    await b.fill('別句');
    await page.click('[data-editor=undo]');
    await expect(b).toHaveValue('角色第一句。');
    await page.keyboard.press('Control+z');
    await expect(a).toHaveValue('一');
    await page.keyboard.press('Control+z');
    await expect(a).toHaveValue('旁白第一句。');
    expect(await scriptValue(page, FIRST)).toBe('旁白第一句。');
    await expect(page.locator('[data-editor=undo]')).toBeDisabled();
    await expect(page.locator('.editor-status')).toHaveText('沒有未儲存的變更');
    await page.click('[data-editor=redo]');
    await expect(a).toHaveValue('一');
    await page.keyboard.press('Control+Shift+z');
    await expect(a).toHaveValue('一二');
    await page.keyboard.press('Control+y');
    await expect(b).toHaveValue('別句');
    await expect(page.locator('[data-editor=redo]')).toBeDisabled();
  });

  test('連續打字併成一步復原', async ({ page }) => {
    const a = field(page, FIRST);
    await a.click();
    await page.keyboard.press('End');
    await page.keyboard.type('ABC');
    await expect(a).toHaveValue('旁白第一句。ABC');
    await page.keyboard.press('Control+z');
    await expect(a).toHaveValue('旁白第一句。');
  });

  test('線上版：儲存會下載 script.json，只有文字不同', async ({ page }) => {
    await field(page, FIRST).fill('下載用的第一句。');
    await field(page, 'endings.0.title').fill('新的結局標題');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-editor=save]')]);
    expect(download.suggestedFilename()).toBe('script.json');
    const saved = JSON.parse(await readFile(await download.path(), 'utf8')) as Script;
    expect((saved.scenes[0].lines[0] as { text: string }).text).toBe('下載用的第一句。');
    expect(saved.endings[0].title).toBe('新的結局標題');
    expect(structureOf(saved)).toBe(structureOf(testScript()));
    await expect(page.locator('.editor-status')).toContainText('已下載');
    // 儲存後再改，又變成未儲存
    await field(page, FIRST).fill('再改一次。');
    await expect(page.locator('.editor-status')).toHaveText('有未儲存的變更');
  });

  test('Ctrl+S 儲存、搜尋篩選、關閉後按鍵回到遊戲', async ({ page }) => {
    await field(page, FIRST).fill('快捷鍵。');
    const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
    expect(download.suggestedFilename()).toBe('script.json');
    await page.locator('.editor-filter').fill('鑰匙');
    await expect(page.locator('.editor-field:visible')).not.toHaveCount(0);
    for (const t of await page.locator('.editor-field:visible').allTextContents()) expect(t).toBeTruthy();
    await expect(page.locator(`.editor-field[data-path="${FIRST}"]`)).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(page.locator('.editor')).not.toHaveClass(/open/);
  });

  test('從開發者面板打開', async ({ page }) => {
    await page.click('[data-editor=close]');
    await page.keyboard.press('Backquote');
    await page.click('[data-dev=editor]');
    await expect(page.locator('.editor')).toHaveClass(/open/);
  });
});
