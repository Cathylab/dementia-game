// 本機素材：開啟的專案檔裡的素材、開發者面板上傳的素材。
// 圖片、配音、音樂找檔案時都先看這裡，沒有才去網站的 public/assets/ 找。
// 路徑格式和 public/assets/ 底下一樣：{資料夾}/{名稱}.{副檔名}，例如 bg/kitchen_morning.webp。

const files = new Map<string, Blob>();
const urls = new Map<string, string>();
const listeners = new Set<(path: string) => void>();

export function putLocalFile(path: string, blob: Blob): void {
  const old = urls.get(path);
  if (old) URL.revokeObjectURL(old);
  // 同名不同副檔名（例如先放 png 再放 webp）只留最新的
  const base = stripExt(path);
  for (const p of [...files.keys()]) {
    if (p !== path && stripExt(p) === base) {
      URL.revokeObjectURL(urls.get(p) ?? '');
      files.delete(p);
      urls.delete(p);
    }
  }
  files.set(path, blob);
  urls.set(path, URL.createObjectURL(blob));
  for (const l of listeners) l(path);
}

/** 找 {folder}/{name}.{ext}，依 exts 的順序；回傳可以直接用的 blob: 網址。 */
export function localFileUrl(folder: string, name: string, exts: readonly string[]): string | null {
  for (const ext of exts) {
    const url = urls.get(`${folder}/${name}.${ext}`);
    if (url) return url;
  }
  return null;
}

export function localFiles(): ReadonlyMap<string, Blob> {
  return files;
}

export function hasLocalFiles(): boolean {
  return files.size > 0;
}

/** 有新的本機素材時通知（例如存進瀏覽器裡的專案）。 */
export function onLocalFile(listener: (path: string) => void): void {
  listeners.add(listener);
}

function stripExt(path: string): string {
  return path.replace(/\.[^./]+$/, '');
}
