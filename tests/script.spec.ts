import { readFileSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { spriteWarnings, validateScript } from '../src/script';
import type { Script } from '../src/types';
import { reachableEndings } from './simulate';

const demo = JSON.parse(readFileSync(new URL('../examples/寫給未來的我/script.json', import.meta.url), 'utf8')) as Script;

test.describe('腳本檢查（任何腳本都適用）', () => {
  test('examples/寫給未來的我/script.json 通過格式檢查', () => {
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

test('立繪檢查：缺圖時只提醒、不算失敗', async () => {
  const exists = (p: string) => access(new URL(`../examples/寫給未來的我/${p}`, import.meta.url)).then(() => true, () => false);
  const warnings = await spriteWarnings(demo, exists);
  for (const w of warnings) test.info().annotations.push({ type: 'warning', description: w });
  if (warnings.length) console.log(`立繪檢查：${warnings.length} 個警告\n${warnings.join('\n')}`);
});

