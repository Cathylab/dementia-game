// 題材包（需求書 5.6）：每個處境（失智、聽損……）啟用哪些效果、退化係數怎麼隨幕變化、介面上的特殊文字。
// 題材包放在 packs/{id}/pack.json，新增題材包不用改程式。這個檔案不碰 DOM（腳本檢查、測試也會用）。
import { ALL_FX, type FxTag, type Script } from './types.ts';

export interface PackTexts {
  /** name_fade 時名字最後變成的字。 */
  forgottenPerson: string;
  /** 物件說明卡 name_fade 時名稱最後變成的字。 */
  forgottenThing: string;
}

export interface Pack {
  id: string;
  name: string;
  description: string;
  /** 啟用的效果標籤。不在清單裡的效果在遊戲裡不會出現（腳本檢查會提醒）。 */
  effects: FxTag[];
  /**
   * 退化係數隨幕變化：第 1 幕用 [0]、第 2 幕用 [1]……超過的幕沿用最後一個。
   * 退化係數影響打字、熱點明顯程度、音樂走音等（見 README「全域退化係數」）。全部是 0＝沒有退化。
   */
  degradation: number[];
  texts: PackTexts;
  /** 題材包資料夾裡的說明文件（相對路徑）。 */
  docs?: { readme?: string; guide?: string; cautions?: string };
}

export const DEFAULT_TEXTS: PackTexts = { forgottenPerson: '那個人', forgottenThing: '那個東西' };

/** 沒有題材包（meta.pack 為 null 或 "plain"）：一般視覺小說，沒有特殊效果、沒有退化。 */
export const PLAIN_PACK: Pack = {
  id: 'plain',
  name: '一般故事',
  description: '沒有特殊效果的一般視覺小說。',
  effects: [],
  degradation: [0],
  texts: DEFAULT_TEXTS,
};

/**
 * 舊腳本（沒有寫 meta.pack）的行為：全部效果、第一幕 0／第二幕 0.5／第三幕起 1。
 * 和 packs/dementia/pack.json 一樣；讀不到題材包檔案時也用它，確保舊腳本照常執行。
 */
export const LEGACY_PACK: Pack = {
  id: 'dementia',
  name: '失智症',
  description: '用第一人稱經歷失智症。',
  effects: [...ALL_FX],
  degradation: [0, 0.5, 1],
  texts: DEFAULT_TEXTS,
};

/** 腳本要用哪個題材包：沒寫＝dementia（相容舊腳本），null＝plain。 */
export function packIdOf(script: Script): string {
  const p = script.meta?.pack;
  if (p === undefined) return 'dementia';
  if (p === null || p === '') return 'plain';
  return p;
}

/** 檢查並補齊題材包內容；不合格的欄位用預設值，問題列在 problems 裡。 */
export function normalizePack(raw: unknown, id: string, problems: string[] = []): Pack {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Pack, unknown>>;
  const effects = Array.isArray(r.effects) ? r.effects.filter((f): f is FxTag => ALL_FX.includes(f as FxTag)) : [];
  if (Array.isArray(r.effects) && effects.length !== r.effects.length) {
    problems.push(`題材包 ${id}：有不認得的效果（${r.effects.filter((f) => !ALL_FX.includes(f as FxTag)).join('、')}）`);
  }
  const curve = Array.isArray(r.degradation) ? r.degradation.filter((n): n is number => typeof n === 'number' && n >= 0 && n <= 1) : [];
  if (!curve.length) problems.push(`題材包 ${id}：degradation 要是 0 到 1 的數字清單，改用 [0]`);
  const texts = { ...DEFAULT_TEXTS, ...((r.texts && typeof r.texts === 'object' ? r.texts : {}) as Partial<PackTexts>) };
  return {
    id,
    name: typeof r.name === 'string' && r.name ? r.name : id,
    description: typeof r.description === 'string' ? r.description : '',
    effects,
    degradation: curve.length ? curve : [0],
    texts,
    docs: (r.docs && typeof r.docs === 'object' ? r.docs : undefined) as Pack['docs'],
  };
}

/** 第幾幕的退化係數。 */
export function degradationForAct(pack: Pack, act: number): number {
  const i = Math.max(0, Math.round(act) - 1);
  const c = pack.degradation;
  return c[Math.min(i, c.length - 1)] ?? 0;
}

// ───────── 目前使用的題材包（遊戲執行時） ─────────

let current: Pack = LEGACY_PACK;

export function currentPack(): Pack {
  return current;
}

export function setCurrentPack(pack: Pack): void {
  current = pack;
}

/** 只留下目前題材包啟用的效果。 */
export function activeFx<T extends FxTag>(list: readonly T[] | undefined): T[] {
  return (list ?? []).filter((f) => current.effects.includes(f));
}
