// validateScript 的 v2 檢查規則（每條規則一個最小腳本）。
import { expect, test } from '@playwright/test';
import { evalCondition, validateScript } from '../src/script';
import type { Line, Scene, Script } from '../src/types';

function make(scenes: Partial<Scene>[], extra: Partial<Script> = {}): Script {
  return {
    meta: { title: 't', stats: { trust: 0, lucidity: 0 } },
    characters: [],
    endings: [{ id: 'e', title: 'e', condition: 'true', scene: 'end_a' }],
    ...extra,
    scenes: [
      ...scenes.map((s, i) => ({ id: `s${i}`, lines: [] as Line[], ...s })),
      { id: 'end_a', lines: [{ speaker: 'narrator', text: '完' }] },
    ] as Scene[],
  };
}

const setsFlag: Partial<Scene> = {
  lines: [{ choice: [{ text: 'a', flags: ['known'] }, { text: 'b' }] }],
};

test.describe('腳本檢查：if、has、seen', () => {
  test('合法的條件沒有問題', () => {
    const s = make([setsFlag, { lines: [{ speaker: 'narrator', text: 'x', if: 'has("known") && trust > 0' }] }]);
    expect(validateScript(s)).toEqual([]);
  });

  test('if 語法錯誤', () => {
    const s = make([{ lines: [{ speaker: 'narrator', text: 'x', if: 'trust >' }] }]);
    expect(validateScript(s).join()).toContain('條件語法錯誤');
  });

  test('has() 用到沒有任何選項會設定的旗標', () => {
    const s = make([setsFlag, { lines: [{ speaker: 'narrator', text: 'x', if: 'has("nobody_sets_this")' }] }]);
    expect(validateScript(s).join()).toContain('旗標 "nobody_sets_this" 沒有任何選項會設定');
  });

  test('結局條件也會檢查 has()', () => {
    const s = make([setsFlag], { endings: [{ id: 'e', title: 'e', condition: 'has("ghost")', scene: 'end_a' }] });
    expect(validateScript(s).join()).toContain('"ghost"');
  });

  test('seen() 用到不存在的物件', () => {
    const s = make([{ lines: [{ speaker: 'narrator', text: 'x', if: 'seen("nothing")' }] }]);
    expect(validateScript(s).join()).toContain('seen() 用到不存在的物件 "nothing"');
  });

  test('一組 choice 的所有選項都有 if', () => {
    const s = make([{ lines: [{ choice: [{ text: 'a', if: 'trust > 0' }, { text: 'b', if: 'trust < 0' }] }] }]);
    expect(validateScript(s).join()).toContain('所有選項都有 if');
  });

  test('數值名稱與保留字撞名', () => {
    const s = make([], { meta: { title: 't', stats: { seen: 0 } } });
    expect(validateScript(s).join()).toContain('保留字');
  });
});

test.describe('條件判定', () => {
  const ctx = { stats: { trust: 2, lucidity: -1 }, flags: ['a'], seen: ['phone'] };
  test('數值、has、seen、flags 都能用', () => {
    expect(evalCondition('trust >= 2 && lucidity < 0', ctx)).toBe(true);
    expect(evalCondition('has("a") && !has("b")', ctx)).toBe(true);
    expect(evalCondition('seen("phone") && !seen("cup")', ctx)).toBe(true);
    expect(evalCondition('flags.includes("a")', ctx)).toBe(true);
  });
  test('省略或空字串視為成立；錯誤視為不成立', () => {
    expect(evalCondition(undefined, ctx)).toBe(true);
    expect(evalCondition('', ctx)).toBe(true);
    expect(evalCondition('nope()', ctx)).toBe(false);
  });
});
