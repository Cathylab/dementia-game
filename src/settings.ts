import { storageGet, storageSet } from './util';

export interface Settings {
  /** 每秒字數；100 以上視為瞬間顯示。 */
  textSpeed: number;
  /** 主音量 0–1。 */
  volume: number;
  /** 隱藏選項提示：灰掉的選項顯示缺少的物件名稱（v2）。 */
  hiddenHints: boolean;
}

const KEY = 'dementia-vn-settings';
export const settings: Settings = storageGet<Settings>(KEY, { textSpeed: 30, volume: 0.7, hiddenHints: false });

export function saveSettings(): void {
  storageSet(KEY, settings);
}
