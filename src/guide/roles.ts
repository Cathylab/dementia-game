// 分組角色卡與刻板印象檢查清單的內容（需求書 6-3、6-4）。不碰 DOM，測試可以直接讀。
import { LESSONS, type LessonTask } from './lessons';

// ───────── 刻板印象檢查清單 ─────────

export const STEREOTYPE_CHECKLIST = [
  '主角不只是「病人」或「受害者」：有自己的個性、在乎的人事物、想做到的事',
  '沒有把這個處境當成笑點，也沒有讓玩家去笑主角',
  '症狀與處境都有資料來源，沒有誇大，也沒有過度簡化',
  '身邊的人反應多樣：不是只有好人或壞人，也會疲憊、困惑、努力',
  '用詞尊重：沒有用貶低的稱呼或標籤',
  '結局不是只有悲慘，也不是奇蹟般地「好起來」',
  '如果有這個處境的人玩到，他會覺得被理解，而不是被嘲笑或被同情',
];

// ───────── 分組角色卡 ─────────

export const ROLES: { id: NonNullable<LessonTask['role']>; title: string; summary: string; tips: string[] }[] = [
  {
    id: '編劇',
    title: '編劇',
    summary: '把全組的想法寫成故事：場景、台詞、選擇與結局。',
    tips: ['台詞要短，一句一個畫面', '不要直接說出症狀，讓玩家自己發現', '每個選擇都要有意義：選了會不一樣'],
  },
  {
    id: '美術',
    title: '美術',
    summary: '負責畫面：背景、角色、物品，以及「這一場的感覺」。',
    tips: ['手繪拍照就可以，不用很漂亮', '同一個角色前後的樣子要一致', '想一想：效果要用在最需要「感覺到」的地方'],
  },
  {
    id: '查證',
    title: '查證',
    summary: '確認故事寫的是真的：每個症狀或處境都有資料來源，沒有刻板印象。',
    tips: ['填「資料來源表」：來源名稱、網址、查證日期', '看到誇大或好笑的寫法要提出來', '試玩後帶全組做「刻板印象檢查清單」'],
  },
  {
    id: '測試員',
    title: '測試員',
    summary: '從玩家的角度玩，找出讀不順、看不懂、卡住的地方。',
    tips: ['每一個結局都要玩到', '記下：哪裡有感覺？哪裡看不懂？', '跨組試玩時，請對方先說感受、再說建議'],
  },
];

/** 某個角色在每一堂要做的事（從任務卡整理）。全組的任務也列出來。 */
export function roleTasks(role: string): { lesson: number; title: string; tasks: LessonTask[] }[] {
  return LESSONS.map((l, i) => ({ lesson: i + 1, title: l.title, tasks: l.tasks.filter((t) => t.role === role || t.role === '全組') })).filter(
    (x) => x.tasks.length,
  );
}

