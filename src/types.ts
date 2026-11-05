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
  /** 換場景的轉場樣式，省略為 "blink"（呈現設定，開發者面板可調）。 */
  transition?: TransitionStyle;
  /** 可以點的物件怎麼提示：glow＝物品本身發亮（預設）、ring＝圓圈（呈現設定）。 */
  objectHighlight?: 'glow' | 'ring';
  /** 所有角色立繪的預設構圖；角色自己的 sprite 會覆寫（呈現設定）。 */
  sprite?: SpriteFraming;
  /**
   * 題材包代號（packs/{pack}/pack.json）。省略＝dementia（相容舊腳本）；null 或 "plain"＝一般故事，沒有特殊效果。
   */
  pack?: string | null;
  /** 介面樣式（呈現設定）：classic＝全幅漸層（預設）、box＝有邊框的對話框、paper＝米白紙張。 */
  uiStyle?: UiStyle;
  /** 封面圖：assets/bg/{cover}（呈現設定）。省略＝沒有封面。 */
  cover?: string;
  /** 手機直式用的封面（選填），省略時用 cover（以中間為主裁切）。 */
  coverPortrait?: string;
  /** 主角內心獨白（畫面中間的字）的樣式與大小（呈現設定）。 */
  monologueStyle?: MonologueStyle;
  /** 章節卡的樣式與大小（呈現設定）。 */
  chapterStyle?: ChapterStyle;
  /** 選項的位置與大小（呈現設定，開發者面板可調）。 */
  choiceStyle?: ChoiceStyle;
  /** 素材出處（音效等），標題畫面「製作名單」顯示。 */
  credits?: Credit[];
}

/**
 * 選項的位置與大小。position：right＝對話框右上方（預設）、left＝對話框左上方、center＝畫面中間（舊樣式）；
 * width：選項寬度（畫面寬的比例 0.2～0.8，預設 0.36）；scale：字的大小倍數（0.6～1.3，預設 0.88）。
 * 手機直式一律置中。
 */
export interface ChoiceStyle {
  position?: 'right' | 'left' | 'center';
  width?: number;
  scale?: number;
}

/**
 * 章節卡：style＝stacked（預設：「第一章」與時間上下排列，兩者都清楚）、bold（「第一章」最大）、
 * quiet（小而淡，舊樣式）；scale＝整體大小倍數（0.6～1.6，預設 1）。
 */
export interface ChapterStyle {
  style?: 'stacked' | 'bold' | 'quiet';
  scale?: number;
}

/**
 * 內心獨白：style＝band（預設：字後面一條柔和的暗帶，清楚好讀）、card（圓角的半透明框）、
 * soft（淡淡的斜體、只有陰影，舊樣式）；scale＝字的大小倍數（0.7～1.5，預設 1）。
 */
export interface MonologueStyle {
  style?: 'band' | 'card' | 'soft';
  scale?: number;
}

/** 一筆素材出處。file 是素材名稱（例如音效 phone_ring）。 */
export interface Credit {
  file?: string;
  title?: string;
  author?: string;
  license?: string;
  url?: string;
}

export type UiStyle = 'classic' | 'box' | 'paper';
export const UI_STYLES: UiStyle[] = ['classic', 'box', 'paper'];

export type TransitionStyle = 'blink' | 'blink_soft' | 'fade' | 'focus';
export const TRANSITION_STYLES: TransitionStyle[] = ['blink', 'blink_soft', 'fade', 'focus'];

/** 立繪構圖：scale 是相對原本全身高度的倍數，y 是上下位移（畫面高度的 %，負數往下）。 */
export interface SpriteFraming {
  scale?: number;
  y?: number;
}

export interface SettingsDefaults {
  hiddenHints?: boolean;
  memoryReview?: 'inline' | 'page';
  /** 配音音量 0–1，預設 0.9（v3）。 */
  voiceVolume?: number;
}

export interface Character {
  id: string;
  name: string;
  trait?: string;
  relation?: string;
  /** 這個角色有哪些表情（立繪檔名 {id}_{表情}.png）。列了之後，台詞的 expression 必須在清單裡。 */
  expressions?: string[];
  /** 這個角色立繪的構圖，覆寫 meta.sprite（呈現設定）。 */
  sprite?: SpriteFraming;
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
  /** 播到這句時換音樂：字串＝換成該曲；null＝停止；省略＝不變（v2）。 */
  music?: string | null;
  /** 配音編號：{專案}/assets/voice/{voice}.mp3（或 .ogg）（v3）。 */
  voice?: string;
  /** 這句出現時播一次的音效：{專案}/assets/sfx/{sfx}.mp3（或 .ogg）。 */
  sfx?: string;
  /**
   * 「找找看」時刻：這句出現後顯示這段提示，物件柔和發亮；點畫面不會往下，要按「繼續」。
   * 放在沒有角色立繪、物件都已經出現的地方。
   */
  explore?: string;
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
  /** prompt 的配音編號（prompt 是角色說的話時才用）（v3）。 */
  voice?: string;
  /** 條件：不成立時整組選項跳過（v2）。 */
  if?: string;
}

export type Line = TextLine | ChoiceLine | MemoryReviewLine;

export type UiKey = 'back' | 'auto' | 'skip' | 'log' | 'hide' | 'settings' | 'title' | 'pause';

export interface UiOverrides {
  back?: 'normal' | 'disabled' | 'hidden' | 'wrong_scene';
  auto?: 'normal' | 'disabled' | 'hidden' | 'skips_lines';
  skip?: 'normal' | 'disabled' | 'hidden';
  log?: 'normal' | 'disabled' | 'hidden' | 'corrupt';
  hide?: 'normal' | 'disabled' | 'hidden';
  settings?: 'normal' | 'disabled' | 'hidden';
  /** 暫停選單裡的「回到標題」。 */
  title?: 'normal' | 'disabled' | 'hidden';
  pause?: 'normal' | 'disabled' | 'hidden';
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
  /** 物件圖：{專案}/assets/fg/{image}.png。 */
  image?: string;
  description: string;
  /** 真相，用於記憶對照。 */
  truth?: string;
  /** 記憶對照時唸出 truth 的配音編號（v3）。 */
  truthVoice?: string;
  /** 套在說明上的效果，只支援 text_blur、name_fade。 */
  fx?: FxTag[];
  /** 條件：不成立時這個物件不出現（和台詞的 if 一樣）。 */
  if?: string;
  /** 一定要點：劇情停在 appearAt 那一句，點過（關掉說明卡）才能往下。 */
  required?: boolean;
  /** 提醒動畫：ring＝震動＋發亮（手機、門鈴），glow＝柔和發亮。可以不搭配 required。 */
  attention?: 'ring' | 'glow';
  /** 物件出現時循環播放的音效（assets/sfx/{名稱}），點了就停。 */
  sfx?: string;
  /** 把物件圖（image）疊在背景上，寬度是背景寬的比例（0.03～0.3）。 */
  overlayWidth?: number;
}

export interface Scene {
  id: string;
  act?: number;
  title?: string;
  /**
   * 章節卡上的大字（例如「婚禮前半年」）。只看每一幕的第一個場景；
   * 省略時取 title 裡「・」前面的部分，空字串＝這一幕不顯示章節卡。
   */
  chapter?: string;
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
  /** 結局畫面標題下方的說明（一到三句）。 */
  description?: string;
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

