import { ALL_FX, isChoice, type Ending, type Script } from './types';

export const ENDING_TARGET = '@ending';

export async function loadScript(url: string): Promise<Script> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`無法載入腳本 ${url}（HTTP ${res.status}）`);
  const script = (await res.json()) as Script;
  const problems = validateScript(script);
  for (const p of problems) console.warn('[script]', p);
  return script;
}

/** 檢查腳本常見錯誤，回傳問題清單（不丟例外，盡量讓遊戲照樣能跑）。 */
export function validateScript(script: Script): string[] {
  const problems: string[] = [];
  if (!script.meta?.title) problems.push('meta.title 缺少');
  if (!Array.isArray(script.scenes) || script.scenes.length === 0) {
    problems.push('scenes 為空');
    return problems;
  }
  const sceneIds = new Set(script.scenes.map((s) => s.id));
  const charIds = new Set((script.characters ?? []).map((c) => c.id));
  const checkTarget = (where: string, target: string | null | undefined) => {
    if (target == null || target === ENDING_TARGET) return;
    if (!sceneIds.has(target)) problems.push(`${where}：找不到場景 "${target}"`);
  };
  for (const scene of script.scenes) {
    checkTarget(`${scene.id}.next`, scene.next);
    if (scene.ui?.back === 'wrong_scene') checkTarget(`${scene.id}.backTarget`, scene.backTarget);
    scene.lines.forEach((line, i) => {
      const where = `${scene.id}.lines[${i}]`;
      for (const fx of line.fx ?? []) {
        if (!ALL_FX.includes(fx)) problems.push(`${where}：未知效果 "${fx}"`);
      }
      if (isChoice(line)) {
        line.choice.forEach((opt, j) => {
          checkTarget(`${where}.choice[${j}].goto`, opt.goto);
          if (line.mode === 'hotspot' && (opt.x == null || opt.y == null)) {
            problems.push(`${where}.choice[${j}]：hotspot 模式需要 x、y`);
          }
        });
      } else if (!['narrator', 'player'].includes(line.speaker) && !charIds.has(line.speaker)) {
        problems.push(`${where}：未知 speaker "${line.speaker}"`);
      }
    });
  }
  for (const e of script.endings ?? []) {
    if (!sceneIds.has(e.scene)) problems.push(`結局 ${e.id}：找不到場景 "${e.scene}"`);
    try {
      compileCondition(e.condition, Object.keys(script.meta.stats ?? {}));
    } catch (err) {
      problems.push(`結局 ${e.id}：條件語法錯誤 ${(err as Error).message}`);
    }
  }
  return problems;
}

type CondFn = (...args: unknown[]) => unknown;
const condCache = new Map<string, CondFn>();

function compileCondition(cond: string, statNames: string[]): CondFn {
  const key = statNames.join(',') + '|' + cond;
  let fn = condCache.get(key);
  if (!fn) {
    // 條件來自腳本作者本人，等同程式碼；以數值名稱與 flags 當參數。
    fn = new Function(...statNames, 'flags', 'stats', `"use strict"; return (${cond || 'true'});`) as CondFn;
    condCache.set(key, fn);
  }
  return fn;
}

export function evalCondition(cond: string, stats: Record<string, number>, flags: string[]): boolean {
  const names = Object.keys(stats);
  try {
    const fn = compileCondition(cond, names);
    return Boolean(fn(...names.map((n) => stats[n]), [...flags], { ...stats }));
  } catch (err) {
    console.warn('[script] 結局條件執行失敗', cond, err);
    return false;
  }
}

/** 依序判定 endings，第一個成立者勝出；都不成立時取最後一條（fallback）。 */
export function pickEnding(script: Script, stats: Record<string, number>, flags: string[]): Ending | null {
  const endings = script.endings ?? [];
  for (const e of endings) {
    if (evalCondition(e.condition, stats, flags)) return e;
  }
  return endings[endings.length - 1] ?? null;
}
