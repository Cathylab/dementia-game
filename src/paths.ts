// 目前載入的是哪一個專案資料夾（examples/… 或 templates/…），以及它的素材在哪裡。
// 引擎所有「去網站上找檔案」的地方都經過這裡，不再寫死 public/。
import { EMBED } from './embed';
import { urlParam } from './util';

/** 沒有指定時載入的 Demo。 */
export const DEFAULT_PROJECT = 'examples/寫給未來的我';

/** 只接受 examples/ 或 templates/ 底下一層的資料夾，避免網址參數指到別的地方。 */
export function isProjectDir(dir: string): boolean {
  if (!/^(examples|templates)\/[^/\\.][^/\\]*$/.test(dir)) return false;
  // 離線版只認得建置時放進去的專案
  return EMBED ? dir in EMBED.projects : true;
}

let current = pickProject(urlParam('project'));

function pickProject(param: string | null): string {
  const dir = (param ?? '').trim().replace(/\/+$/, '');
  if (dir && isProjectDir(dir)) return dir;
  return EMBED && isProjectDir(EMBED.defaultProject) ? EMBED.defaultProject : DEFAULT_PROJECT;
}

/** 目前專案在 repo 裡的資料夾，例如 examples/寫給未來的我。 */
export function projectDir(): string {
  return current;
}

/** 測試或之後的引導網站用：換成另一個專案資料夾。 */
export function setProjectDir(dir: string): void {
  current = pickProject(dir);
}

/** 網址：目前專案的資料夾（結尾有 /）。 */
export function projectUrl(): string {
  return `${import.meta.env.BASE_URL}${encodePath(current)}/`;
}

export function scriptUrl(): string {
  return `${projectUrl()}script.json`;
}

/** 網址：目前專案的素材資料夾，例如 …/examples/寫給未來的我/assets（結尾沒有 /）。 */
export function assetBase(): string {
  return `${projectUrl()}assets`;
}

/** 給人看的位置：素材放在 repo 的哪個資料夾，例如 examples/寫給未來的我/assets/voice/。 */
export function assetFolderLabel(folder: string): string {
  return `${current}/assets/${folder}/`;
}

function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}
