// 離線版（直接雙擊 html，網址是 file://）：瀏覽器不准 fetch 本機檔案，
// 所以建置時把每個專案的 script.json 與音檔清單直接寫進 html（window.__VN_EMBED__）。
// 線上版沒有這個東西，照常用 fetch。
import type { Script } from './types';

export interface EmbeddedProject {
  title: string;
  kind: 'example' | 'template';
  script: Script;
  /** 各素材資料夾（voice、sfx、music）實際存在的檔案。 */
  manifests: Record<string, string[]>;
}

export interface Embed {
  /** 沒有 ?project= 時載入哪一個，例如 examples/寫給未來的我。 */
  defaultProject: string;
  projects: Record<string, EmbeddedProject>;
  /** 題材包（packs/{id}/pack.json 的內容）。 */
  packs?: Record<string, unknown>;
}

export const EMBED: Embed | null = (globalThis as unknown as { __VN_EMBED__?: Embed }).__VN_EMBED__ ?? null;

/** 直接從檔案開啟（file://）：fetch 本機檔案、Web Audio 解碼本機音檔都不能用。 */
export const FILE_MODE = typeof location !== 'undefined' && location.protocol === 'file:';

/** 內嵌的腳本（複製一份，編輯器會改它）。沒有就回傳 null。 */
export function embeddedScript(dir: string): Script | null {
  const p = EMBED?.projects[dir];
  return p ? (JSON.parse(JSON.stringify(p.script)) as Script) : null;
}

export function embeddedManifest(dir: string, folder: string): string[] | null {
  return EMBED?.projects[dir]?.manifests[folder] ?? null;
}

/** 離線模式下哪些功能被簡化（顯示在開發者面板）。 */
export const OFFLINE_LIMITS = [
  '音樂的走音只改變速度與音量，沒有「變悶」的濾波',
  '「聲音變悶」（muffle）只降低音量',
  '匯出專案檔只包含你自己上傳或開啟的素材，不含內建的 Demo 素材',
  '文字編輯、故事編輯的「儲存」改成下載 script.json',
];
