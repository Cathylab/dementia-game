// 成效評估問卷（需求書 7-7）：玩前、玩後的簡短問卷，題目放在專案的 survey.json（可以替換的內容檔）。
// 回答匿名、只存在這個瀏覽器（localStorage），不送到任何伺服器；開發者面板可以看統計、匯出 CSV。
// 這個檔案不碰 DOM（localStorage 與 fetch 例外）。

export type QuestionType = 'scale' | 'choice' | 'text';

export interface SurveyQuestion {
  /** 題目代號（英數），匯出 CSV 的欄名。 */
  id: string;
  text: string;
  /** scale＝1～5（或 min～max）的量表；choice＝單選；text＝簡答。 */
  type: QuestionType;
  /** choice 的選項。 */
  options?: string[];
  min?: number;
  max?: number;
  /** 量表兩端的文字，例如「完全不同意」「非常同意」。 */
  minLabel?: string;
  maxLabel?: string;
  /** 必答（預設不必答）。 */
  required?: boolean;
}

export interface Survey {
  title?: string;
  /** 問卷開頭的說明（匿名、只存在這台電腦等，內容檔自己寫）。 */
  intro?: string;
  /** 玩之前的題目。 */
  pre?: SurveyQuestion[];
  /** 玩之後的題目；同一題的 id 可以和 pre 一樣，方便比較前後。 */
  post?: SurveyQuestion[];
}

export type Answers = Record<string, string | number>;

/** 一位玩家的一次遊玩。 */
export interface SurveySession {
  id: string;
  startedAt: number;
  pre?: Answers;
  post?: Answers;
  /** 走到的結局 id。 */
  ending?: string;
}

/** 檢查問卷檔，回傳問題（空陣列＝沒問題）。 */
export function validateSurvey(s: unknown): string[] {
  const problems: string[] = [];
  if (!s || typeof s !== 'object') return ['問卷檔必須是一個物件 { title, intro, pre, post }'];
  const survey = s as Survey;
  for (const part of ['pre', 'post'] as const) {
    const list = survey[part];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      problems.push(`${part} 必須是題目清單`);
      continue;
    }
    const ids = new Set<string>();
    list.forEach((q, i) => {
      const where = `${part}[${i}]`;
      if (!q || typeof q !== 'object') return problems.push(`${where}：必須是物件`);
      if (!q.id || !/^[A-Za-z0-9_-]+$/.test(q.id)) problems.push(`${where}：id 只能用英文字母、數字、底線`);
      else if (ids.has(q.id)) problems.push(`${where}：id "${q.id}" 重複`);
      ids.add(q.id);
      if (!q.text) problems.push(`${where}：缺少 text`);
      if (!['scale', 'choice', 'text'].includes(q.type)) problems.push(`${where}：type 必須是 scale、choice 或 text`);
      if (q.type === 'choice' && !(Array.isArray(q.options) && q.options.length >= 2)) problems.push(`${where}：choice 至少要有兩個 options`);
      if (q.type === 'scale') {
        const [min, max] = scaleRange(q);
        if (!(max > min) || max - min > 10) problems.push(`${where}：量表的 min～max 不合理（最多 11 格）`);
      }
    });
  }
  return problems;
}

export function scaleRange(q: SurveyQuestion): [number, number] {
  return [q.min ?? 1, q.max ?? 5];
}

/** 有沒有任何題目。 */
export function hasQuestions(s: Survey | null, part: 'pre' | 'post'): boolean {
  return !!s && Array.isArray(s[part]) && s[part]!.length > 0;
}

const PREFIX = 'vn-survey:';

/** 這個遊戲的問卷回答（存在這個瀏覽器）。 */
export class SurveyStore {
  constructor(private readonly key: string) {}

  all(): SurveySession[] {
    try {
      const raw = JSON.parse(localStorage.getItem(PREFIX + this.key) ?? '[]') as SurveySession[];
      return Array.isArray(raw) ? raw.filter((s) => s && typeof s.id === 'string') : [];
    } catch {
      return [];
    }
  }

  private write(list: SurveySession[]): boolean {
    try {
      localStorage.setItem(PREFIX + this.key, JSON.stringify(list));
      return true;
    } catch {
      return false;
    }
  }

  /** 新增或更新一次遊玩的回答。 */
  save(session: SurveySession): boolean {
    const list = this.all();
    const i = list.findIndex((s) => s.id === session.id);
    if (i >= 0) list[i] = session;
    else list.push(session);
    return this.write(list);
  }

  clear(): boolean {
    return this.write([]);
  }
}

export function newSession(): SurveySession {
  return { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, startedAt: Date.now() };
}

/** 統計：每一題的回答數、量表平均、單選各選項人數。 */
export interface QuestionStat {
  part: 'pre' | 'post';
  q: SurveyQuestion;
  count: number;
  average?: number;
  counts?: Record<string, number>;
}

export function surveyStats(survey: Survey, sessions: SurveySession[]): QuestionStat[] {
  const out: QuestionStat[] = [];
  for (const part of ['pre', 'post'] as const) {
    for (const q of survey[part] ?? []) {
      const values = sessions.map((s) => s[part]?.[q.id]).filter((v) => v !== undefined && v !== '');
      const stat: QuestionStat = { part, q, count: values.length };
      if (q.type === 'scale') {
        const nums = values.map(Number).filter((n) => Number.isFinite(n));
        stat.average = nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : undefined;
      } else if (q.type === 'choice') {
        stat.counts = Object.fromEntries((q.options ?? []).map((o) => [o, values.filter((v) => v === o).length]));
      }
      out.push(stat);
    }
  }
  return out;
}

/** 匯出成 CSV（Excel、Google 試算表可以開）。每一列是一次遊玩，欄位是 pre_題目代號、post_題目代號。 */
export function surveyCsv(survey: Survey, sessions: SurveySession[]): string {
  const cols = [
    ...(survey.pre ?? []).map((q) => ({ part: 'pre' as const, q })),
    ...(survey.post ?? []).map((q) => ({ part: 'post' as const, q })),
  ];
  const esc = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['session', 'started_at', 'ending', ...cols.map((c) => `${c.part}_${c.q.id}`)];
  const rows = sessions.map((s) => [s.id, new Date(s.startedAt).toISOString(), s.ending ?? '', ...cols.map((c) => s[c.part]?.[c.q.id])]);
  // 開頭加 BOM，Excel 才會用 UTF-8 讀中文
  return '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
}
