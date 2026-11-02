import { expect, test, type Page } from '@playwright/test';
import { spriteWarnings, validateScript } from '../src/script';
import { advance, currentText, jumpTo, openWithTestScript, testScript } from './helpers';

// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const serve = (page: Page, name: string) => page.route(`**/assets/char/${name}.png`, (r) => r.fulfill({ contentType: 'image/png', body: PNG }));

test.describe('語氣 tone → 表情', () => {
  test('tone 查 tones；expression 優先；都沒寫就沿用上一句', async ({ page }) => {
    await openWithTestScript(page);
    await jumpTo(page, 'tone_scene');
    const sprite = page.locator('.sprite');
    await expect(currentText(page)).toHaveText('語氣開心。');
    await expect(sprite).toHaveAttribute('data-expression', 'smile');
    await advance(page);
    await expect(sprite).toHaveAttribute('data-expression', 'sad');
    await advance(page);
    await expect(currentText(page)).toHaveText('沿用上一句。');
    await expect(sprite).toHaveAttribute('data-expression', 'sad');
    await advance(page);
    await expect(sprite).toHaveAttribute('data-expression', 'holding');
  });

  test('有該表情的檔案就用它', async ({ page }) => {
    await serve(page, 'amin_smile');
    await serve(page, 'amin_neutral');
    await openWithTestScript(page);
    await jumpTo(page, 'tone_scene');
    await expect(page.locator('.sprite')).toHaveAttribute('src', /amin_smile\.png$/);
  });

  test('表情檔不存在：改用 {id}_neutral.png', async ({ page }) => {
    await serve(page, 'amin_neutral');
    await openWithTestScript(page);
    await jumpTo(page, 'tone_scene');
    await expect(page.locator('.sprite')).toHaveAttribute('src', /amin_neutral\.png$/);
  });

  test('neutral 也不存在：佔位圖', async ({ page }) => {
    await openWithTestScript(page);
    await jumpTo(page, 'tone_scene');
    await expect(page.locator('.sprite')).toHaveAttribute('src', /^data:image\/png/);
  });
});

test.describe('腳本檢查：tone', () => {
  test('測試腳本的 tone 都合法', () => {
    expect(validateScript(testScript())).toEqual([]);
  });

  test('tone 不在該角色的 tones 裡、或用在旁白上', () => {
    const s = testScript();
    const lines = s.scenes.find((x) => x.id === 'tone_scene')!.lines;
    lines.push({ speaker: 'amin', tone: '生氣', text: 'x' }, { speaker: 'narrator', tone: '開心', text: 'y' });
    const problems = validateScript(s).join('\n');
    expect(problems).toContain('角色 amin 的 tones 裡沒有語氣 "生氣"');
    expect(problems).toContain('tone 只能用在角色台詞');
  });

  test('tones 指到的表情沒有立繪：列為警告', async () => {
    const have = new Set(['assets/char/amin_neutral.png', 'assets/char/amin_smile.png']);
    const warnings = await spriteWarnings(testScript(), async (p) => have.has(p));
    expect(warnings).toHaveLength(2);
    expect(warnings.join('\n')).toContain('amin_worried.png');
    expect(warnings.join('\n')).toContain('amin_holding.png');
  });
});
