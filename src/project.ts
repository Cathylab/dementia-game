// 目前在玩／在編輯哪一個遊戲：
// - site：網站上的遊戲（public/script.json＋public/assets/）。修改只能下載檔案再放進 GitHub。
// - local：開啟過的專案檔，存在 ProjectStore（目前是這個瀏覽器）。修改、上傳的素材自動存進去。
import { ASSET_KINDS, assetNames, type AssetKind } from './assetnames';
import { MUSIC_EXTENSIONS, VOICE_EXTENSIONS } from './audio';
import { hasLocalFiles, localFiles, onLocalFile, putLocalFile } from './localfiles';
import { FILE_MODE } from './embed';
import { assetBase } from './paths';
import { packProject, projectFileName, unpackProject, type Project } from './projectfile';
import type { ProjectStore } from './projectstore';
import { IMAGE_EXTENSIONS } from './script';
import { isText, type Script } from './types';

export type ProjectMode = 'site' | 'local';

const EXTS: Record<AssetKind, readonly string[]> = {
  bg: IMAGE_EXTENSIONS,
  char: IMAGE_EXTENSIONS,
  fg: IMAGE_EXTENSIONS,
  voice: VOICE_EXTENSIONS,
  music: MUSIC_EXTENSIONS,
  sfx: VOICE_EXTENSIONS,
};

export class ProjectSession {
  private constructor(
    readonly store: ProjectStore,
    readonly mode: ProjectMode,
    public savedAt: number,
    /** 存進 store 失敗時的訊息（例如空間不夠）。 */
    public lastError = '',
  ) {}

  /**
   * 開始：store 裡有專案就用它（網址加 ?site=1 可以略過），否則載入網站上的 script.json。
   * 專案裡的素材放進本機素材，之後新增的素材自動存回 store。
   */
  static async start(store: ProjectStore, loadSiteScript: () => Script | Promise<Script>, skipLocal = false): Promise<{ session: ProjectSession; script: Script }> {
    const stored = skipLocal ? null : await store.load().catch(() => null);
    if (!stored) {
      return { session: new ProjectSession(store, 'site', 0), script: await loadSiteScript() };
    }
    for (const [path, blob] of stored.files) putLocalFile(path, blob);
    const session = new ProjectSession(store, 'local', stored.savedAt);
    onLocalFile((path) => {
      const blob = localFiles().get(path);
      if (!blob) return;
      void store.saveFile(path, blob).then(
        (t) => (session.savedAt = t),
        (err: unknown) => (session.lastError = `素材沒有存進${store.label}：${(err as Error)?.message ?? err}`),
      );
    });
    return { session, script: stored.script };
  }

  /** 本機專案：把劇本存回 store。回傳給人看的訊息。 */
  async saveScript(script: Script): Promise<string> {
    this.savedAt = await this.store.saveScript(script);
    return `已存到${this.store.label}裡的專案（${timeLabel(this.savedAt)}）`;
  }

  /**
   * 收集整個遊戲：劇本＋腳本用到的素材。先拿本機素材，沒有的再去網站下載；
   * 網站上也沒有的（還在用佔位圖）就略過。
   */
  async collect(script: Script, onProgress?: (done: number, total: number) => void): Promise<{ project: Project; missing: string[] }> {
    const files = new Map<string, Blob>(localFiles());
    const has = (kind: AssetKind, name: string) => EXTS[kind].some((e) => files.has(`${kind}/${name}.${e}`));
    const wanted: { kind: AssetKind; name: string }[] = [];
    for (const kind of ASSET_KINDS) {
      const names = new Set(assetNames(script, kind));
      // wrong_object 沒指定名稱時用的預設檔
      if (kind === 'fg') {
        names.add('wrong_object');
        for (const s of script.scenes) {
          if (s.foreground) names.add(`${s.foreground}_wrong`);
          for (const l of s.lines) if (isText(l) && l.wrongObject) names.add(l.wrongObject);
        }
      }
      for (const name of names) if (!has(kind, name)) wanted.push({ kind, name });
    }
    // 配音與音效有清單：只下載實際存在的檔案
    const manifests: Partial<Record<AssetKind, string[] | null>> = {
      voice: await fetchJson<string[]>(`${assetBase()}/voice/manifest.json`),
      sfx: await fetchJson<string[]>(`${assetBase()}/sfx/manifest.json`),
      music: await fetchJson<string[]>(`${assetBase()}/music/manifest.json`),
    };
    const required = new Set(ASSET_KINDS.flatMap((k) => assetNames(script, k).map((n) => `${k}/${n}`)));
    const missing: string[] = [];
    let done = 0;
    onProgress?.(0, wanted.length);
    // 離線模式（file://）不能 fetch 內建素材，只收本機素材
    if (FILE_MODE) wanted.length = 0;
    await pool(wanted, 6, async ({ kind, name }) => {
      let exts = EXTS[kind];
      const list = manifests[kind];
      if (list) exts = exts.filter((e) => list.includes(`${name}.${e}`));
      let found = false;
      for (const ext of exts) {
        const blob = await fetchFile(`${assetBase()}/${kind}/${name}.${ext}`);
        if (blob) {
          files.set(`${kind}/${name}.${ext}`, blob);
          found = true;
          break;
        }
      }
      if (!found && required.has(`${kind}/${name}`)) missing.push(`${kind}/${name}`);
      onProgress?.(++done, wanted.length);
    });
    return { project: { script, files }, missing: missing.sort() };
  }

  /** 匯出成專案檔（下載）。 */
  async exportFile(script: Script, onProgress?: (done: number, total: number) => void): Promise<string> {
    const { project, missing } = await this.collect(script, onProgress);
    const blob = await packProject(project);
    const name = projectFileName(script.meta?.title ?? '');
    downloadBlob(blob, name);
    const size = blob.size >= 1024 * 1024 ? `${(blob.size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(blob.size / 1024)} KB`;
    if (FILE_MODE) {
      return `已下載 ${name}（${project.files.size} 個素材，${size}）。離線模式讀不到內建的素材，只包含你上傳或開啟的素材。`;
    }
    return `已下載 ${name}（${project.files.size} 個素材，${size}）` + (missing.length ? `。還沒有檔案、目前用佔位圖或合成音的：${missing.length} 個` : '');
  }

  /** 開啟專案檔：整個存進 store。之後重新載入頁面就會用它。 */
  async openFile(file: Blob): Promise<string> {
    const { script, files, info } = await unpackProject(file);
    await this.store.save({ script, files, savedAt: Date.now() });
    return info.title || script.meta.title;
  }

  /** 把目前的遊戲（含這次上傳的素材與修改）存成本機專案。 */
  async saveAsLocal(script: Script, onProgress?: (done: number, total: number) => void): Promise<void> {
    const { project } = await this.collect(script, onProgress);
    await this.store.save({ script: JSON.parse(JSON.stringify(project.script)) as Script, files: project.files, savedAt: Date.now() });
  }

  /** 關掉本機專案，回到網站上的遊戲（store 清空）。 */
  async close(): Promise<void> {
    await this.store.clear();
  }

  /** 網站模式下有沒有「只在這次頁面有效」的上傳素材。 */
  get hasUnsavedUploads(): boolean {
    return this.mode === 'site' && hasLocalFiles();
  }
}

export function timeLabel(t: number): string {
  if (!t) return '';
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function fetchFile(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url);
    // 開發伺服器找不到檔案時會回 index.html
    if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function pool<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const worker = async () => {
    while (i < items.length) await run(items[i++]);
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}
