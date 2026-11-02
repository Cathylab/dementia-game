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

test.describe('腳本檢查：objects', () => {
  const obj = { id: 'a1_phone', label: '手機', x: 0.5, y: 0.4, description: '說明' };

  test('合法的物件沒有問題，seen() 找得到', () => {
    const s = make([{ objects: [obj], lines: [{ speaker: 'narrator', text: 'x', if: 'seen("a1_phone")' }] }]);
    expect(validateScript(s)).toEqual([]);
  });

  test('物件 id 重複（跨場景也算）', () => {
    const s = make([
      { objects: [obj], lines: [{ speaker: 'narrator', text: 'x' }] },
      { objects: [obj], lines: [{ speaker: 'narrator', text: 'y' }] },
    ]);
    expect(validateScript(s).join()).toContain('物件 id "a1_phone" 重複');
  });

  test('缺少必填欄位、不支援的效果、位置太低、appearAt 超過句數', () => {
    const bad = { id: 'x', x: 0.5, y: 0.9, appearAt: 5, fx: ['look_around'] } as unknown as typeof obj;
    const problems = validateScript(make([{ objects: [bad], lines: [{ speaker: 'narrator', text: 'x' }] }])).join('\n');
    expect(problems).toContain('缺少 label');
    expect(problems).toContain('缺少 description');
    expect(problems).toContain('只支援 text_blur、name_fade');
    expect(problems).toContain('太低');
    expect(problems).toContain('appearAt 5 超過');
  });
});

test.describe('腳本檢查：requires', () => {
  const obj = { id: 'a1_key', label: '鑰匙', x: 0.5, y: 0.4, description: '說明' };
  const choice = (requires: string | string[], free = 2) => ({
    choice: [
      ...Array.from({ length: free }, (_, i) => ({ text: `普通${i}` })),
      { text: '隱藏', requires, flags: ['hidden_key'] },
    ],
  });

  test('合法的隱藏選項沒有問題', () => {
    const s = make([{ objects: [obj], lines: [{ speaker: 'narrator', text: 'x' }, choice('a1_key')] }]);
    expect(validateScript(s)).toEqual([]);
  });

  test('requires 指向不存在的物件', () => {
    const s = make([{ lines: [{ speaker: 'narrator', text: 'x' }, choice(['ghost'])] }]);
    expect(validateScript(s).join()).toContain('物件 "ghost" 不存在');
  });

  test('requires 的物件在之後的場景才出現', () => {
    const s = make([
      { lines: [choice('a1_key')], next: 's1' },
      { objects: [obj], lines: [{ speaker: 'narrator', text: 'x' }] },
    ]);
    expect(validateScript(s).join()).toContain('玩家不可能先點到');
  });

  test('同一場景裡，物件在選項之後才出現', () => {
    const late = { ...obj, appearAt: 1 };
    const s = make([{ objects: [late], lines: [choice('a1_key'), { speaker: 'narrator', text: 'x' }] }]);
    expect(validateScript(s).join()).toContain('玩家不可能先點到');
  });

  test('沒有 requires 的選項少於兩個', () => {
    const s = make([{ objects: [obj], lines: [{ speaker: 'narrator', text: 'x' }, choice('a1_key', 1)] }]);
    expect(validateScript(s).join()).toContain('至少要有兩個沒有 requires 的選項');
  });

  test('隱藏選項沒有 hidden_ 旗標', () => {
    const line = { choice: [{ text: 'a' }, { text: 'b' }, { text: 'c', requires: 'a1_key' }] };
    const s = make([{ objects: [obj], lines: [{ speaker: 'narrator', text: 'x' }, line] }]);
    expect(validateScript(s).join()).toContain('hidden_ 開頭的旗標');
  });
});

test.describe('腳本檢查：settingsDefaults', () => {
  test('值的型別錯誤', () => {
    const s = make([], { meta: { title: 't', stats: {}, settingsDefaults: { hiddenHints: 'yes', memoryReview: 'popup' } as never } });
    const problems = validateScript(s).join('\n');
    expect(problems).toContain('hiddenHints 必須是 true 或 false');
    expect(problems).toContain('memoryReview 必須是 "inline" 或 "page"');
  });
});
