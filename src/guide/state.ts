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
  updatedAt: number;
}

const KEY = 'guide';

export function newGuideState(startFrom: GuideState['startFrom']): GuideState {
  return { version: 1, step: 1, maxStep: 1, startFrom, skipped: [], answers: {}, updatedAt: Date.now() };
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
