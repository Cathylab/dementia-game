// 讀目前專案選用的內容檔（survey.json 成效評估問卷、publish.json 正式發佈資訊）。
// 網站版：projects.json 的 extras 記著哪些專案有哪些檔，有才去讀（不會 404）。離線版、匯出的版本從內嵌資料讀。
// 本機專案（引導網站做的遊戲）目前沒有這些檔。
import { EMBED, FILE_MODE } from './embed';
import { projectDir, projectUrl } from './paths';
import { validatePublish, type Publish } from './publish';
import { validateSurvey, type Survey } from './survey';

let listing: Promise<{ dir: string; extras?: string[] }[]> | null = null;

async function loadExtra(file: 'survey.json' | 'publish.json', key: 'survey' | 'publish'): Promise<unknown> {
  const embedded = EMBED?.projects[EMBED.player ? Object.keys(EMBED.projects)[0] : projectDir()];
  if (embedded) return embedded[key] ?? null;
  if (FILE_MODE) return null;
  try {
    listing ??= fetch(`${import.meta.env.BASE_URL}projects.json`, { cache: 'no-cache' }).then((r) => r.json());
    const list = await listing;
    if (!list.some((p) => p.dir === projectDir() && p.extras?.includes(file))) return null;
    // 和 script.json 放在同一層
    const res = await fetch(`${projectUrl()}${file}`, { cache: 'no-cache' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** 成效評估問卷；沒有或格式不對時回傳 null（遊戲照常）。 */
export async function loadSurvey(): Promise<Survey | null> {
  const data = await loadExtra('survey.json', 'survey');
  if (!data) return null;
  const problems = validateSurvey(data);
  if (problems.length) {
    console.warn('[survey] 問卷檔有問題，這次不顯示問卷：', problems);
    return null;
  }
  return data as Survey;
}

/** 正式發佈資訊（單位、結尾資源頁）；沒有或格式不對時回傳 null。 */
export async function loadPublish(): Promise<Publish | null> {
  const data = await loadExtra('publish.json', 'publish');
  if (!data) return null;
  const problems = validatePublish(data);
  if (problems.length) {
    console.warn('[publish] publish.json 有問題，這次不顯示：', problems);
    return null;
  }
  return data as Publish;
}
