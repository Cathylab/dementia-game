// 白話的檢查關卡（需求書 5.3）：把 validateScript 的技術訊息改寫成一般人看得懂的句子，
// 分成「必須修正」與「建議修正」，每則附上怎麼修與「請 AI 修正」的提示詞；
// 也負責從 AI 的回答裡抓出 JSON。檢查規則本身仍然只有 validateScript 一份。這個檔案不碰 DOM。
import type { Pack } from './pack.ts';
import { validateScript } from './script.ts';
import { isChoice, type Script } from './types.ts';

export type IssueLevel = 'error' | 'warning';

export interface Issue {
  /** error＝必須修正（會擋住下一步）；warning＝建議修正。 */
  level: IssueLevel;
  /** 白話的說明，例如「第二幕〈點名〉的第 2 個選項，會跳到一個不存在的場景。」 */
  plain: string;
  /** 怎麼修。 */
  fix: string;
  /** 白話的位置，例如「第二幕〈點名〉第 4 句的第 2 個選項」。 */
  where: string;
  /** 原本的技術訊息（給工程師或 AI 看）。 */
  tech: string;
  /** 所在場景代號（可以跳過去）。 */
  scene?: string;
  /** 所在台詞（0 起算）。 */
  line?: number;
}

export const LEVEL_LABEL: Record<IssueLevel, string> = { error: '必須修正', warning: '建議修正' };

const CN = '〇一二三四五六七八九';
function cnNumber(n: number): string {
  if (n < 10) return CN[n];
  if (n < 20) return `十${n % 10 ? CN[n % 10] : ''}`;
  if (n < 100) return `${CN[Math.floor(n / 10)]}十${n % 10 ? CN[n % 10] : ''}`;
  return String(n);
}

interface Loc {
  where: string;
  scene?: string;
  line?: number;
}

/** 把技術位置（例如 a2_s07.lines[3].choice[1].goto）翻成白話。 */
function locate(script: Script, path: string): Loc {
  const ending = path.match(/^結局 (\S+?)(?:\.\w+)?$/);
  if (ending) {
    const e = (script.endings ?? []).find((x) => x.id === ending[1]);
    return { where: `結局「${e?.title ?? ending[1]}」`, scene: e?.scene };
  }
  if (/^meta\b/.test(path)) return { where: '遊戲設定' };
  const ch = path.match(/^角色 (\S+?)\./);
  if (ch) {
    const c = (script.characters ?? []).find((x) => x.id === ch[1]);
    return { where: `角色「${c?.name ?? ch[1]}」` };
  }
  const m = path.match(/^([A-Za-z0-9_]+)(?:\.lines\[(\d+)\](?:\.choice\[(\d+)\])?|\.objects\[(\d+)\])?/);
  if (!m) return { where: path };
  const scene = script.scenes.find((s) => s.id === m[1]);
  if (!scene) return { where: path };
  const act = scene.act ?? 1;
  const title = scene.title ? `〈${scene.title}〉` : `〈${scene.id}〉`;
  const sceneName = scene.id.startsWith('end_') ? `結局場景${title}` : `第${cnNumber(act)}幕${title}`;
  if (m[4] !== undefined) {
    const o = scene.objects?.[Number(m[4])];
    return { where: `${sceneName}的可以點的物件「${o?.label || o?.id || Number(m[4]) + 1}」`, scene: scene.id };
  }
  if (m[2] !== undefined) {
    const i = Number(m[2]);
    const line = scene.lines[i];
    if (m[3] !== undefined) {
      const j = Number(m[3]);
      const text = line && isChoice(line) ? line.choice[j]?.text : undefined;
      return { where: `${sceneName}第 ${i + 1} 句的第 ${j + 1} 個選項${text ? `「${text}」` : ''}`, scene: scene.id, line: i };
    }
    return { where: `${sceneName}第 ${i + 1} 句${line && isChoice(line) ? '（選項）' : ''}`, scene: scene.id, line: i };
  }
  return { where: sceneName, scene: scene.id };
}

interface Rule {
  re: RegExp;
  level: IssueLevel;
  /** 回傳 [白話說明（不含位置）, 怎麼修]。g 是正則的群組。 */
  say: (g: string[], path: string) => [string, string];
}

