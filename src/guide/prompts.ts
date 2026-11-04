// 提示詞產生器（需求書 5.2）：每一步的提示詞都包含使用者前面填的內容、題材包的寫作準則與注意事項、格式規則。
// 通用的部分在這裡；題材專屬的部分來自題材包（packs/{id}/guide.md、cautions.md）。不碰 DOM。
import { assetCatalog, KIND_LABEL } from '../assetcatalog';
import type { Pack } from '../pack';
import type { Script } from '../types';
import { formatRules } from './format';

export type Length = 'short' | 'full';

export interface ThemeAnswer {
  title: string;
  pack: string;
  goal: string;
  length: Length;
  /** 給誰玩（可以空白）。 */
  audience?: string;
}

export interface Answers {
  theme?: ThemeAnswer;
  directions?: { raw: string; chosen: string };
  outline?: { raw: string };
  design?: { raw: string; checks?: string[] };
  script?: { applied: boolean; title?: string };
  art?: { raw: string; style: string };
}

export interface PromptInput {
  answers: Answers;
  pack: Pack;
  /** 題材包的說明文件（guide、cautions）。 */
  docs: Record<string, string>;
  /** 目前專案的劇本（美術需求用）。 */
  script?: Script;
}

export const LENGTH_TEXT: Record<Length, string> = {
  short: '短篇：約 5 分鐘、2 到 3 個場景、3 到 5 次選擇、一個到兩個結局',
  full: '完整作品：10 到 20 分鐘、三到四幕、10 到 20 次選擇、兩到三個結局',
};

/** 每一步都要放的作品資訊。 */
function brief(i: PromptInput): string {
  const t = i.answers.theme;
  return [
    '【作品資訊】',
    `- 作品名稱：${t?.title || '（還沒取名）'}`,
    `- 題材：${i.pack.name}（${i.pack.description}）`,
    `- 想讓玩家體會的事：${t?.goal || '（還沒寫）'}`,
    `- 長度：${LENGTH_TEXT[t?.length ?? 'short']}`,
    ...(t?.audience ? [`- 給誰玩：${t.audience}`] : []),
  ].join('\n');
}

function packDocs(i: PromptInput): string {
  const parts: string[] = [];
  if (i.docs.guide) parts.push(`【題材包的寫作準則】\n${i.docs.guide.trim()}`);
  if (i.docs.cautions) parts.push(`【題材包的注意事項】\n${i.docs.cautions.trim()}`);
  return parts.join('\n\n');
}

const INTRO =
  '你是協助我製作「同理體驗視覺小說」的編劇夥伴。這種遊戲讓玩家用第一人稱經歷某種處境，介面會跟著處境一起「崩壞」（例如名字想不起來、選項消失），讓玩家從裡面體會。';

function join(...blocks: (string | undefined | false)[]): string {
  return blocks.filter(Boolean).join('\n\n');
}

export function directionsPrompt(i: PromptInput): string {
  return join(
    INTRO,
    brief(i),
    packDocs(i),
    `【請你做的事】
請提出三個不同的故事方向。每個方向包含：
1. 一句話的故事（誰、在什麼處境、想做到什麼）
2. 主角是誰（年齡、身分、最在乎的人或事）
3. 處境怎麼一步步呈現在玩家眼前（用到哪些介面效果）
4. 玩家會做哪幾個關鍵選擇
5. 可能的結局（不要只有「失去」）

三個方向要明顯不同（例如不同的主角、不同的時間跨度、不同的關係）。先不要寫完整劇本。`,
  );
}

export function outlinePrompt(i: PromptInput): string {
  const d = i.answers.directions;
  return join(
    INTRO,
    brief(i),
    `【我選的故事方向】\n${d?.chosen || d?.raw || '（還沒選）'}`,
    packDocs(i),
    `【請你做的事】
請把這個方向寫成分場大綱。長度：${LENGTH_TEXT[i.answers.theme?.length ?? 'short']}。
每個場景寫：
- 場景代號（例如 a1_s01：第 1 幕第 1 場）、時間・地點
- 發生什麼（三到五句）
- 玩家在這裡的選擇：選項有哪些、各自影響什麼（數值或旗標）、會不會跳到別的場景
- 用到的介面效果，以及想讓玩家感受到什麼
- 轉折點標出來
最後列出結局：每個結局的名稱、條件（由哪些數值或旗標決定）、內容大意。`,
  );
}

