// 引導流程做到哪裡：存在本機專案裡（和劇本、素材在一起），關掉瀏覽器再打開還在。
import type { ProjectStore } from '../projectstore';

export interface GuideState {
  version: 1;
  /** 目前在第幾步（1 起算）。 */
  step: number;
  /** 走到過的最後一步。 */
  maxStep: number;
  startFrom: 'blank' | 'example';
  /** 用「先跳過」略過的步驟。 */
  skipped: number[];
  /** 每一步填的內容（之後的步驟會用到）。 */
  answers: Record<string, unknown>;
  /** full＝完整的九個步驟；class＝課堂模式（任務卡）。舊資料沒有這個欄位＝full。 */
  mode?: 'full' | 'class';
  /** 課堂模式：目前在第幾堂（1 起算）。 */
  lesson?: number;
  /** 課堂模式：任務卡打勾的項目（「l1.theme」這種代號）。 */
  done?: string[];
  updatedAt: number;
}

const KEY = 'guide';

export function newGuideState(startFrom: GuideState['startFrom'], mode: GuideState['mode'] = 'full'): GuideState {
  return {
    version: 1,
    step: 1,
    maxStep: 1,
    startFrom,
    skipped: [],
    // 課堂模式預設短篇
    answers: mode === 'class' ? { theme: { title: '', pack: 'plain', goal: '', length: 'short' } } : {},
    mode,
    lesson: 1,
    done: [],
    updatedAt: Date.now(),
  };
}

export async function loadGuideState(store: ProjectStore): Promise<GuideState | null> {
  try {
    const s = await store.loadExtra<GuideState>(KEY);
    return s && s.version === 1 ? s : null;
  } catch {
    return null;
  }
}

export async function saveGuideState(store: ProjectStore, state: GuideState): Promise<void> {
  state.updatedAt = Date.now();
  await store.saveExtra(KEY, state);
}