/** 訊息本體（「：」後面）對應的白話。由上往下找第一個符合的。 */
const RULES: Rule[] = [
  {
    re: /^找不到場景 "(.+)"$/,
    level: 'error',
    say: (g, path) =>
      /\.goto$/.test(path)
        ? ['會跳到一個不存在的場景', `請把它改成要去的場景，或刪掉這個跳轉（目前寫的是「${g[1]}」）。`]
        : /\.backTarget$/.test(path)
          ? ['「回上一句」會跳到一個不存在的場景', `請改成存在的場景代號（目前寫的是「${g[1]}」）。`]
          : /^結局/.test(path)
            ? ['用的結局場景不存在', `請把結局場景改成存在的場景（目前寫的是「${g[1]}」）。`]
            : ['播完後會跳到一個不存在的場景', `請在「播完後到」選一個存在的場景，或選「判定結局」（目前寫的是「${g[1]}」）。`],
  },
  { re: /^條件語法錯誤 (.*)$/, level: 'error', say: (g) => ['條件寫錯了，遊戲判斷不了', `請檢查括號、引號和 && ||（電腦的說明：${g[1]}）。`] },
  { re: /^旗標 "(.+)" 沒有任何選項會設定$/, level: 'warning', say: (g) => [`條件用到旗標「${g[1]}」，但沒有任何選項會設定它，所以條件永遠不成立`, '請在某個選項加上這個旗標，或修正拼字。'] },
  { re: /^seen\(\) 用到不存在的物件 "(.+)"$/, level: 'warning', say: (g) => [`條件用到物件「${g[1]}」，但這個物件不存在，所以條件永遠不成立`, '請改成存在的物件代號，或修正拼字。'] },
  { re: /^缺少 id$/, level: 'error', say: () => ['缺少代號（id）', '每個可以點的物件都要有一個整份劇本唯一的英文代號。'] },
  { re: /^物件 id "(.+)" 重複/, level: 'error', say: (g) => [`代號「${g[1]}」和別的物件重複`, '同一個東西出現在不同場景時，也要用不同代號，例如 a1_glasses、a2_glasses。'] },
  { re: /^缺少 label$/, level: 'error', say: () => ['缺少名稱', '請幫這個物件取一個名字，例如「老花眼鏡」。'] },
  { re: /^缺少 description$/, level: 'error', say: () => ['缺少說明', '請寫玩家點開時看到的說明（用主角的口吻）。'] },
  { re: /^缺少 x、y$/, level: 'error', say: () => ['缺少在背景圖上的位置', '請給 x、y（0 到 1，從左上角算起）。'] },
  { re: /^x (\S+) 太靠背景圖左右邊緣/, level: 'warning', say: () => ['位置太靠左右邊緣，可能跑到畫面外', '請把 x 放在 0.1 到 0.9 之間。'] },
  { re: /^y (\S+) 太低/, level: 'warning', say: () => ['位置太低，會被下方的功能列擋住', '請把 y 放在 0.92 以下。'] },
  { re: /^appearAt (\S+) 超過本場景的句數$/, level: 'warning', say: () => ['設定在第幾句之後出現，但這個場景沒有那麼多句，所以永遠不會出現', '請把 appearAt 改小。'] },
  { re: /^物件說明只支援 text_blur、name_fade，不支援 "(.+)"$/, level: 'warning', say: (g) => [`物件說明不能用效果「${g[1]}」`, '物件說明只能用 text_blur（文字模糊）或 name_fade（名稱淡忘）。'] },
  { re: /^有 truthVoice 但沒有 truth$/, level: 'warning', say: () => ['有真相的配音，卻沒有寫真相', '請補上 truth（記憶對照時說出的真相），或刪掉 truthVoice。'] },
  { re: /^未知效果 "(.+)"$/, level: 'error', say: (g) => [`用了一個不存在的效果「${g[1]}」`, '請改成 11 種效果之一，或刪掉它（見 README「效果標籤」）。'] },
  { re: /^choice 有 voice 但沒有 prompt$/, level: 'warning', say: () => ['選項有配音，但沒有提示文字可以唸', '請補上 prompt（選項上方的提示），或刪掉 voice。'] },
  { re: /^所有選項都有 if，可能全部不出現$/, level: 'warning', say: () => ['每個選項都有出現條件，可能一個都不出現，玩家會卡住', '請至少留一個沒有條件的選項。'] },
  { re: /^有 requires 的 choice 至少要有兩個沒有 requires 的選項/, level: 'error', say: () => ['有隱藏選項的地方，一般選項不夠', '要先點過物件才出現的選項旁邊，至少要有兩個一般選項。'] },
  { re: /^物件 "(.+)" 不存在$/, level: 'error', say: (g) => [`要先點過物件「${g[1]}」才能選，但這個物件不存在`, '請改成存在的物件代號，或刪掉 requires。'] },
  { re: /^物件 "(.+)" 在這個選項之後才出現/, level: 'error', say: (g) => [`要先點過物件「${g[1]}」才能選，但那個物件在這個選項之後才出現，玩家不可能先點到`, '請把物件放到更早的地方，或改成別的物件。'] },
  { re: /^隱藏選項要設一個 hidden_ 開頭的旗標$/, level: 'warning', say: () => ['隱藏選項沒有設定 hidden_ 開頭的旗標', '請加一個 hidden_ 開頭的旗標（例如 hidden_kept_letter），結局才知道玩家走過隱藏路線。'] },
  { re: /^hotspot 模式需要 x、y$/, level: 'error', say: () => ['「點畫面選」的選項缺少位置', '請給這個選項 x、y（0 到 1）。'] },
  { re: /^memoryReview 只能放在 end_ 開頭的結局場景$/, level: 'error', say: () => ['記憶對照只能放在結局場景', '請把它移到 end_ 開頭的結局場景。'] },
  { re: /^同一個結局只能有一行 memoryReview$/, level: 'error', say: () => ['同一個結局有兩段記憶對照', '請刪掉多的那一段。'] },
  { re: /^未知 speaker "(.+)"$/, level: 'error', say: (g) => [`說話的人「${g[1]}」不存在`, '請改成旁白（narrator）、主角（player），或在「角色」裡新增這個角色。'] },
  { re: /^表情 "(.+)" 不在角色 (\S+) 的 expressions 清單裡$/, level: 'warning', say: (g) => [`用了角色沒有的表情「${g[1]}」，會改用平常的表情`, '請在「角色」裡把這個表情加進清單，或改用已有的表情。'] },
  { re: /^音效名稱只能用/, level: 'warning', say: () => ['音效名稱有不能用的字', '音效名稱只能用英文字母、數字、底線（_）或連字號（-）。'] },
  { re: /^必須是曲名字串或 null$/, level: 'error', say: () => ['換音樂的設定格式不對', '請寫曲名，或選「停止音樂」。'] },
  { re: /^配音編號 "(.+)" 重複（(.+) 也用了）$/, level: 'error', say: (g) => [`配音編號「${g[1]}」和別句重複`, '每句配音的編號要不一樣，否則兩句會播同一個音檔。'] },
  { re: /^配音編號 "(.+)" 不符合 (.+) 的格式$/, level: 'warning', say: (g) => [`配音編號「${g[1]}」不符合命名規則`, `建議改成 ${g[2]} 的格式，方便配音檔對應。`] },
  { re: /^只能是 "ring" 或 "glow"$/, level: 'warning', say: () => ['提醒動畫的設定不認得，不會有動畫', 'attention 請寫 "ring"（震動＋發亮）或 "glow"（柔和發亮）。'] },
  { re: /^必須是 true 或 false$/, level: 'warning', say: () => ['「一定要點」的設定格式不對', 'required 請寫 true 或 false。'] },
  { re: /^overlayWidth (\S+) 超出/, level: 'warning', say: () => ['物件圖疊在背景上的大小超出範圍，會自動調整', 'overlayWidth 請寫 0.03 到 0.3 之間（背景寬度的比例）。'] },
  { re: /^有 overlayWidth 但沒有 image/, level: 'warning', say: () => ['要把物件圖疊在背景上，但沒有指定物件圖', '請補上 image，或刪掉 overlayWidth。'] },
  { re: /^必須是提示文字$/, level: 'error', say: () => ['「找找看」的提示是空的', 'explore 請寫一句提示，例如「這裡好像有東西可以看看。」'] },
  { re: /^explore 所在的場景沒有可以點的物件$/, level: 'warning', say: () => ['設了「找找看」，但這個場景沒有可以點的物件', '請在這個場景加物件，或刪掉 explore。'] },
  { re: /^explore 之後才出現的物件 "(.+)"/, level: 'warning', say: (g) => [`物件「${g[1]}」在「找找看」之後才出現，找的時候看不到它`, '請把這個物件的 appearAt 改成不超過這一句。'] },
  { re: /^同一個場景有兩次 explore/, level: 'warning', say: () => ['同一個場景有兩次「找找看」', '建議一個場景最多一次，整部作品約 4～8 次。'] },
  { re: /^缺少$/, level: 'error', say: () => ['缺少必要的設定', '請補上。'] },
];

