// 小作品範本（需求書 6-2）：照格子填就能完成的短篇——約 5 分鐘、2 到 3 個場景、每場一個選擇。
// 這個檔案只負責「格子 → 劇本」，不碰 DOM（測試直接用）。
import type { FxTag, Script, Scene, TextLine } from '../types';

/** 地點類型：決定背景名稱（佔位圖依名稱畫出對應的構圖）。 */
export const PLACES = [
  { id: 'home', label: '家裡（白天）', bg: 'home_day' },
  { id: 'home_night', label: '家裡（晚上）', bg: 'home_night' },
  { id: 'classroom', label: '教室', bg: 'classroom' },
  { id: 'street', label: '戶外、街上', bg: 'street' },
  { id: 'shop', label: '店裡、辦公室、醫院', bg: 'shop' },
  { id: 'hall', label: '大廳、舞台', bg: 'hall' },
] as const;
export type PlaceId = (typeof PLACES)[number]['id'];

/** 誰說的：旁白、主角心裡的話，或第幾個角色（0 起算）。 */
export type Who = 'narrator' | 'player' | number;

export interface GridOption {
  text: string;
  /** 選了之後的一句回應（旁白）。 */
  reply: string;
}

export interface GridScene {
  /** 時間・地點，例如「轉學第一天・教室」。 */
  title: string;
  place: PlaceId;
  /** 發生什麼：每一行是一句旁白。 */
  happen: string;
  lines: { who: Who; text: string }[];
  /** 選項上方的提示。 */
  prompt: string;
  options: [GridOption, GridOption];
  /** 哪一個選項比較靠近（0 或 1），決定走向哪個結局。 */
  better: 0 | 1;
  /** 這一場要用的效果（加在主角面對選擇前的最後一句）；空字串＝不用。 */
  effect: FxTag | '';
}

export interface GridEnding {
  title: string;
  text: string;
}

export interface Grid {
  chars: { name: string; relation: string }[];
  scenes: GridScene[];
  endings: [GridEnding, GridEnding];
}

export function emptyScene(i: number): GridScene {
  return {
    title: '',
    place: (['home', 'classroom', 'home_night'] as PlaceId[])[i % 3],
    happen: '',
    lines: [
      { who: 'narrator', text: '' },
      { who: 0, text: '' },
      { who: 'player', text: '' },
    ],
    prompt: '',
    options: [
      { text: '', reply: '' },
      { text: '', reply: '' },
    ],
    better: 0,
    effect: '',
  };
}

export function emptyGrid(): Grid {
  return {
    chars: [{ name: '', relation: '' }],
    scenes: [emptyScene(0), emptyScene(1), emptyScene(2)],
    endings: [
      { title: '', text: '' },
      { title: '', text: '' },
    ],
  };
}

/** 還沒填的格子（給人看的清單）。空陣列＝可以產生劇本。 */
export function gridMissing(g: Grid): string[] {
  const out: string[] = [];
  if (g.scenes.length < 2) out.push('至少要有 2 個場景');
  g.chars.forEach((c, i) => {
    if (!c.name.trim() && (c.relation.trim() || g.scenes.some((s) => s.lines.some((l) => l.who === i && l.text.trim())))) {
      out.push(`角色 ${i + 1} 還沒有名字`);
    }
  });
  g.scenes.forEach((s, i) => {
    const n = `第 ${i + 1} 場`;
    if (!s.title.trim()) out.push(`${n}：時間・地點`);
    if (!s.happen.trim() && !s.lines.some((l) => l.text.trim())) out.push(`${n}：發生什麼（或至少一句對話）`);
    s.lines.forEach((l, k) => {
      if (typeof l.who === 'number' && l.text.trim() && !g.chars[l.who]?.name.trim()) out.push(`${n}第 ${k + 1} 句：說話的角色還沒有名字`);
    });
    s.options.forEach((o, k) => {
      if (!o.text.trim()) out.push(`${n}：選項 ${k + 1} 的文字`);
    });
  });
  g.endings.forEach((e, i) => {
    if (!e.text.trim()) out.push(`結局 ${i + 1} 的內容`);
  });
  return out;
}

/** 依格子產生劇本。 */
export function gridToScript(g: Grid, meta: { title: string; pack: string }): Script {
  const chars = g.chars
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.name.trim())
    .map(({ c, i }) => ({ id: `c${i + 1}`, name: c.name.trim(), ...(c.relation.trim() ? { relation: c.relation.trim() } : {}), expressions: ['neutral'] }));
  const speaker = (who: Who) => (typeof who === 'number' ? `c${who + 1}` : who);
  const scenes: Scene[] = g.scenes.map((s, i) => {
    const id = `a${i + 1}_s01`;
    const lines: Scene['lines'] = [];
    for (const t of s.happen.split('\n').map((x) => x.trim()).filter(Boolean)) lines.push({ speaker: 'narrator', text: t });
    for (const l of s.lines) {
      if (!l.text.trim()) continue;
      if (typeof l.who === 'number' && !g.chars[l.who]?.name.trim()) continue;
      lines.push({ speaker: speaker(l.who), text: l.text.trim() });
    }
    if (!lines.length) lines.push({ speaker: 'narrator', text: '……' });
    // 效果加在面對選擇前的最後一句
    if (s.effect) {
      const last = lines[lines.length - 1] as TextLine;
      last.fx = [s.effect];
    }
    const flag = (k: number) => `s${i + 1}_${k === 0 ? 'a' : 'b'}`;
    lines.push({
      ...(s.prompt.trim() ? { prompt: s.prompt.trim() } : {}),
      choice: s.options.map((o, k) => ({
        text: o.text.trim() || `選項${k + 1}`,
        flags: [flag(k)],
        ...(k === s.better ? { effects: { close: 1 } } : {}),
      })),
    });
    s.options.forEach((o, k) => {
      if (o.reply.trim()) lines.push({ speaker: 'narrator', text: o.reply.trim(), if: `has("${flag(k)}")` });
    });
    const place = PLACES.find((p) => p.id === s.place) ?? PLACES[0];
    return {
      id,
      act: i + 1,
      title: s.title.trim() || `第 ${i + 1} 場`,
      background: place.bg,
      lines,
      next: i < g.scenes.length - 1 ? `a${i + 2}_s01` : '@ending',
    };
  });
  const need = Math.ceil(g.scenes.length / 2);
  const endScene = (e: GridEnding, k: number, act: number): Scene => ({
    id: `end_${k === 0 ? 'a' : 'b'}`,
    act,
    title: e.title.trim() || `結局 ${k + 1}`,
    background: scenes[scenes.length - 1]?.background ?? 'home_day',
    lines: e.text
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((text) => ({ speaker: 'narrator', text }) as TextLine),
  });
  const act = g.scenes.length;
  const endA = endScene(g.endings[0], 0, act);
  const endB = endScene(g.endings[1], 1, act);
  for (const e of [endA, endB]) if (!e.lines.length) e.lines.push({ speaker: 'narrator', text: '……' });
  return {
    meta: { title: meta.title || '我的遊戲', pack: meta.pack, durationMinutes: 5, stats: { close: 0 } },
    characters: chars,
    scenes: [...scenes, endA, endB],
    endings: [
      { id: 'ending_a', title: endA.title ?? '結局 1', condition: `close >= ${need}`, scene: 'end_a' },
      { id: 'ending_b', title: endB.title ?? '結局 2', condition: 'true', scene: 'end_b' },
    ],
  };
}
