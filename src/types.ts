// 腳本資料格式（public/script.json）。引擎只依賴這份型別，與故事內容無關。

export type FxTag =
  | 'name_fade'
  | 'text_blur'
  | 'repeat_line'
  | 'choice_vanish'
  | 'flat_options'
  | 'wrong_object'
  | 'time_skip'
  | 'desaturate'
  | 'focus_drift'
  | 'look_around'
  | 'muffle';

export const ALL_FX: FxTag[] = [
  'name_fade',
  'text_blur',
  'repeat_line',
  'choice_vanish',
  'flat_options',
  'wrong_object',
  'time_skip',
  'desaturate',
  'focus_drift',
  'look_around',
  'muffle',
];

export type Gaze = 'camera' | 'away' | 'other';
export type Distance = 'near' | 'normal' | 'far';

export interface Meta {
  title: string;
  durationMinutes?: number;
  stats: Record<string, number>;
  statRange?: { min: number; max: number };
  /** 設定的預設值；玩家在設定裡改過的以玩家為準（v2）。 */
  settingsDefaults?: SettingsDefaults;
}

export interface SettingsDefaults {
  hiddenHints?: boolean;
  memoryReview?: 'inline' | 'page';
}

export interface Character {
  id: string;
  name: string;
  trait?: string;
  relation?: string;
}

export interface TextLine {
  speaker: string;
  text: string;
  expression?: string;
  gaze?: Gaze;
  distance?: Distance;
  fx?: FxTag[];
  /** wrong_object 用：要疊上（或替換成）的物件檔名。省略時見 README。 */
  wrongObject?: string;
  /** time_skip 用：短暫切換到的背景名稱。省略時隨機挑腳本裡另一個背景。 */
  timeSkipTo?: string;
  /** 條件：不成立時整句跳過（v2）。 */
  if?: string;
  /** 引擎內部用：記憶對照產生的台詞，附帶物件圖與當時的說明。腳本裡不要寫。 */
  memory?: { objectId: string; label: string; description: string; image?: string };
}

/** 記憶對照的位置標記，只能放在 end_ 開頭的結局場景（v2）。 */
export interface MemoryReviewLine {
  memoryReview: {
    /** 說出真相的人：narrator、player 或角色 id。 */
    speaker: string;
    /** 開頭的旁白。 */
    intro?: string;
  };
  if?: string;
  fx?: FxTag[];
}

export interface ChoiceOption {
  text: string;
  effects?: Record<string, number>;
  flags?: string[];
  /** 省略時繼續播放本場景下一句。"@ending" 表示判定結局。 */
  goto?: string;
  /** hotspot 模式的比例座標（0–1）。 */
  x?: number;
  y?: number;
  r?: number;
  /** 條件：不成立時這個選項不出現（v2）。 */
  if?: string;
  /** 需要先點過的物件 id（全部點過才解鎖）；沒點過時選項灰掉不能按（v2）。 */
  requires?: string | string[];
}

/** requires 統一成陣列。 */
export function requiredObjects(opt: ChoiceOption): string[] {
  return opt.requires == null ? [] : Array.isArray(opt.requires) ? opt.requires : [opt.requires];
}

export interface ChoiceLine {
  choice: ChoiceOption[];
  mode?: 'list' | 'hotspot';
  fx?: FxTag[];
  /** 選項上方可選的提示文字。 */
  prompt?: string;
  /** 條件：不成立時整組選項跳過（v2）。 */
  if?: string;
}

export type Line = TextLine | ChoiceLine | MemoryReviewLine;

export type UiKey = 'back' | 'auto' | 'skip' | 'log' | 'hide' | 'settings' | 'title';

export interface UiOverrides {
  back?: 'normal' | 'disabled' | 'hidden' | 'wrong_scene';
  auto?: 'normal' | 'disabled' | 'hidden' | 'skips_lines';
  skip?: 'normal' | 'disabled' | 'hidden';
  log?: 'normal' | 'disabled' | 'hidden' | 'corrupt';
  hide?: 'normal' | 'disabled' | 'hidden';
  settings?: 'normal' | 'disabled' | 'hidden';
  title?: 'normal' | 'disabled' | 'hidden';
}

/** 場景裡可以點來看說明的物件（v2）。 */
export interface SceneObject {
  /** 整份腳本唯一。 */
  id: string;
  label: string;
  x: number;
  y: number;
  r?: number;
  /** 從本場景第幾句（0 起算）開始可以點。 */
  appearAt?: number;
  /** 物件圖：public/assets/fg/{image}.png。 */
  image?: string;
  description: string;
  /** 真相，用於記憶對照。 */
  truth?: string;
  /** 套在說明上的效果，只支援 text_blur、name_fade。 */
  fx?: FxTag[];
}

export interface Scene {
  id: string;
  act?: number;
  title?: string;
  background?: string | null;
  /** 字串＝播放該曲；null＝靜音；省略＝沿用上一首。 */
  music?: string | null;
  foreground?: string | null;
  ui?: UiOverrides;
  /** ui.back = "wrong_scene" 時，回上一句會跳到這個場景。 */
  backTarget?: string;
  lines: Line[];
  /** 可以點的物件（v2）。 */
  objects?: SceneObject[];
  /** 省略或 "@ending" 表示判定結局；end_ 開頭的場景結束後顯示結局畫面。 */
  next?: string | null;
}

export interface Ending {
  id: string;
  title: string;
  condition: string;
  scene: string;
}

export interface Script {
  meta: Meta;
  characters: Character[];
  scenes: Scene[];
  endings: Ending[];
}

export function isChoice(line: Line): line is ChoiceLine {
  return Array.isArray((line as ChoiceLine).choice);
}

export function isMemoryReview(line: Line): line is MemoryReviewLine {
  return typeof (line as MemoryReviewLine).memoryReview === 'object' && (line as MemoryReviewLine).memoryReview !== null;
}

export function isText(line: Line): line is TextLine {
  return !isChoice(line) && !isMemoryReview(line);
}

