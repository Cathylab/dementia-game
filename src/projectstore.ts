// 專案存在哪裡。目前只有「這個瀏覽器」（IndexedDB）；之後要做雲端，只要再寫一個實作 ProjectStore 的類別。
import type { Script } from './types';

export interface StoredProject {
  script: Script;
  /** 路徑同 {專案}/assets/ 底下，例如 bg/kitchen_morning.webp。 */
  files: Map<string, Blob>;
  savedAt: number;
}

export interface ProjectStore {
  /** 給人看的位置名稱，例如「這個瀏覽器」。 */
  readonly label: string;
  load(): Promise<StoredProject | null>;
  /** 整個專案一起存（開啟專案檔時）。 */
  save(project: StoredProject): Promise<void>;
  /** 只更新劇本。 */
  saveScript(script: Script): Promise<number>;
  /** 新增或取代一個素材檔。 */
  saveFile(path: string, blob: Blob): Promise<number>;
  clear(): Promise<void>;
  /** 專案附帶的其他資料（例如引導流程做到哪一步）。沒有回傳 undefined。 */
  loadExtra<T>(key: string): Promise<T | undefined>;
  saveExtra(key: string, value: unknown): Promise<void>;
}

const DB_NAME = 'vn-project';
const META = 'meta';
const FILES = 'files';

/** 存在這個瀏覽器的 IndexedDB 裡。換電腦、換瀏覽器、清除網站資料就看不到。 */
export class BrowserProjectStore implements ProjectStore {
  readonly label = '這個瀏覽器';
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(META);
        req.result.createObjectStore(FILES);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('無法開啟瀏覽器的儲存空間'));
    });
    return this.db;
  }

  private async tx<T>(mode: IDBTransactionMode, run: (meta: IDBObjectStore, files: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const t = db.transaction([META, FILES], mode);
      const req = run(t.objectStore(META), t.objectStore(FILES));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error ?? new Error('瀏覽器儲存失敗'));
      t.onabort = () => reject(t.error ?? new Error('瀏覽器儲存失敗（空間可能不夠）'));
    });
  }

  async load(): Promise<StoredProject | null> {
    let script: Script | undefined;
    let savedAt = 0;
    const files = new Map<string, Blob>();
    await this.tx('readonly', (meta, store) => {
      const s = meta.get('script');
      s.onsuccess = () => (script = s.result as Script | undefined);
      const a = meta.get('savedAt');
      a.onsuccess = () => (savedAt = Number(a.result) || 0);
      const c = store.openCursor();
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur) return;
        files.set(String(cur.key), cur.value as Blob);
        cur.continue();
      };
    });
    return script ? { script, files, savedAt } : null;
  }

  async save(project: StoredProject): Promise<void> {
    await this.tx('readwrite', (meta, store) => {
      store.clear();
      meta.put(project.script, 'script');
      meta.put(project.savedAt, 'savedAt');
      for (const [path, blob] of project.files) store.put(blob, path);
    });
  }

  async saveScript(script: Script): Promise<number> {
    const now = Date.now();
    // 存純資料，避免把執行中加上的東西一起存進去
    const plain = JSON.parse(JSON.stringify(script)) as Script;
    await this.tx('readwrite', (meta) => {
      meta.put(plain, 'script');
      meta.put(now, 'savedAt');
    });
    return now;
  }

  async saveFile(path: string, blob: Blob): Promise<number> {
    const now = Date.now();
    const base = path.replace(/\.[^./]+$/, '');
    await this.tx('readwrite', (meta, store) => {
      // 同名不同副檔名的舊檔一起刪掉
      const c = store.openCursor();
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur) {
          store.put(blob, path);
          return;
        }
        const key = String(cur.key);
        if (key !== path && key.replace(/\.[^./]+$/, '') === base) cur.delete();
        cur.continue();
      };
      meta.put(now, 'savedAt');
    });
    return now;
  }

  async loadExtra<T>(key: string): Promise<T | undefined> {
    let value: T | undefined;
    await this.tx('readonly', (meta) => {
      const r = meta.get(`extra:${key}`);
      r.onsuccess = () => (value = r.result as T | undefined);
    });
    return value;
  }

  async saveExtra(key: string, value: unknown): Promise<void> {
    const plain = JSON.parse(JSON.stringify(value)) as unknown;
    await this.tx('readwrite', (meta) => {
      meta.put(plain, `extra:${key}`);
    });
  }

  async clear(): Promise<void> {
    await this.tx('readwrite', (meta, store) => {
      meta.clear();
      store.clear();
    });
  }
}