/** 沒有位置前綴的訊息（整份劇本層級）。 */
const GLOBAL_RULES: Rule[] = [
  { re: /^meta\.title 缺少$/, level: 'error', say: () => ['遊戲沒有名稱', '請在 meta.title 寫上遊戲名稱。'] },
  { re: /^scenes 為空$/, level: 'error', say: () => ['劇本裡一個場景都沒有', '請至少寫一個場景。'] },
  { re: /^meta\.credits/, level: 'warning', say: () => ['素材出處（製作名單）的格式不對，不會顯示', 'meta.credits 請寫成清單，每一筆有 file、title、author、license、url。'] },
  { re: /^meta\.pack/, level: 'error', say: () => ['題材包的設定格式不對', 'meta.pack 請寫題材包代號（例如 "dementia"），或 null。'] },
  { re: /^meta\.settingsDefaults/, level: 'warning', say: () => ['遊戲設定的預設值格式不對，會改用一般的預設值', '請照 docs/script-format-v2.md 的說明修正 settingsDefaults。'] },
  { re: /^meta\.(transition|objectHighlight)/, level: 'warning', say: () => ['畫面呈現的設定值不認得，會改用預設值', '可以在開發者面板「呈現調整」重新選一次。'] },
  { re: /\.(scale|y) 必須是/, level: 'warning', say: () => ['角色大小或位置的設定格式不對，會改用預設值', '可以在開發者面板「呈現調整」重新調整。'] },
  { re: /^meta\.stats：數值名稱 "(.+)" 與條件保留字撞名/, level: 'error', say: (g) => [`數值名稱「${g[1]}」和系統保留字撞名`, `請把數值改名，或在條件裡寫 stats.${g[1]}。`] },
  { re: /^\S+\.chapter 必須是文字$/, level: 'warning', say: () => ['章節卡文字格式不對', '請寫文字，或刪掉 chapter。'] },
  { re: /^題材包「(.+)」沒有啟用效果 (\S+)，(.+)的這個效果不會出現$/, level: 'warning', say: (g) => [`題材包「${g[1]}」沒有啟用效果 ${g[2]}，用在 ${g[3]}的這個效果不會出現`, '如果需要這個效果，請換一個有啟用它的題材包；不需要的話可以刪掉。'] },
];

