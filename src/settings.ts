import type { SettingsDefaults } from './types';

export type MemoryReviewMode = 'inline' | 'page';

export interface Settings {
  /** 每秒字數；100 以上視為瞬間顯示。 */
  textSpeed: number;
  /** 主音量 0–1。 */
  volume: number;
  /** 隱藏選項提示：灰掉的選項顯示缺少的物件名稱（v2）。 */
  hiddenHints: boolean;
  /** 記憶對照：融入結局或結局後獨立一頁（v2）。 */
  memoryReview: MemoryReviewMode;
}

const KEY = 'dementia-vn-settings';
const BUILTIN: Settings = { textSpeed: 30, volume: 0.7, hiddenHints: false, memoryReview: 'inline' };

/** 玩家自己改過的設定（存在瀏覽器裡）。沒改過的項目才會套用腳本的預設值。 */
const stored: Partial<Settings> = readStored();
export const settings: Settings = { ...BUILTIN, ...stored };

function readStored(): Partial<Settings> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** 套用 meta.settingsDefaults；玩家改過的項目以玩家為準。 */
export function applyScriptDefaults(defaults: SettingsDefaults | undefined): void {
  if (!defaults) return;
  if (typeof defaults.hiddenHints === 'boolean' && stored.hiddenHints === undefined) {
    settings.hiddenHints = defaults.hiddenHints;
  }
  if ((defaults.memoryReview === 'inline' || defaults.memoryReview === 'page') && stored.memoryReview === undefined) {
    settings.memoryReview = defaults.memoryReview;
  }
}

/** 玩家在設定畫面改了某一項：立即生效並記住。 */
export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  settings[key] = value;
  stored[key] = value;
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    /* 私密模式等情況下忽略 */
  }
}