export const DESIGN_CHECKLIST = [
  '每個效果都對應一個想讓玩家體會的感受，而不是為了炫技',
  '第一幕幾乎正常，崩壞逐幕加重',
  '物件的說明越後面越不可靠，物件圖與真相永遠正確',
  '每個隱藏選項都有一個玩家來得及先點到的物件',
  '每一組有隱藏選項的地方，至少還有兩個一般選項',
  '結局不是只有「失去」，留給主角仍然擁有的東西',
  '沒有把處境寫成笑點或刻板印象',
];

export function designPrompt(i: PromptInput): string {
  return join(
    INTRO,
    brief(i),
    `【分場大綱】\n${i.answers.outline?.raw || '（還沒有）'}`,
    packDocs(i),
    `【請你做的事】
請依分場大綱做一份設計表，用表格或清單：
1. 可以點的物件：在哪個場景、物件名稱、主角看到時說的話（可能是錯的）、真相、物件圖要畫什麼
2. 隱藏選項：在哪個場景、要先點過哪個物件才出現、選項文字、設定的旗標（hidden_ 開頭）、會影響哪個結局
3. 效果表：每個場景用哪些效果、用在哪一句、想讓玩家感受到什麼
4. 數值與旗標：有哪些數值（例如信任、清醒）、哪些選項會加減、結局怎麼判斷

最後用下面的檢查清單逐條自我檢查，寫出每一條「符合／不符合，以及怎麼改」：
${DESIGN_CHECKLIST.map((c, k) => `${k + 1}. ${c}`).join('\n')}`,
  );
}

export function scriptPrompt(i: PromptInput): string {
  return join(
    INTRO,
    brief(i),
    `【分場大綱】\n${i.answers.outline?.raw || '（還沒有）'}`,
    `【設計表】\n${i.answers.design?.raw || '（還沒有）'}`,
    packDocs(i),
    formatRules(i.pack),
    `【請你做的事】
依分場大綱與設計表，寫出完整的 script.json。
- meta.title 寫「${i.answers.theme?.title || '我的遊戲'}」，meta.pack 寫「${i.pack.id}」。
- 台詞要短，一句一個畫面；旁白不解釋症狀，讓玩家自己發現。
- 只輸出 JSON 本身，從 { 開始、到 } 結束，不要加任何說明文字，也不要用 \`\`\` 包起來。
- 如果太長，請確認最後一個 } 有寫出來。`,
  );
}

export function artPrompt(i: PromptInput): string {
  const items = i.script ? assetCatalog(i.script).filter((x) => x.kind === 'bg' || x.kind === 'char' || x.kind === 'fg') : [];
  const list = items.length
    ? items.map((x) => `- ${KIND_LABEL[x.kind]} ${x.name}：${x.description || '（沒有描述）'}。用在：${x.uses.join('、') || '—'}。規格：${x.spec}`).join('\n')
    : '（劇本還沒有圖片）';
  const style = i.answers.art?.style?.trim();
  return join(
    '你是協助我製作視覺小說的美術指導。',
    brief(i),
    `【劇本需要的圖片】\n${list}`,
    `【想要的畫風】\n${style || '（請建議一種適合這個題材、前後一致的畫風，例如淡彩手繪）'}`,
    `【請你做的事】
請產生兩份內容：
1. 美術說明（給人看）：整體畫風、色調、每張圖要畫什麼、構圖與注意事項。背景是寬圖（約 2304×1080，左右會被裁掉一點），立繪是透明背景的全身直式圖，物品是透明背景。物件圖要畫「真相」。
2. 生圖提示詞表（給生圖 AI）：每一張圖一行，格式「檔名｜英文提示詞」。所有提示詞用同一段畫風描述開頭，確保風格一致；立繪的同一個角色在不同表情之間要保持外型一致。`,
  );
}

/** 第 n 步的提示詞（只有需要 AI 的步驟有）。 */
export function promptFor(stepId: string, i: PromptInput): string | null {
  switch (stepId) {
    case 'directions':
      return directionsPrompt(i);
    case 'outline':
      return outlinePrompt(i);
    case 'design':
      return designPrompt(i);
    case 'script':
      return scriptPrompt(i);
    case 'art':
      return artPrompt(i);
    default:
      return null;
  }
}
