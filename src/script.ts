import {
  ALL_FX,
  isChoice,
  isMemoryReview,
  isText,
  requiredObjects,
  TRANSITION_STYLES,
  type Ending,
  type Script,
  type SpriteFraming,
} from './types';

import { voiceEntries, voiceIdLooksRight } from './voice';

export const ENDING_TARGET = '@ending';

/** 圖片檔依序嘗試的副檔名。 */
export const IMAGE_EXTENSIONS = ['webp', 'png', 'jpg'];

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
  const defaults = script.meta?.settingsDefaults;
  if (defaults) {
    if (defaults.hiddenHints !== undefined && typeof defaults.hiddenHints !== 'boolean') {
      problems.push('meta.settingsDefaults.hiddenHints 必須是 true 或 false');
    }
    if (defaults.memoryReview !== undefined && !['inline', 'page'].includes(defaults.memoryReview)) {
      problems.push('meta.settingsDefaults.memoryReview 必須是 "inline" 或 "page"');
    }
    const vv = defaults.voiceVolume;
    if (vv !== undefined && !(typeof vv === 'number' && vv >= 0 && vv <= 1)) {
      problems.push('meta.settingsDefaults.voiceVolume 必須是 0 到 1 的數字');
    }
  }
  // 呈現設定
  const meta = script.meta ?? ({} as Script['meta']);
  if (meta.transition !== undefined && !TRANSITION_STYLES.includes(meta.transition)) {
    problems.push(`meta.transition 必須是 ${TRANSITION_STYLES.map((t) => `"${t}"`).join('、')} 其中之一`);
  }
  if (meta.objectHighlight !== undefined && !['glow', 'ring'].includes(meta.objectHighlight)) {
    problems.push('meta.objectHighlight 必須是 "glow" 或 "ring"');
  }
  const checkFraming = (where: string, f: SpriteFraming | undefined) => {
    if (!f) return;
    if (f.scale !== undefined && !(typeof f.scale === 'number' && f.scale > 0)) problems.push(`${where}.scale 必須是大於 0 的數字`);
    if (f.y !== undefined && typeof f.y !== 'number') problems.push(`${where}.y 必須是數字`);
  };
  checkFraming('meta.sprite', meta.sprite);
  for (const c of script.characters ?? []) checkFraming(`角色 ${c.id}.sprite`, c.sprite);
  const statNames = Object.keys(script.meta?.stats ?? {});
  for (const n of statNames) {
    if (RESERVED.includes(n)) problems.push(`meta.stats：數值名稱 "${n}" 與條件保留字撞名，條件裡請改用 stats.${n}`);
  }
  const objectIds = new Set(script.scenes.flatMap((s) => (s.objects ?? []).map((o) => o.id)));
  const objectHome = new Map(script.scenes.flatMap((s) => (s.objects ?? []).map((o) => [o.id, { scene: s.id, at: o.appearAt ?? 0 }] as const)));
  const reach = sceneReachability(script);
  // 所有選項會設定的旗標
  const settable = new Set(
    script.scenes.flatMap((s) => s.lines.flatMap((l) => (isChoice(l) ? l.choice.flatMap((o) => o.flags ?? []) : []))),
  );
  /** 檢查一段條件：語法、用到的旗標與物件。 */
  const checkCond = (where: string, cond: string | undefined) => {
    if (cond == null) return;
    try {
      compileCondition(cond, statNames);
    } catch (err) {
      problems.push(`${where}：條件語法錯誤 ${(err as Error).message}`);
      return;
    }
    const refs = conditionRefs(cond);
    for (const f of refs.flags) {
      if (!settable.has(f)) problems.push(`${where}：旗標 "${f}" 沒有任何選項會設定`);
    }
    for (const id of refs.seen) {
      if (!objectIds.has(id)) problems.push(`${where}：seen() 用到不存在的物件 "${id}"`);
    }
  };
  const objectSeen = new Set<string>();
  for (const scene of script.scenes) {
    checkTarget(`${scene.id}.next`, scene.next);
    if (scene.chapter !== undefined && typeof scene.chapter !== 'string') problems.push(`${scene.id}.chapter 必須是文字`);
    (scene.objects ?? []).forEach((obj, j) => {
      const where = `${scene.id}.objects[${j}]`;
      if (!obj.id) problems.push(`${where}：缺少 id`);
      else if (objectSeen.has(obj.id)) problems.push(`${where}：物件 id "${obj.id}" 重複（整份腳本必須唯一）`);
      objectSeen.add(obj.id);
      if (!obj.label) problems.push(`${where}：缺少 label`);
      if (!obj.description) problems.push(`${where}：缺少 description`);
      if (typeof obj.x !== 'number' || typeof obj.y !== 'number') problems.push(`${where}：缺少 x、y`);
      // 座標是背景圖上的位置；背景比畫面寬 1.2 倍，左右各約 8% 平常看不到，最下面是功能列
      if (typeof obj.x === 'number' && (obj.x < 0.1 || obj.x > 0.9)) {
        problems.push(`${where}：x ${obj.x} 太靠背景圖左右邊緣，可能在畫面外（建議 0.1～0.9）`);
      }
      if (typeof obj.y === 'number' && obj.y > 0.92) problems.push(`${where}：y ${obj.y} 太低，會被下方功能列擋住（建議 0.92 以下）`);
      if ((obj.appearAt ?? 0) >= scene.lines.length) problems.push(`${where}：appearAt ${obj.appearAt} 超過本場景的句數`);
      for (const fx of obj.fx ?? []) {
        if (fx !== 'text_blur' && fx !== 'name_fade') problems.push(`${where}：物件說明只支援 text_blur、name_fade，不支援 "${fx}"`);
      }
      if (obj.truthVoice && !obj.truth) problems.push(`${where}：有 truthVoice 但沒有 truth`);
    });
    if (scene.ui?.back === 'wrong_scene') checkTarget(`${scene.id}.backTarget`, scene.backTarget);
    scene.lines.forEach((line, i) => {
      const where = `${scene.id}.lines[${i}]`;
      for (const fx of line.fx ?? []) {
        if (!ALL_FX.includes(fx)) problems.push(`${where}：未知效果 "${fx}"`);
      }
      checkCond(`${where}.if`, line.if);
      if (isChoice(line)) {
        if (line.voice && !line.prompt) problems.push(`${where}：choice 有 voice 但沒有 prompt`);
        if (line.choice.length && line.choice.every((o) => o.if != null)) {
          problems.push(`${where}：所有選項都有 if，可能全部不出現`);
        }
        const free = line.choice.filter((o) => requiredObjects(o).length === 0).length;
        if (free < line.choice.length && free < 2) {
          problems.push(`${where}：有 requires 的 choice 至少要有兩個沒有 requires 的選項（目前 ${free} 個）`);
        }
        line.choice.forEach((opt, j) => {
          checkTarget(`${where}.choice[${j}].goto`, opt.goto);
          checkCond(`${where}.choice[${j}].if`, opt.if);
          const req = requiredObjects(opt);
          for (const id of req) {
            const home = objectHome.get(id);
            if (!home) {
              problems.push(`${where}.choice[${j}].requires：物件 "${id}" 不存在`);
            } else if (home.scene === scene.id ? home.at >= i : !reach.get(home.scene)?.has(scene.id)) {
              problems.push(`${where}.choice[${j}].requires：物件 "${id}" 在這個選項之後才出現，玩家不可能先點到`);
            }
          }
          if (req.length && !(opt.flags ?? []).some((f) => f.startsWith('hidden_'))) {
            problems.push(`${where}.choice[${j}]：隱藏選項要設一個 hidden_ 開頭的旗標`);
          }
          if (line.mode === 'hotspot' && (opt.x == null || opt.y == null)) {
            problems.push(`${where}.choice[${j}]：hotspot 模式需要 x、y`);
          }
        });
      } else if (isMemoryReview(line)) {
        if (!scene.id.startsWith('end_')) problems.push(`${where}：memoryReview 只能放在 end_ 開頭的結局場景`);
        if (scene.lines.indexOf(line) !== scene.lines.findIndex(isMemoryReview)) {
          problems.push(`${where}：同一個結局只能有一行 memoryReview`);
        }
        const speaker = line.memoryReview.speaker;
        if (!['narrator', 'player'].includes(speaker) && !charIds.has(speaker)) {
          problems.push(`${where}.memoryReview：未知 speaker "${speaker}"`);
        }
      } else if (line.music !== undefined && line.music !== null && typeof line.music !== 'string') {
        problems.push(`${where}.music：必須是曲名字串或 null`);
      } else if (!['narrator', 'player'].includes(line.speaker) && !charIds.has(line.speaker)) {
        problems.push(`${where}：未知 speaker "${line.speaker}"`);
      } else if (line.expression != null) {
        const list = (script.characters ?? []).find((c) => c.id === line.speaker)?.expressions;
        if (list && !list.includes(line.expression)) {
          problems.push(`${where}：表情 "${line.expression}" 不在角色 ${line.speaker} 的 expressions 清單裡`);
        }
      }
    });
  }
  // 配音（v3）：編號不可重複；格式不對只是警告。缺音檔不是錯誤，這裡不讀檔。
  const speakers = new Set(['narrator', 'player', ...charIds]);
  const voiceAt = new Map<string, string>();
  for (const v of voiceEntries(script)) {
    const first = voiceAt.get(v.id);
    if (first) problems.push(`${v.where}：配音編號 "${v.id}" 重複（${first} 也用了）`);
    else voiceAt.set(v.id, v.where);
    if (!voiceIdLooksRight(v, speakers)) {
      const expect = v.kind === 'truth' ? `mr_${v.objectId}_{speaker}` : `${v.scene}_{兩位序號}_${v.kind === 'line' ? v.speaker : '{speaker}'}`;
      problems.push(`（警告）${v.where}：配音編號 "${v.id}" 不符合 ${expect} 的格式`);
    }
  }
  for (const e of script.endings ?? []) {
    if (!sceneIds.has(e.scene)) problems.push(`結局 ${e.id}：找不到場景 "${e.scene}"`);
    checkCond(`結局 ${e.id}.condition`, e.condition);
  }
  return problems;
}

