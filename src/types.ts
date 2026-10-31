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
}

export interface ChoiceLine {
  choice: ChoiceOption[];
  mode?: 'list' | 'hotspot';
  fx?: FxTag[];
  /** 選項上方可選的提示文字。 */
  prompt?: string;
}

export type Line = TextLine | ChoiceLine;

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
