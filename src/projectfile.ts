// 專案檔（.vnproj）：一個檔案裝下整個遊戲——劇本＋所有素材。內容其實是 zip，就像 .pptx。
//
//   project.json   { format, version, title, exportedAt }
//   script.json    劇本
//   assets/bg/…  assets/char/…  assets/fg/…  assets/voice/…  assets/music/…  assets/sfx/…
//
// 這個檔案只負責「打包／拆包」，不管檔案從哪裡來、要存去哪裡。
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { formatScript } from './editable.ts';
import type { Script } from './types.ts';

export const PROJECT_FORMAT = 'vn-project';
export const PROJECT_VERSION = 1;
export const PROJECT_EXT = 'vnproj';

export interface ProjectInfo {
  format: typeof PROJECT_FORMAT;
  version: number;
  title: string;
  exportedAt: string;
  /** 組別（課堂用，班級展示時顯示）。 */
  group?: string;
}

export interface Project {
  script: Script;
  /** 路徑同 {專案}/assets/ 底下，例如 bg/kitchen_morning.webp。 */
  files: Map<string, Blob>;
  /** 組別（課堂用）。 */
  group?: string;
}

/** 已經壓縮過的格式不再壓縮（省時間，也不會變小）。 */
const STORED = /\.(webp|png|jpe?g|gif|mp3|ogg|m4a|wav)$/i;
const ASSET_PATH = /^(bg|char|fg|voice|music|sfx)\/[^/]+\.[a-z0-9]+$/i;

export async function packProject(project: Project, now = new Date()): Promise<Blob> {
  const enc = new TextEncoder();
  const info: ProjectInfo = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    title: project.script.meta?.title ?? '',
    exportedAt: now.toISOString(),
    ...(project.group ? { group: project.group } : {}),
  };
  const zip: Zippable = {
    'project.json': enc.encode(`${JSON.stringify(info, null, 2)}\n`),
    'script.json': enc.encode(formatScript(project.script)),
  };
  for (const [path, blob] of [...project.files].sort(([a], [b]) => a.localeCompare(b))) {
    const data = new Uint8Array(await blob.arrayBuffer());
    zip[`assets/${path}`] = STORED.test(path) ? [data, { level: 0 }] : data;
  }
  const bytes = zipSync(zip, { level: 6 });
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

/** 拆開專案檔。不是專案檔、或版本太新時丟出看得懂的錯誤。 */
export async function unpackProject(file: Blob): Promise<Project & { info: ProjectInfo }> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error('這不是專案檔（無法解壓縮）');
  }
  // 有些壓縮工具會多包一層資料夾：找到 script.json 所在的那一層
  const scriptPath = Object.keys(entries).find((p) => /(^|\/)script\.json$/.test(p) && !p.includes('__MACOSX'));
  if (!scriptPath) throw new Error('專案檔裡找不到 script.json');
  const root = scriptPath.slice(0, -'script.json'.length);
  const dec = new TextDecoder();
  const read = (p: string) => (entries[root + p] ? dec.decode(entries[root + p]) : null);

  let info: ProjectInfo;
  try {
    const raw = read('project.json');
    info = raw ? (JSON.parse(raw) as ProjectInfo) : { format: PROJECT_FORMAT, version: 1, title: '', exportedAt: '' };
  } catch {
    throw new Error('專案檔的 project.json 壞掉了');
  }
  if (info.format !== PROJECT_FORMAT) throw new Error('這不是這個工具的專案檔');
  if (info.version > PROJECT_VERSION) throw new Error(`這個專案檔是較新的版本（${info.version}），請先更新網站`);

  let script: Script;
  try {
    script = JSON.parse(read('script.json')!) as Script;
  } catch {
    throw new Error('專案檔的 script.json 不是正確的 JSON');
  }
  if (!script?.meta || !Array.isArray(script.scenes)) throw new Error('專案檔的 script.json 缺少 meta 或 scenes');

  const files = new Map<string, Blob>();
  for (const [p, data] of Object.entries(entries)) {
    if (!p.startsWith(`${root}assets/`)) continue;
    const path = p.slice(`${root}assets/`.length);
    if (!ASSET_PATH.test(path)) continue;
    files.set(path, new Blob([data as Uint8Array<ArrayBuffer>], { type: mimeOf(path) }));
  }
  return { info, script, files };
}

export function mimeOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return (
    {
      webp: 'image/webp',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      mp3: 'audio/mpeg',
      ogg: 'audio/ogg',
      wav: 'audio/wav',
      m4a: 'audio/mp4',
    }[ext] ?? 'application/octet-stream'
  );
}

/** 專案檔的檔名：用遊戲標題，去掉檔名不能用的字。 */
export function projectFileName(title: string): string {
  const safe = title.replace(/[\\/:*?"<>|]+/g, '').trim() || 'project';
  return `${safe}.${PROJECT_EXT}`;
}