type CondFn = (...args: unknown[]) => unknown;
const condCache = new Map<string, CondFn>();
/** 條件裡固定可用的名稱；數值名稱與這些撞名時，以這些為準。 */
const RESERVED = ['flags', 'stats', 'has', 'seen'];

/** 條件判定需要的遊戲狀態。 */
export interface CondContext {
  stats: Record<string, number>;
  flags: readonly string[];
  /** 點過的物件 id。 */
  seen?: readonly string[];
}

function statParams(statNames: string[]): string[] {
  return statNames.filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && !RESERVED.includes(n));
}

export function compileCondition(cond: string, statNames: string[]): CondFn {
  const params = statParams(statNames);
  const key = params.join(',') + '|' + cond;
  let fn = condCache.get(key);
  if (!fn) {
    // 條件來自腳本作者本人，等同程式碼；以數值名稱、flags、stats、has()、seen() 當參數。
    fn = new Function(...params, ...RESERVED, `"use strict"; return (${cond.trim() || 'true'});`) as CondFn;
    condCache.set(key, fn);
  }
  return fn;
}

/** 判定 if／condition。語法或執行錯誤時視為不成立。 */
export function evalCondition(cond: string | undefined, ctx: CondContext): boolean {
  if (cond == null || cond.trim() === '') return true;
  const names = statParams(Object.keys(ctx.stats));
  const flags = [...ctx.flags];
  const seen = [...(ctx.seen ?? [])];
  try {
    const fn = compileCondition(cond, names);
    return Boolean(
      fn(
        ...names.map((n) => ctx.stats[n]),
        flags,
        { ...ctx.stats },
        (f: string) => flags.includes(f),
        (id: string) => seen.includes(id),
      ),
    );
  } catch (err) {
    console.warn('[script] 條件執行失敗', cond, err);
    return false;
  }
}

