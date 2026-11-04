// 階段二 B-2 專家審閱：審閱用劇本（純文字）＋簽核清單（題材包的 review.md）。
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { reviewFileName, reviewText } from '../src/reviewdoc';
import type { Script } from '../src/types';
import { openWithTestScript, testScript } from './helpers';

test('審閱用劇本：簽核清單、人物、每個場景的台詞與選項、物件、結局、意見欄', () => {
  const s = testScript();
  const text = reviewText(s, '# 清單\n- [ ] 第一項\n- 第二項', new Date(2026, 10, 4));
  expect(text).toContain('《測試腳本》審閱用劇本');
  expect(text).toContain('產生日期：2026/11/4');
  expect(text).toContain('□ 第一項');
  expect(text).toContain('□ 第二項');
  expect(text).toContain('阿明哥（鄰居）：戴著藍色帽子');
  expect(text).toMatch(/1\. 旁白：旁白第一句。/);
  expect(text).toContain('〈可以點的東西〉手機：女兒傳來新做的指甲。');
  expect(text).toContain('□ 可以發佈');
  expect(text.match(/意見：/g)!.length).toBeGreaterThan(s.scenes.length);
  expect(reviewFileName(s)).toBe('測試腳本-審閱用.txt');
});

test('沒有清單時用通用的幾項', () => {
  expect(reviewText(testScript())).toContain('□ 症狀與情境的描寫正確');
});

test('正式腳本：每一句台詞都在審閱文件裡', () => {
  const demo = JSON.parse(readFileSync(new URL('../examples/寫給未來的我/script.json', import.meta.url), 'utf8')) as Script;
  const text = reviewText(demo, readFileSync(new URL('../packs/dementia/review.md', import.meta.url), 'utf8'));
  for (const sc of demo.scenes) for (const l of sc.lines) if ('text' in l && typeof l.text === 'string') expect(text).toContain(l.text);
  expect(text).toContain('□ 症狀的描寫符合失智症的實際表現');
});

test('開發者面板：下載審閱用劇本（含題材包的簽核清單）', async ({ page }) => {
  await openWithTestScript(page);
  await page.keyboard.press('Backquote');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-dev=review-download]')]);
  expect(download.suggestedFilename()).toBe('測試腳本-審閱用.txt');
  const text = await readFile(await download.path(), 'utf8');
  expect(text).toContain('簽核清單');
  expect(text).toContain('□ 症狀的描寫符合失智症的實際表現');
});
