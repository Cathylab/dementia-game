// 老師代貼提示詞（需求書 6-6）：未成年學生使用 AI 服務常有年齡限制，由老師代為把提示詞貼給 AI。
// 學生下載「代貼單」交給老師 → 老師在「老師工作台」貼給 AI、看過回答 → 下載「回覆檔」還給學生 → 學生讀取回覆。
// 全部是純文字檔，沒有網路的教室也能用（用隨身碟、雲端硬碟或學校的作業系統傳）。這個檔案不碰 DOM。

export interface RelayRequest {
  group: string;
  title: string;
  /** 步驟代號（outline、script…）與名稱。 */
  step: string;
  stepTitle: string;
  prompt: string;
}

export interface RelayReply {
  group: string;
  title: string;
  step: string;
  stepTitle: string;
  answer: string;
}

const REQ = '【代貼單】';
const REP = '【老師的回覆】';
const BEGIN_P = '──── 提示詞開始（請整段貼給 AI）────';
const END_P = '──── 提示詞結束 ────';
const BEGIN_A = '──── 回答開始 ────';
const END_A = '──── 回答結束 ────';

export function requestText(r: RelayRequest): string {
  return [
    REQ,
    `組別：${r.group || '（沒有填）'}`,
    `作品：${r.title || '（沒有名稱）'}`,
    `步驟：${r.stepTitle}（${r.step}）`,
    '',
    '給老師：請把下面的提示詞整段貼給 AI，看過回答適合學生後，在「老師工作台」把回答貼回來，下載回覆檔交還給這一組。',
    '',
    BEGIN_P,
    r.prompt,
    END_P,
    '',
  ].join('\n');
}

export function replyText(r: RelayReply): string {
  return [REP, `組別：${r.group || '（沒有填）'}`, `作品：${r.title || '（沒有名稱）'}`, `步驟：${r.stepTitle}（${r.step}）`, '', BEGIN_A, r.answer, END_A, ''].join('\n');
}

function header(text: string, key: string): string {
  return text.match(new RegExp(`^${key}：(.*)$`, 'm'))?.[1].trim() ?? '';
}

function between(text: string, begin: string, end: string): string | null {
  const i = text.indexOf(begin);
  const j = text.lastIndexOf(end);
  if (i < 0 || j < 0 || j < i) return null;
  return text.slice(i + begin.length, j).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
}

function stepOf(text: string): { step: string; stepTitle: string } {
  const raw = header(text, '步驟');
  const m = raw.match(/^(.*)（([A-Za-z_]+)）$/);
  return m ? { stepTitle: m[1], step: m[2] } : { stepTitle: raw, step: '' };
}

const blankAsEmpty = (s: string) => (s.startsWith('（') && s.endsWith('）') ? '' : s);

/** 讀代貼單；不是代貼單時回傳 null。 */
export function parseRequest(text: string): RelayRequest | null {
  if (!text.includes(REQ)) return null;
  const prompt = between(text, BEGIN_P, END_P);
  if (prompt === null) return null;
  return { group: blankAsEmpty(header(text, '組別')), title: blankAsEmpty(header(text, '作品')), ...stepOf(text), prompt };
}

/** 讀回覆檔；不是回覆檔時回傳 null。 */
export function parseReply(text: string): RelayReply | null {
  if (!text.includes(REP)) return null;
  const answer = between(text, BEGIN_A, END_A);
  if (answer === null) return null;
  return { group: blankAsEmpty(header(text, '組別')), title: blankAsEmpty(header(text, '作品')), ...stepOf(text), answer };
}

/** 檔名不能用的字去掉。 */
export function relayFileName(kind: '代貼單' | '回覆', r: { group: string; stepTitle: string }): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '').trim();
  return `${kind}-${clean(r.group) || '未填組別'}-${clean(r.stepTitle) || '步驟'}.txt`;
}