/** 依序判定 endings，第一個成立者勝出；都不成立時取最後一條（fallback）。 */
export function pickEnding(script: Script, ctx: CondContext): Ending | null {
  const endings = script.endings ?? [];
  for (const e of endings) {
    if (evalCondition(e.condition, ctx)) return e;
  }
  return endings[endings.length - 1] ?? null;
}

/** 從條件字串裡找出 has("x")、flags.includes("x")、seen("x") 用到的名稱。 */
export function conditionRefs(cond: string): { flags: string[]; seen: string[] } {
  const grab = (re: RegExp) => [...cond.matchAll(re)].map((m) => m[2]);
  return {
    flags: [...grab(/\bhas\(\s*(["'`])(.*?)\1\s*\)/g), ...grab(/\bflags\.includes\(\s*(["'`])(.*?)\1\s*\)/g)],
    seen: grab(/\bseen\(\s*(["'`])(.*?)\1\s*\)/g),
  };
}

/**
 * 場景之間的可達關係：from → 從 from 出發（不含 from 本身，除非繞得回來）能走到的場景。
 * 依 next、選項的 goto 計算；"@ending" 視為可以走到所有結局場景。
 */
export function sceneReachability(script: Script): Map<string, Set<string>> {
  const endingScenes = (script.endings ?? []).map((e) => e.scene);
  const edges = new Map<string, string[]>();
  const expand = (t: string | null | undefined) => (t == null || t === ENDING_TARGET ? endingScenes : [t]);
  for (const scene of script.scenes) {
    const out = new Set<string>();
    if (!scene.id.startsWith('end_')) for (const t of expand(scene.next)) out.add(t);
    for (const line of scene.lines) {
      if (!isChoice(line)) continue;
      for (const o of line.choice) if (o.goto) for (const t of expand(o.goto)) out.add(t);
    }
    edges.set(scene.id, [...out]);
  }
  const result = new Map<string, Set<string>>();
  for (const scene of script.scenes) {
    const seen = new Set<string>();
    const stack = [...(edges.get(scene.id) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(edges.get(id) ?? []));
    }
    result.set(scene.id, seen);
  }
  return result;
}

/**
 * 每個角色需要的立繪：有 expressions 清單就用清單，沒有就收集台詞裡實際用到的 expression
 * （角色第一句沒寫表情時用 neutral，所以 neutral 一律算進去）。
 */
export function neededSprites(script: Script): { charId: string; expression: string }[] {
  const out: { charId: string; expression: string }[] = [];
  for (const c of script.characters ?? []) {
    const used = new Set<string>(c.expressions ?? ['neutral']);
    if (!c.expressions) {
      for (const s of script.scenes) for (const l of s.lines) if (isText(l) && l.speaker === c.id && l.expression) used.add(l.expression);
    }
    for (const expression of used) out.push({ charId: c.id, expression });
  }
  return out;
}

/**
 * 立繪檢查（警告，不是錯誤）：需要的表情還沒有立繪檔。
 * exists 由呼叫端提供（瀏覽器用載入圖片、Node 用讀檔），回傳該路徑的檔案是否存在。
 */
export async function spriteWarnings(script: Script, exists: (path: string) => Promise<boolean>): Promise<string[]> {
  const warnings: string[] = [];
  for (const { charId, expression } of neededSprites(script)) {
    const base = `assets/char/${charId}_${expression}`;
    let found = false;
    for (const ext of IMAGE_EXTENSIONS) if (!found && (await exists(`${base}.${ext}`))) found = true;
    if (!found) {
      warnings.push(expression === 'neutral' ? `找不到 ${base}（.webp／.png／.jpg，會用佔位圖）` : `找不到 ${base}（.webp／.png／.jpg，會改用 ${charId}_neutral 或佔位圖）`);
    }
  }
  return warnings;
}
