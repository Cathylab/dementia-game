import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { validateScript } from '../src/script';
import { ALL_FX, isChoice, type Script } from '../src/types';
import { reachableEndings } from './simulate';

const demo = JSON.parse(readFileSync(new URL('../public/script.json', import.meta.url), 'utf8')) as Script;

test.describe('腳本檢查（任何腳本都適用）', () => {
  test('public/script.json 通過格式檢查', () => {
    expect(validateScript(demo)).toEqual([]);
  });

  test('每一個結局都有可走到的路線', () => {
    const reached = reachableEndings(demo);
    for (const e of demo.endings) expect(reached.has(e.id), `結局 ${e.id} 走不到`).toBe(true);
  });

  test('測試用腳本也通過格式檢查', () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/test-script.json', import.meta.url), 'utf8')) as Script;
    expect(validateScript(fixture)).toEqual([]);
  });
});

// 示範腳本的規格要求。之後換掉正式腳本時，這一組可以整個刪掉。
test.describe('示範腳本規格', () => {
  const lines = demo.scenes.flatMap((s) => s.lines);
  const choices = lines.filter(isChoice);

  test('用到全部十一個效果標籤', () => {
    const used = new Set(lines.flatMap((l) => l.fx ?? []));
    expect([...used].sort()).toEqual([...ALL_FX].sort());
  });

  test('三幕各至少兩個場景（不含結局）', () => {
    for (const act of [1, 2, 3]) {
      const n = demo.scenes.filter((s) => s.act === act && !s.id.startsWith('end_')).length;
      expect(n, `第 ${act} 幕`).toBeGreaterThanOrEqual(2);
    }
  });

  test('至少三個選擇點，至少一個是 hotspot', () => {
    expect(choices.length).toBeGreaterThanOrEqual(3);
    expect(choices.some((c) => c.mode === 'hotspot')).toBe(true);
  });

  test('至少一個場景有 ui 覆寫、至少一個場景有 foreground', () => {
    expect(demo.scenes.some((s) => s.ui && Object.keys(s.ui).length > 0)).toBe(true);
    expect(demo.scenes.some((s) => !!s.foreground)).toBe(true);
  });

  test('三個結局都可達', () => {
    expect(demo.endings).toHaveLength(3);
    expect(reachableEndings(demo).size).toBe(3);
  });
});
