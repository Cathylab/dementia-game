// 讀目前專案的成效評估問卷（survey.json）。和 survey.ts 分開，因為這裡要用到網址（survey.ts 給測試在 Node 裡用）。
import { EMBED, FILE_MODE } from './embed';
import { projectDir, projectUrl } from './paths';
import { validateSurvey, type Survey } from './survey';

/**
 * 讀目前專案的 survey.json。沒有這個檔案、格式不對時回傳 null（遊戲照常，只是沒有問卷）。
 * 離線版、匯出的版本從內嵌資料讀。
 */
export async function loadSurvey(): Promise<Survey | null> {
  let data: unknown = null;
  const embedded = EMBED?.projects[EMBED.player ? Object.keys(EMBED.projects)[0] : projectDir()];
  if (embedded) data = embedded.survey ?? null;
  else if (!FILE_MODE) {
    try {
      // projects.json 記著哪些專案有問卷，有才去讀（沒有問卷就不發請求，不會有 404）
      const list = (await (await fetch(`${import.meta.env.BASE_URL}projects.json`, { cache: 'no-cache' })).json()) as { dir: string; survey?: boolean }[];
      if (list.some((p) => p.dir === projectDir() && p.survey)) {
        // survey.json 和 script.json 放在同一層
        const res = await fetch(`${projectUrl()}survey.json`, { cache: 'no-cache' });
        if (res.ok) data = await res.json();
      }
    } catch {
      data = null;
    }
  }
  if (!data) return null;
  const problems = validateSurvey(data);
  if (problems.length) {
    console.warn('[survey] 問卷檔有問題，這次不顯示問卷：', problems);
    return null;
  }
  return data as Survey;
}

