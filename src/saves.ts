// 存檔：1 個自動存檔＋3 個手動欄位，存在這個瀏覽器的 localStorage。不碰 DOM 以外的東西（localStorage 例外）。
// 每個遊戲各自一份（依專案與遊戲名稱分開），讀寫失敗（私密模式、空間不夠）時安靜略過。
import type { CharPose } from './engine';

export const MANUAL_SLOTS = 3;

/** 一份存檔：讀檔時從 sceneId 的第 index 句重新開始，數值、旗標、點過的物件照存檔時的樣子。 */
export interface SaveData {
  sceneId: string;
  index: number;
  stats: Record<string, number>;
  flags: string[];
  seen: string[];
  poses: Record<string, CharPose>;
  lastChar: string | null;
  desat: number;
  /** 存檔時間（ms）。 */
  savedAt: number;
  /** 給人看的位置，例如「第一幕〈婚紗店〉：這件呢？」。 */
  label: string;
}

export interface SaveBook {
  auto: SaveData | null;
  slots: (SaveData | null)[];
}

const PREFIX = 'vn-saves:';

function emptyBook(): SaveBook {
  return { auto: null, slots: Array.from({ length: MANUAL_SLOTS }, () => null) };
}

function valid(d: unknown): d is SaveData {
  const x = d as SaveData;
  return !!x && typeof x === 'object' && typeof x.sceneId === 'string' && typeof x.index === 'number' && typeof x.savedAt === 'number';
}

/** 這個遊戲的存檔簿。key 用來分開不同遊戲（例如專案資料夾＋遊戲名稱）。 */
export class SaveStore {
  constructor(private readonly key: string) {}

  load(): SaveBook {
    const book = emptyBook();
    try {
      const raw = JSON.parse(localStorage.getItem(PREFIX + this.key) ?? 'null') as Partial<SaveBook> | null;
      if (raw && valid(raw.auto)) book.auto = raw.auto;
      raw?.slots?.forEach((s, i) => {
        if (i < MANUAL_SLOTS && valid(s)) book.slots[i] = s;
      });
    } catch {
      /* 讀不到就當沒有存檔 */
    }
    return book;
  }

  private write(book: SaveBook): boolean {
    try {
      localStorage.setItem(PREFIX + this.key, JSON.stringify(book));
      return true;
    } catch {
      return false;
    }
  }

  saveAuto(data: SaveData): boolean {
    const book = this.load();
    book.auto = data;
    return this.write(book);
  }

  saveSlot(i: number, data: SaveData): boolean {
    const book = this.load();
    book.slots[i] = data;
    return this.write(book);
  }

  clearSlot(i: number): boolean {
    const book = this.load();
    book.slots[i] = null;
    return this.write(book);
  }
}

/** 「11/4 下午 3:05」這種時間。 */
export function saveTimeLabel(t: number): string {
  const d = new Date(t);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${h < 12 ? '上午' : '下午'} ${h % 12 || 12}:${m}`;
}