/** 把一則技術訊息翻成 Issue。 */
export function explain(script: Script, message: string): Issue {
  const warn = message.startsWith('（警告）');
  const tech = warn ? message.slice('（警告）'.length) : message;
  for (const r of GLOBAL_RULES) {
    const g = tech.match(r.re);
    if (g) {
      const [plain, fix] = r.say([...g], tech);
      const m = tech.match(/^([A-Za-z0-9_]+)\.chapter/);
      const loc = m ? locate(script, m[1]) : { where: '整份劇本' };
      return { level: warn ? 'warning' : r.level, plain: `${loc.where}：${plain}。`, fix, where: loc.where, tech: message, scene: loc.scene };
    }
  }
  const i = tech.indexOf('：');
  const path = i >= 0 ? tech.slice(0, i) : '';
  const body = i >= 0 ? tech.slice(i + 1) : tech;
  const loc = path ? locate(script, path) : { where: '整份劇本' };
  for (const r of RULES) {
    const g = body.match(r.re);
    if (g) {
      const [plain, fix] = r.say([...g], path);
      return { level: warn ? 'warning' : r.level, plain: `${loc.where}，${plain}。`, fix, where: loc.where, tech: message, scene: loc.scene, line: loc.line };
    }
  }
  // 沒有對應的白話：保留原文
  return {
    level: warn ? 'warning' : 'error',
    plain: `${loc.where}：${body}`,
    fix: '請照訊息修正；不確定的話，把下面的提示詞貼給 AI。',
    where: loc.where,
    tech: message,
    scene: loc.scene,
    line: loc.line,
  };
}

/** 檢查劇本，回傳白話的問題清單（必須修正在前）。 */
export function checkScript(script: Script, pack?: Pack): Issue[] {
  const issues = validateScript(script, pack).map((m) => explain(script, m));
  return [...issues.filter((x) => x.level === 'error'), ...issues.filter((x) => x.level === 'warning')];
}

/** 有沒有擋住下一步的問題。 */
export function hasBlocking(issues: Issue[]): boolean {
  return issues.some((x) => x.level === 'error');
}

/** 一則問題的「請 AI 修正」提示詞。 */
export function fixPrompt(issue: Issue): string {
  return [
    '我在做一個視覺小說遊戲，劇本是一份 script.json。檢查工具找到下面這個問題，請幫我修正。',
    '',
    `問題：${issue.plain}`,
    `怎麼修：${issue.fix}`,
    `技術訊息：${issue.tech}`,
    '',
    '請只修正這個問題，其他內容保持不變，然後輸出完整的 script.json。',
    '只輸出 JSON，不要加任何說明文字，也不要用 ``` 包起來。',
  ].join('\n');
}

