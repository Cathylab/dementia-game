// 題材包（需求書 5.6）：pack.json 格式、效果開關、退化曲線、切換、腳本檢查。
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { degradationForAct, LEGACY_PACK, normalizePack, packIdOf, PLAIN_PACK, type Pack } from '../src/pack';
import { validateScript } from '../src/script';
import { jumpTo, openWithTestScript, testScript } from './helpers';

const readPack = async (id: string) => JSON.parse(await readFile(new URL(`../packs/${id}/pack.json`, import.meta.url), 'utf8')) as unknown;
const pack = (page: Page) => page.evaluate(() => (window as unknown as { __vn: { pack: Pack } }).__vn.pack);
const degradation = (page: Page) => page.evaluate(() => (window as unknown as { __vn: { engine: { degradation: number } } }).__vn.engine.degradation);

test.describe('格式', () => {
  test('失智症包和舊行為完全一樣（全部效果、0 → 0.5 → 1）', async () => {
    const problems: string[] = [];
    const dementia = normalizePack(await readPack('dementia'), 'dementia', problems);
    expect(problems).toEqual([]);
    expect([...dementia.effects].sort()).toEqual([...LEGACY_PACK.effects].sort());
    expect(dementia.degradation).toEqual(LEGACY_PACK.degradation);
    expect(dementia.texts).toEqual(LEGACY_PACK.texts);
    expect([1, 2, 3, 4, 7].map((a) => degradationForAct(dementia, a))).toEqual([0, 0.5, 1, 1, 1]);
  });

  test('一般故事包：沒有效果、沒有退化', async () => {
    const plain = normalizePack(await readPack('plain'), 'plain');
    expect(plain.effects).toEqual([]);
    expect([1, 3, 9].map((a) => degradationForAct(plain, a))).toEqual([0, 0, 0]);
  });

  test('pack.json 寫錯的欄位用預設值並提醒', () => {
    const problems: string[] = [];
    const p = normalizePack({ effects: ['muffle', 'teleport'], degradation: 'high' }, 'odd', problems);
    expect(p.name).toBe('odd');
    expect(p.effects).toEqual(['muffle']);
    expect(p.degradation).toEqual([0]);
    expect(p.texts.forgottenPerson).toBe('那個人');
    expect(problems.join('\n')).toMatch(/teleport/);
    expect(problems.join('\n')).toMatch(/degradation/);
  });

  test('meta.pack：省略＝dementia（相容舊腳本）、null＝plain', () => {
    const s = testScript();
    expect(packIdOf(s)).toBe('dementia');
    s.meta.pack = null;
    expect(packIdOf(s)).toBe('plain');
    s.meta.pack = 'hearing';
    expect(packIdOf(s)).toBe('hearing');
  });

  test('腳本檢查：用了題材包沒啟用的效果時提醒（警告，不擋）', () => {
    const s = testScript();
    expect(validateScript(s, LEGACY_PACK).filter((p) => p.includes('題材包'))).toEqual([]);
    const warnings = validateScript(s, PLAIN_PACK).filter((p) => p.includes('題材包'));
    expect(warnings.length).toBeGreaterThan(5);
    expect(warnings.every((w) => w.startsWith('（警告）'))).toBe(true);
    expect(warnings.some((w) => w.includes('name_fade') && w.includes('fx_name.lines[0]'))).toBe(true);
  });
});

test.describe('遊戲裡', () => {
  test('Demo 用失智症包；第二幕退化係數 0.5', async ({ page }) => {
    await page.goto('./play.html?timescale=0.2');
    await expect(page.locator('.title-screen h1')).toHaveText('寫給未來的我');
    expect((await pack(page)).id).toBe('dementia');
    await page.click('.start-button');
    await expect(page.locator('#stage')).toHaveAttribute('data-scene', 'a1_s01', { timeout: 15_000 });
    await jumpTo(page, 'a2_s06');
    expect(await degradation(page)).toBe(0.5);
  });

  test('一般故事包：效果不出現、沒有退化', async ({ page }) => {
    await openWithTestScript(page, 'timescale=0.2', { mutate: (s) => (s.meta.pack = 'plain') });
    expect((await pack(page)).id).toBe('plain');
    await page.click('.start-button');
    await jumpTo(page, 'fx_desat');
    await page.waitForTimeout(600);
    await expect(page.locator('#stage')).not.toHaveClass(/fx-desaturate/);
    await jumpTo(page, 'act3');
    expect(await degradation(page)).toBe(0);
  });

  test('不存在的題材包：改用一般故事，遊戲照常', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (m) => m.type() === 'warning' && warnings.push(m.text()));
    await openWithTestScript(page, 'timescale=0.2', { mutate: (s) => (s.meta.pack = 'no_such_pack') });
    expect((await pack(page)).id).toBe('plain');
    expect(warnings.some((w) => w.includes('no_such_pack'))).toBe(true);
  });

  test('開發者面板切換題材包：立即生效，存檔時寫進 meta.pack', async ({ page }) => {
    await openWithTestScript(page);
    await page.click('.start-button');
    await jumpTo(page, 'act3');
    expect(await degradation(page)).toBe(1);
    await page.keyboard.press('Backquote');
    await expect(page.locator('select[name=dev-pack] option')).toHaveCount(2);
    await page.selectOption('select[name=dev-pack]', 'plain');
    await expect(page.locator('[data-dev=pack-note]')).toContainText('啟用 0 種效果');
    expect(await degradation(page)).toBe(0);
    const meta = await page.evaluate(() => (window as unknown as { __vn: { engine: { script: { meta: { pack?: string } } } } }).__vn.engine.script.meta);
    expect(meta.pack).toBe('plain');
    // 切換後的腳本檢查會提醒哪些效果不會出現
    await page.keyboard.press('Backquote');
    await page.keyboard.press('Backquote');
  });

  test('建置產生 packs.json', async ({ request }) => {
    const list = (await (await request.get('./packs.json')).json()) as { id: string; name: string }[];
    expect(list.map((p) => p.id).sort()).toEqual(['dementia', 'plain']);
  });
});
