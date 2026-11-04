// 讀題材包：線上版從 packs/{id}/pack.json 讀，離線版從 html 內嵌的資料讀。
import { EMBED } from './embed';
import { LEGACY_PACK, normalizePack, PLAIN_PACK, type Pack } from './pack';

export interface PackEntry {
  id: string;
  name: string;
  description: string;
}

const PACKS_URL = `${import.meta.env.BASE_URL}packs`;

/** 讀題材包。讀不到時：dementia 用內建的舊行為（舊腳本照常），其他用一般故事。problems 收集要提醒的事。 */
export async function loadPack(id: string, problems: string[] = []): Promise<Pack> {
  let raw: unknown = EMBED?.packs?.[id];
  if (raw === undefined && !EMBED) {
    try {
      const res = await fetch(`${PACKS_URL}/${encodeURIComponent(id)}/pack.json`, { cache: 'no-cache' });
      if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) raw = await res.json();
    } catch {
      /* 讀不到 */
    }
  }
  if (raw === undefined) {
    if (id === 'dementia') return LEGACY_PACK;
    if (id !== 'plain') problems.push(`找不到題材包「${id}」，改用一般故事（沒有特殊效果）`);
    return PLAIN_PACK;
  }
  return normalizePack(raw, id, problems);
}

/** 所有題材包（開發者面板的選單）。 */
export async function listPacks(): Promise<PackEntry[]> {
  if (EMBED) {
    return Object.entries(EMBED.packs ?? {}).map(([id, p]) => {
      const n = normalizePack(p, id);
      return { id, name: n.name, description: n.description };
    });
  }
  try {
    const res = await fetch(`${PACKS_URL}.json`, { cache: 'no-cache' });
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) return (await res.json()) as PackEntry[];
  } catch {
    /* 讀不到 */
  }
  return [];
}

/** 題材包的說明文件內容（readme、guide、cautions）。讀不到的就沒有。 */
export async function loadPackDocs(id: string): Promise<Record<string, string>> {
  const embedded = EMBED?.packs?.[id] as { _docs?: Record<string, string> } | undefined;
  if (EMBED) return embedded?._docs ?? {};
  const pack = await loadPack(id);
  const out: Record<string, string> = {};
  for (const [key, file] of Object.entries(pack.docs ?? {})) {
    if (!file) continue;
    try {
      const res = await fetch(`${PACKS_URL}/${encodeURIComponent(id)}/${file.split('/').map(encodeURIComponent).join('/')}`, { cache: 'no-cache' });
      const type = res.headers.get('content-type') ?? '';
      if (res.ok && !type.includes('text/html')) out[key] = await res.text();
    } catch {
      /* 讀不到 */
    }
  }
  return out;
}

