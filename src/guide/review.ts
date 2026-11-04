// 班級展示的互評表（需求書 6-8）：評分項目、結果整理成表格（CSV）。不碰 DOM。

export interface ShowcaseWork {
  /** 這個作品在瀏覽器裡的資料庫代號。 */
  id: string;
  title: string;
  group: string;
  /** 載入的檔名。 */
  file: string;
  addedAt: number;
}

export interface Review {
  work: string;
  /** 評的人或組別。 */
  reviewer: string;
  /** 每個評分項目 1～3 分。 */
  scores: Record<string, number>;
  /** 哪裡最有感覺。 */
  feel: string;
  /** 一個建議。 */
  suggest: string;
  at: number;
}

/** 評分項目：先說感受，再看做法。分數只有三級，避免同學互打太細的分數。 */
export const REVIEW_CRITERIA: { id: string; label: string; levels: [string, string, string] }[] = [
  { id: 'feel', label: '玩的時候有感覺', levels: ['還沒有', '有一點', '很有感覺'] },
  { id: 'clear', label: '故事看得懂、選擇有意義', levels: ['常常看不懂', '大致看得懂', '很清楚'] },
  { id: 'respect', label: '尊重處境、沒有刻板印象', levels: ['有疑慮', '大致可以', '很尊重'] },
  { id: 'fx', label: '效果用在對的地方', levels: ['太多或不搭', '還可以', '恰到好處'] },
];

export const REVIEW_PROMPTS = {
  feel: '哪一個地方最有感覺？為什麼？',
  suggest: '給他們一個具體的建議',
};

/** CSV 一格：有逗號、引號、換行時加引號。 */
function cell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 互評結果整理成 CSV（Excel、Google 試算表都能開；開頭加 BOM，中文不會變亂碼）。 */
export function reviewsCsv(works: ShowcaseWork[], reviews: Review[]): string {
  const head = ['作品', '組別', '評的人', ...REVIEW_CRITERIA.map((c) => c.label), '最有感覺的地方', '建議', '時間'];
  const rows = reviews.map((r) => {
    const w = works.find((x) => x.id === r.work);
    return [
      w?.title ?? '（已移除的作品）',
      w?.group ?? '',
      r.reviewer,
      ...REVIEW_CRITERIA.map((c) => r.scores[c.id] ?? ''),
      r.feel,
      r.suggest,
      new Date(r.at).toLocaleString('zh-TW', { hour12: false }),
    ];
  });
  return `﻿${[head, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

/** 每個作品的平均分數（每個項目）與評的次數。 */
export function reviewSummary(work: string, reviews: Review[]): { count: number; avg: Record<string, number | null> } {
  const list = reviews.filter((r) => r.work === work);
  const avg: Record<string, number | null> = {};
  for (const c of REVIEW_CRITERIA) {
    const xs = list.map((r) => r.scores[c.id]).filter((x): x is number => typeof x === 'number');
    avg[c.id] = xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
  }
  return { count: list.length, avg };
}

/** 班級展示的作品存在哪個瀏覽器資料庫。 */
export function showcaseDb(id: string): string {
  return `vn-showcase-${id}`;
}
