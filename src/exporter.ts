// 匯出「可以玩的版本」（需求書 5.5）：一個壓縮檔，解壓縮後雙擊 html 就能玩，也可以放到任何網站。
//
//   {作品名}/
//     index.html           放到網站時的首頁
//     玩 {作品名}.html     雙擊就能玩（和 index.html 一樣）
//     game/assets/…        劇本用到的圖片與音檔
//     說明.txt
//
// 引擎程式來自離線版建置：網站上讀 player-template.html，離線版讀自己頁面上的 #vn-style、#vn-engine。
import { zipSync, type Zippable } from 'fflate';
import { ASSET_KINDS, assetNames, type AssetKind } from './assetnames';
import { MUSIC_EXTENSIONS, VOICE_EXTENSIONS } from './audio';
import { EMBED, FILE_MODE } from './embed';
import { packIdOf } from './pack';
import { assetBase } from './paths';
import { IMAGE_EXTENSIONS } from './script';
import { isText, type Script } from './types';

const EXTS: Record<AssetKind, readonly string[]> = {
  bg: IMAGE_EXTENSIONS,
  char: IMAGE_EXTENSIONS,
  fg: IMAGE_EXTENSIONS,
  voice: VOICE_EXTENSIONS,
  music: MUSIC_EXTENSIONS,
  sfx: VOICE_EXTENSIONS,
};
const STORED = /\.(webp|png|jpe?g|gif|mp3|ogg|m4a|wav)$/i;

export interface PlayableResult {
  blob: Blob;
  fileName: string;
  /** 放進去的素材數。 */
  files: number;
  /** 還沒有檔案、會用佔位圖或合成音的素材數。 */
  missing: number;
  note: string;
}

/** 引擎的樣式與程式。 */
async function engineParts(): Promise<{ css: string; js: string }> {
  const fromDoc = (doc: Document) => {
    const css = doc.getElementById('vn-style')?.textContent ?? '';
    const js = doc.getElementById('vn-engine')?.textContent ?? '';
    return css && js ? { css, js } : null;
  };
  // 離線版：自己的頁面上就有
  const own = fromDoc(document);
  if (own) return own;
  const res = await fetch(`${import.meta.env.BASE_URL}player-template.html`, { cache: 'no-cache' }).catch(() => null);
  if (!res || !res.ok || !(res.headers.get('content-type') ?? '').includes('html')) {
    throw new Error('找不到遊戲程式樣板（player-template.html）。開發伺服器沒有它，請用建置後的網站或離線版匯出。');
  }
  const parts = fromDoc(new DOMParser().parseFromString(await res.text(), 'text/html'));
  if (!parts) throw new Error('遊戲程式樣板的內容不完整');
  return parts;
}

async function packJson(id: string): Promise<unknown> {
  if (id === 'plain' || !id) return EMBED?.packs?.plain ?? null;
  if (EMBED?.packs?.[id]) {
    const { _docs: _, ...rest } = EMBED.packs[id] as Record<string, unknown>;
    return rest;
  }
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}packs/${encodeURIComponent(id)}/pack.json`, { cache: 'no-cache' });
    if (res.ok) return (await res.json()) as unknown;
  } catch {
    /* 讀不到：遊戲會改用內建的行為 */
  }
  return null;
}

async function fetchBlob(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url);
    if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

async function fetchList(url: string): Promise<string[] | null> {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    return (await res.json()) as string[];
  } catch {
    return null;
  }
}

/** 劇本用到的素材：先拿專案裡的檔案，沒有的再去網站上找（離線版找不到就算了）。 */
async function collect(script: Script, own: ReadonlyMap<string, Blob>): Promise<{ files: Map<string, Blob>; missing: number }> {
  const files = new Map<string, Blob>();
  let missing = 0;
  const lists: Partial<Record<AssetKind, string[] | null>> = {};
  if (!FILE_MODE) {
    for (const k of ['voice', 'sfx', 'music'] as const) lists[k] = await fetchList(`${assetBase()}/${k}/manifest.json`);
  }
  const wanted: { kind: AssetKind; name: string; required: boolean }[] = [];
  for (const kind of ASSET_KINDS) {
    const required = new Set(assetNames(script, kind));
    const names = new Set(required);
    if (kind === 'fg') {
      for (const s of script.scenes) {
        if (s.foreground) names.add(`${s.foreground}_wrong`);
        for (const l of s.lines) if (isText(l) && l.wrongObject) names.add(l.wrongObject);
      }
    }
    for (const name of names) {
      const mine = EXTS[kind].map((e) => `${kind}/${name}.${e}`).find((p) => own.has(p));
      if (mine) files.set(mine, own.get(mine)!);
      else wanted.push({ kind, name, required: required.has(name) });
    }
  }
  // 網站上的檔案一次抓六個
  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const { kind, name, required } = wanted[next++];
      let found = false;
      if (!FILE_MODE) {
        const list = lists[kind];
        const exts = list ? EXTS[kind].filter((e) => list.includes(`${name}.${e}`)) : EXTS[kind];
        for (const ext of exts) {
          const blob = await fetchBlob(`${assetBase()}/${kind}/${name}.${ext}`);
          if (blob) {
            files.set(`${kind}/${name}.${ext}`, blob);
            found = true;
            break;
          }
        }
      }
      if (!found && required) missing++;
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { files, missing };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeScript(code: string): string {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

/** 檔名不能用的字去掉。 */
function safeName(title: string): string {
  return title.replace(/[\\/:*?"<>|]+/g, '').trim() || '我的遊戲';
}

export function playerHtml(css: string, js: string, embed: unknown, title: string): string {
  const data = JSON.stringify(embed).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-Hant" data-page="game">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#000000" />
    <title>${escapeHtml(title)}</title>
    <style id="vn-style">
${css}
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script>window.__VN_EMBED__ = ${data};</script>
    <script id="vn-engine">
${safeScript(js)}
    </script>
  </body>
</html>
`;
}

