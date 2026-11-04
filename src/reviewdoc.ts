// 專家審閱關卡（需求書 7-2）：把劇本整理成「審閱用」的純文字文件，讓病友、家屬或顧問在上面留意見。
// 開頭是題材包的簽核清單（packs/{id}/review.md，可以替換的內容檔），後面依場景列出台詞、選項、可以點的物件與結局。
// 這個檔案不碰 DOM。
import { isChoice, isMemoryReview, isText, type Script } from './types';

const RULE = '────────────────────────────────────────';

/** 審閱用文件（純文字，UTF-8）。checklist 是簽核清單的 Markdown（沒有就用通用的幾項）。 */
export function reviewText(script: Script, checklist?: string, date = new Date()): string {
  const names = new Map((script.characters ?? []).map((c) => [c.id, c.name]));
  const who = (s: string) => (s === 'narrator' ? '旁白' : s === 'player' ? '主角（心裡）' : names.get(s) ?? s);
  const sceneName = new Map(script.scenes.map((s) => [s.id, s.title ?? s.id]));
  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);

  push(`《${script.meta.title}》審閱用劇本`, `產生日期：${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`, '');
  push('怎麼用：直接在這份文件上寫意見（每段後面有「意見：」可以填），或印出來手寫。', '審閱完請填最後的「簽核」。', '');
  push(RULE, '簽核清單', RULE, '');
  push(...checklistLines(checklist), '');

  push(RULE, '登場人物', RULE, '');
  for (const c of script.characters ?? []) {
    push(`・${c.name}${c.relation ? `（${c.relation}）` : ''}${c.trait ? `：${c.trait}` : ''}`);
  }
  push('', '意見：', '');

  let act = 0;
  for (const scene of script.scenes) {
    const a = scene.act ?? 1;
    if (a !== act) {
      act = a;
      push(RULE, `第 ${a} 幕`, RULE, '');
    }
    push(`【${scene.title ?? scene.id}】（${scene.id}）`);
    let n = 0;
    scene.lines.forEach((line) => {
      const cond = line.if ? `　〔只在特定情況出現〕` : '';
      if (isChoice(line)) {
        push(`　〈選擇〉${line.prompt ? line.prompt : ''}${cond}`);
        line.choice.forEach((opt, j) => {
          const to = opt.goto === '@ending' ? '判定結局' : opt.goto ? `→ ${sceneName.get(opt.goto) ?? opt.goto}` : '';
          const lock = opt.requires ? '（要先看過某些東西才能選）' : '';
          push(`　　${j + 1}. ${opt.text}${lock}${to ? `　${to}` : ''}`);
        });
      } else if (isMemoryReview(line)) {
        push(`　〈記憶對照：玩家看過的東西，由${who(line.memoryReview.speaker)}說出真相〉${line.memoryReview.intro ? `${line.memoryReview.intro}` : ''}`);
      } else if (isText(line)) {
        n++;
        push(`　${n}. ${who(line.speaker)}：${line.text}${cond}`);
      }
    });
    for (const o of scene.objects ?? []) {
      push(`　〈可以點的東西〉${o.label}：${o.description}${o.truth ? `　／真相：${o.truth}` : ''}`);
    }
    push('　意見：', '');
  }

  push(RULE, '結局', RULE, '');
  for (const e of script.endings ?? []) {
    push(`・${e.title}${e.description ? `：${e.description}` : ''}`);
  }
  push('', '意見：', '');

  push(RULE, '簽核', RULE, '');
  push('審閱人（可以只寫身分，例如「家屬」「護理師」）：', '日期：', '整體意見：', '', '□ 可以發佈　□ 修改後可以發佈　□ 需要再審一次');
  return out.join('\n') + '\n';
}

/** 簽核清單：Markdown 的清單項目變成「□ 項目」，標題照留。沒有清單時用通用的幾項。 */
function checklistLines(md?: string): string[] {
  if (!md?.trim()) {
    return [
      '□ 症狀與情境的描寫正確，沒有誇大或錯誤的醫療資訊。',
      '□ 沒有讓病友或家屬感到被嘲弄、被貶低的地方。',
      '□ 角色的反應符合真實的照顧經驗。',
      '□ 結局與資源頁的資訊（專線、網站）正確。',
    ];
  }
  return md
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*]\s+\[[ xX]\]\s*/, '□ ').replace(/^\s*[-*]\s+/, '□ ').replace(/^#+\s*/, ''))
    .filter((l, i, all) => l.trim() || (i > 0 && all[i - 1].trim()));
}

/** 下載用的檔名。 */
export function reviewFileName(script: Script): string {
  return `${(script.meta.title || '劇本').replace(/[\\/:*?"<>|]/g, '')}-審閱用.txt`;
}
