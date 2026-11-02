// 在 Node 端模擬所有遊玩組合，找出可以抵達的結局（不經過瀏覽器）。
// 組合包含：每個選項、每個可以點的物件點或不點。相同狀態只走一次；
// 狀態太多時改成隨機抽樣。
import { ENDING_TARGET, evalCondition, pickEnding, type CondContext } from '../src/script';
import { isChoice, type ChoiceOption, type Script } from '../src/types';

interface State {
  scene: string;
  line: number;
  /** 剛進場景，還沒決定要點哪些物件。 */
  entering: boolean;
  stats: Record<string, number>;
  flags: string[];
  seen: string[];
  /** 這個場景決定要點、但還沒出現的物件。 */
  toClick: string[];
  /** 路線：`click:{物件id}` 或 `{場景id}#{第幾句}#{選項index}`。 */
  path: string[];
}

export interface Reachability {
  /** 結局 id → 走到它的一條路線。 */
  endings: Map<string, string[]>;
  /** true 表示窮舉完畢；false 表示狀態太多，改用了隨機抽樣。 */
  exhaustive: boolean;
}

const MAX_STATES = 200_000;
const SAMPLES = 5000;

/** 選項是否被 requires 鎖住（v2 第 3 項）。 */
function locked(opt: ChoiceOption, seen: string[]): boolean {
  const req = (opt as { requires?: string | string[] }).requires;
  if (req == null) return false;
  return (Array.isArray(req) ? req : [req]).some((id) => !seen.includes(id));
}

function subsets<T>(items: T[]): T[][] {
  if (items.length > 8) return [[], items, ...items.map((i) => [i])];
  const out: T[][] = [];
  for (let mask = 0; mask < 1 << items.length; mask++) out.push(items.filter((_, i) => mask & (1 << i)));
  return out;
}

/** 從一個狀態往前走，直到遇到分歧（回傳下一批狀態）或結局（回傳結局 id）。 */
function step(script: Script, st: State, chooseRandom: boolean): State[] | string | null {
  const range = script.meta.statRange ?? { min: -Infinity, max: Infinity };
  if (st.scene === ENDING_TARGET) {
    const ctx: CondContext = { stats: st.stats, flags: st.flags, seen: st.seen };
    const e = pickEnding(script, ctx);
    return e ? [{ ...st, scene: e.scene, line: 0, entering: true, toClick: [] }] : null;
  }
  const scene = script.scenes.find((s) => s.id === st.scene);
  if (!scene) return null;
  if (st.entering) {
    const objs = (scene.objects ?? []).map((o) => o.id);
    const options = chooseRandom ? [objs.filter(() => Math.random() < 0.5)] : subsets(objs);
    return options.map((toClick) => ({ ...st, entering: false, toClick }));
  }
  const seen = [...st.seen];
  const path = [...st.path];
  let toClick = [...st.toClick];
  for (let i = st.line; i < scene.lines.length; i++) {
    const line = scene.lines[i];
    const ctx: CondContext = { stats: st.stats, flags: st.flags, seen };
    if (!evalCondition(line.if, ctx)) continue;
    if (!isChoice(line)) {
      // 台詞顯示中可以點已經出現的物件
      for (const id of toClick) {
        const obj = scene.objects?.find((o) => o.id === id);
        if ((obj?.appearAt ?? 0) <= i) {
          if (!seen.includes(id)) seen.push(id);
          path.push(`click:${id}`);
        }
      }
      toClick = toClick.filter((id) => !seen.includes(id));
      continue;
    }
    const shown = line.choice.map((opt, index) => ({ opt, index })).filter((o) => evalCondition(o.opt.if, ctx));
    const pickable = shown.filter((o) => !locked(o.opt, seen));
    if (pickable.length === 0) continue;
    const branches = chooseRandom ? [pickable[Math.floor(Math.random() * pickable.length)]] : pickable;
    return branches.map(({ opt, index }) => {
      const stats = { ...st.stats };
      for (const [k, v] of Object.entries(opt.effects ?? {})) {
        stats[k] = Math.min(range.max, Math.max(range.min, (stats[k] ?? 0) + v));
      }
      const flags = [...new Set([...st.flags, ...(opt.flags ?? [])])];
      const flat = line.fx?.includes('flat_options');
      const target = flat ? shown[0].opt.goto : opt.goto;
      const nextPath = [...path, `${scene.id}#${i}#${index}`];
      if (target) return { scene: target, line: 0, entering: true, stats, flags, seen, toClick: [], path: nextPath };
      return { scene: scene.id, line: i + 1, entering: false, stats, flags, seen, toClick, path: nextPath };
    });
  }
  if (scene.id.startsWith('end_')) {
    return script.endings.find((e) => e.scene === scene.id)?.id ?? null;
  }
  return [{ ...st, scene: scene.next ?? ENDING_TARGET, line: 0, entering: true, seen, toClick: [], path }];
}

function key(st: State): string {
  return [st.scene, st.line, st.entering, JSON.stringify(st.stats), [...st.flags].sort(), [...st.seen].sort(), [...st.toClick].sort()].join('|');
}

export function reachability(script: Script): Reachability {
  const endings = new Map<string, string[]>();
  const start: State = {
    scene: script.scenes[0].id,
    line: 0,
    entering: true,
    stats: { ...script.meta.stats },
    flags: [],
    seen: [],
    toClick: [],
    path: [],
  };
  const visited = new Set<string>();
  const stack = [start];
  while (stack.length && visited.size < MAX_STATES) {
    const st = stack.pop()!;
    const k = key(st);
    if (visited.has(k)) continue;
    visited.add(k);
    const r = step(script, st, false);
    if (typeof r === 'string') {
      if (!endings.has(r)) endings.set(r, st.path);
    } else if (r) stack.push(...r);
  }
  if (!stack.length) return { endings, exhaustive: true };
  // 狀態太多：隨機抽樣
  for (let n = 0; n < SAMPLES; n++) {
    let st: State | undefined = start;
    for (let guard = 0; st && guard < 10_000; guard++) {
      const r = step(script, st, true);
      if (typeof r === 'string') {
        if (!endings.has(r)) endings.set(r, st.path);
        break;
      }
      st = r?.[0];
    }
  }
  return { endings, exhaustive: false };
}

/** 舊介面：結局 id → 路線。 */
export function reachableEndings(script: Script): Map<string, string[]> {
  return reachability(script).endings;
}
