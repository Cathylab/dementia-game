import { expect, test, type Page } from '@playwright/test';
import { neededSprites, spriteWarnings, validateScript } from '../src/script';
import { advance, currentText, jumpTo, openWithTestScript, testScript } from './helpers';

// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const serve = (page: Page, name: string) => page.route(`**/assets/char/${name}.png`, (r) => r.fulfill({ contentType: 'image/png', body: PNG }));

test.describe('立繪表情', () => {
  test('expression 決定表情；省略時沿用上一句', async ({ page }) => {
    await openWithTestScript(page);
    await jumpTo(page, 'expr_scene');
    const sprite = page.locator('.sprite');
    await expect(currentText(page)).toHaveText('表情微笑。');
    await expect(sprite).toHaveAttribute('data-expression', 'smile');
    await advance(page);
    await expect(currentText(page)).toHaveText('沿用上一句。');
    await expect(sprite).toHaveAttribute('data-expression', 'smile');
    await advance(page);
    await expect(sprite).toHaveAttribute('data-expression', 'holding');
  });

  test('有該表情的檔案就用它', async ({ page }) => {
    await serve(page, 'amin_smile');
    await serve(page, 'amin_neutral');
    await openWithTestScript(page);
    await jumpTo(page, 'expr_scene');
    await expect(page.locator('.sprite')).toHaveAttribute('src', /amin_smile\.png$/);
  });

  test('表情檔不存在：改用 {id}_neutral.png', async ({ page }) => {
    await serve(page, 'amin_neutral');
    await openWithTestScript(page);
    await jumpTo(page, 'expr_scene');
    await expect(page.locator('.sprite')).toHaveAttribute('src', /amin_neutral\.png$/);
  });

  test('neutral 也不存在：佔位圖', async ({ page }) => {
    await openWithTestScript(page);
    await jumpTo(page, 'expr_scene');
    await expect(page.locator('.sprite')).toHaveAttribute('src', /^data:image\/png/);
  });
});

test.describe('腳本檢查：expressions', () => {
  test('表情不在角色的 expressions 清單裡是錯誤', () => {
    const s = testScript();
    s.scenes.find((x) => x.id === 'expr_scene')!.lines.push({ speaker: 'amin', expression: 'smlie', text: 'x' });
    expect(validateScript(s).join('\n')).toContain('表情 "smlie" 不在角色 amin 的 expressions 清單裡');
  });

  test('沒有列 expressions 的角色不檢查（舊腳本照常）', () => {
    const s = testScript();
    delete s.characters[0].expressions;
    s.scenes.find((x) => x.id === 'expr_scene')!.lines.push({ speaker: 'amin', expression: 'anything', text: 'x' });
    expect(validateScript(s)).toEqual([]);
  });

  test('需要的立繪：有清單用清單，沒有清單就收集台詞用到的表情（含 neutral）', () => {
    const listed = neededSprites(testScript()).map((x) => x.expression);
    expect(listed).toEqual(['neutral', 'smile', 'sad', 'worried', 'holding']);
    const s = testScript();
    delete s.characters[0].expressions;
    const used = neededSprites(s).map((x) => x.expression);
    expect(used).toEqual(expect.arrayContaining(['neutral', 'smile', 'holding']));
    expect(used).not.toContain('worried');
  });

  test('缺立繪只列為警告', async () => {
    const have = new Set(['assets/char/amin_neutral.png', 'assets/char/amin_smile.webp', 'assets/char/amin_sad.jpg']);
    const warnings = await spriteWarnings(testScript(), async (p) => have.has(p));
    expect(warnings).toHaveLength(2);
    expect(warnings.join('\n')).toContain('amin_worried');
    expect(warnings.join('\n')).toContain('amin_holding');
  });
});