const README = (title: string, file: string) => `《${title}》可以玩的版本

■ 在這台電腦玩
  解壓縮後，雙擊「${file}」（或 index.html）。不需要網路，也不用安裝任何東西。
  建議用 Chrome 或 Edge；記得把整個資料夾一起帶著走（圖片與聲音在 game 資料夾裡）。

■ 放到網站上給別人玩
  把這個資料夾裡的全部檔案上傳到任何網站空間（學校、單位的網站或 GitHub Pages），
  打開 index.html 的網址就能玩。

這是用「同理體驗視覺小說」工具做的作品。
`;

/**
 * 壓縮檔的樣子：
 * - folder：外面包一層「作品名」資料夾，有 index.html、玩 作品名.html、說明.txt（雙擊玩、放到一般網站）。
 * - itch：給 itch.io 的 HTML 遊戲上傳：index.html 在最外層，只有英數檔名（index.html 與 game/assets/…）。
 */
export type PlayableTarget = 'folder' | 'itch';

/** 匯出可以玩的版本（壓縮檔）。 */
export async function exportPlayable(script: Script, own: ReadonlyMap<string, Blob>, target: PlayableTarget = 'folder'): Promise<PlayableResult> {
  const { css, js } = await engineParts();
  const { files, missing } = await collect(script, own);
  const packId = packIdOf(script);
  const pack = await packJson(packId);
  const title = script.meta?.title || '我的遊戲';
  const name = safeName(title);
  const manifests: Record<string, string[]> = { voice: [], sfx: [], music: [] };
  for (const path of files.keys()) {
    const [folder, file] = path.split('/');
    if (folder in manifests) manifests[folder].push(file);
  }
  const embed = {
    page: 'game',
    player: true,
    defaultProject: 'game',
    projects: { game: { title, kind: 'example', script, manifests } },
    packs: pack ? { [packId]: pack } : {},
    pages: { game: 'index.html' },
  };
  const html = new TextEncoder().encode(playerHtml(css, js, embed, title));
  const playFile = `玩 ${name}.html`;
  const root = target === 'itch' ? '' : `${name}/`;
  const zip: Zippable = { [`${root}index.html`]: html };
  if (target === 'folder') {
    zip[`${root}${playFile}`] = html;
    zip[`${root}說明.txt`] = new TextEncoder().encode(README(title, playFile));
  }
  for (const [path, blob] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const data = new Uint8Array(await blob.arrayBuffer());
    zip[`${root}game/assets/${path}`] = STORED.test(path) ? [data, { level: 0 }] : data;
  }
  const bytes = zipSync(zip, { level: 6 });
  const note = FILE_MODE
    ? '離線版只放得進你上傳的素材，其他用佔位圖或合成音。'
    : missing
      ? `還沒有檔案的素材 ${missing} 個，會用佔位圖或合成音。`
      : '';
  return {
    blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
    fileName: target === 'itch' ? `${name}-itch.zip` : `${name}-可以玩的版本.zip`,
    files: files.size,
    missing,
    note,
  };
}