/** 一次修正全部問題的提示詞。 */
export function fixAllPrompt(issues: Issue[]): string {
  return [
    '我在做一個視覺小說遊戲，劇本是一份 script.json。檢查工具找到下面這些問題，請幫我修正。',
    '',
    ...issues.map((x, i) => `${i + 1}.【${LEVEL_LABEL[x.level]}】${x.plain}\n   怎麼修：${x.fix}\n   技術訊息：${x.tech}`),
    '',
    '其他內容保持不變，輸出修正後完整的 script.json。',
    '只輸出 JSON，不要加任何說明文字，也不要用 ``` 包起來。',
  ].join('\n');
}

/** 貼回來的不是 JSON 時，給 AI 的提示詞。 */
export const JSON_ONLY_PROMPT = [
  '你剛才的回答裡有說明文字，或 JSON 不完整，我的檢查工具讀不懂。',
  '請重新輸出完整的 script.json：',
  '- 只輸出 JSON 本身，從 { 開始、到 } 結束。',
  '- 不要加任何說明文字，也不要用 ``` 包起來。',
  '- 如果太長被截斷，請分段說明之前，先確認最後一個 } 有寫出來。',
].join('\n');

export type ExtractResult =
  | { ok: true; value: unknown; note?: string }
  | { ok: false; error: string; prompt: string };

/**
 * 從貼上的文字抓出 JSON：AI 常在前後加說明、用 ``` 包起來，或用了中文引號。
 * 依序試：整段直接解析 → ``` 區塊 → 第一個 { 到對應的 } 。
 */
export function extractJson(text: string): ExtractResult {
  const src = text.replace(/^﻿/, '').trim();
  if (!src) return { ok: false, error: '貼上的內容是空的。', prompt: JSON_ONLY_PROMPT };
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return undefined;
    }
  };
  const direct = tryParse(src);
  if (direct !== undefined && typeof direct === 'object' && direct !== null) return { ok: true, value: direct };
  for (const m of src.matchAll(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/g)) {
    const v = tryParse(m[1].trim());
    if (v !== undefined && typeof v === 'object' && v !== null) return { ok: true, value: v, note: '已去掉前後的說明文字。' };
  }
  const start = src.indexOf('{');
  if (start >= 0) {
    const end = matchingBrace(src, start);
    if (end > 0) {
      const v = tryParse(src.slice(start, end + 1));
      if (v !== undefined) return { ok: true, value: v, note: start > 0 || end < src.length - 1 ? '已去掉前後的說明文字。' : undefined };
      // 常見：AI 用了中文引號或結尾多一個逗號
      const cleaned = src
        .slice(start, end + 1)
        .replace(/[“”]/g, '"')
        .replace(/,\s*([}\]])/g, '$1');
      const v2 = tryParse(cleaned);
      if (v2 !== undefined) return { ok: true, value: v2, note: '已修正中文引號或多餘的逗號。' };
      return { ok: false, error: '找到 JSON，但格式有錯（可能少了逗號或引號）。', prompt: JSON_ONLY_PROMPT };
    }
    return { ok: false, error: 'JSON 不完整，最後的 } 不見了（可能回答被截斷）。', prompt: JSON_ONLY_PROMPT };
  }
  return { ok: false, error: '貼上的內容裡找不到 JSON。', prompt: JSON_ONLY_PROMPT };
}

/** 從 start（是 {）找到對應的 }；忽略字串裡的括號。找不到回傳 -1。 */
function matchingBrace(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

export type PasteResult =
  | { ok: true; script: Script; issues: Issue[]; note?: string }
  | { ok: false; error: string; prompt: string };

/** 檢查貼回來的劇本：先抓 JSON，再確認是劇本，最後跑白話檢查。 */
export function checkPastedScript(text: string, pack?: Pack): PasteResult {
  const r = extractJson(text);
  if (!r.ok) return r;
  const v = r.value as Partial<Script> | null;
  if (!v || typeof v !== 'object' || Array.isArray(v) || !v.meta || !Array.isArray(v.scenes)) {
    return { ok: false, error: '這段 JSON 不是劇本（缺少 meta 或 scenes）。', prompt: JSON_ONLY_PROMPT };
  }
  const script = v as Script;
  script.characters ??= [];
  script.endings ??= [];
  return { ok: true, script, issues: checkScript(script, pack), note: r.note };
}
