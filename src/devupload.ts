// 開發者面板「上傳素材」：把電腦裡的配音、背景、立繪、物品圖、音樂暫時放進遊戲裡試看，
// 並產生檔名正確（圖片轉成 webp、太大會縮小）的檔案，方便放進 GitHub 的 public/assets/。
// 網頁版（GitHub Pages）無法直接寫進 repo，所以上傳只在這次開啟的頁面有效。
import { assetNames, type AssetKind } from './assetnames';
import { forgetImage, isPlaceholder, resolveImage, type ImageKind } from './assets';
import { MUSIC_EXTENSIONS, VOICE_EXTENSIONS } from './audio';
import type { Engine } from './engine';
import { localFileUrl, putLocalFile } from './localfiles';
import { IMAGE_EXTENSIONS } from './script';
import { assetFolderLabel } from './paths';
import { el } from './util';
import type { AdvView } from './view';

export type UploadKind = AssetKind;

/** 腳本裡用到的素材名稱（依腳本順序、不重複）。 */
export function neededNames(engine: Engine, kind: UploadKind): string[] {
  return assetNames(engine.script, kind);
}

export const UPLOAD_KINDS: { kind: UploadKind; label: string; folder: string; accept: string }[] = [
  { kind: 'voice', label: '配音', folder: 'voice', accept: 'audio/*,.mp3,.ogg' },
  { kind: 'bg', label: '背景圖', folder: 'bg', accept: 'image/*' },
  { kind: 'char', label: '立繪', folder: 'char', accept: 'image/*' },
  { kind: 'fg', label: '物品圖', folder: 'fg', accept: 'image/*' },
  { kind: 'music', label: '背景音樂', folder: 'music', accept: 'audio/*,.mp3,.ogg' },
  { kind: 'sfx', label: '音效', folder: 'sfx', accept: 'audio/*,.mp3,.ogg' },
];

/** 圖片最長邊上限：背景要看清楚細節，其他用不到那麼大。 */
const MAX_SIDE: Record<ImageKind, number> = { bg: 2560, char: 2048, fg: 2048 };

/** 線上版（xxx.github.io/repo/）對應的 GitHub 上傳頁；其他網址回傳 null。 */
export function githubUploadUrl(folder: string, loc: Location = window.location): string | null {
  const m = loc.hostname.match(/^([^.]+)\.github\.io$/i);
  const repo = loc.pathname.split('/').filter(Boolean)[0];
  if (!m || !repo) return null;
  return `https://github.com/${m[1]}/${repo}/upload/main/${encodeURI(assetFolderLabel(folder).replace(/\/$/, ''))}`;
}

function baseName(file: string): string {
  return file.replace(/\.[^.]+$/, '');
}

function extOf(file: string): string {
  return (file.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
}

/**
 * 圖片轉成 webp，最長邊超過上限就等比例縮小。
 * 已經是夠小的 webp、或瀏覽器不支援輸出 webp 時，維持原檔。
 */
export async function prepareImage(file: File, kind: ImageKind): Promise<{ blob: Blob; ext: string; note: string }> {
  const origExt = extOf(file.name) || 'png';
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`這個檔案不是瀏覽器看得懂的圖片：${file.name}`);
  }
  const max = MAX_SIDE[kind];
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  if (scale === 1 && origExt === 'webp') {
    bitmap.close();
    return { blob: file, ext: 'webp', note: `${w}×${h}` };
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
  if (!blob || blob.type !== 'image/webp') {
    const keep = ['webp', 'png', 'jpg'].includes(origExt) ? origExt : 'png';
    return { blob: file, ext: keep === 'jpeg' ? 'jpg' : keep, note: '瀏覽器無法轉成 webp，維持原檔' };
  }
  // 轉檔後反而變大（例如原本就壓得很小的 jpg）就用原檔
  if (scale === 1 && blob.size >= file.size && ['png', 'jpg'].includes(origExt)) {
    return { blob: file, ext: origExt, note: `${w}×${h}` };
  }
  const resized = scale < 1 ? `，從 ${Math.round(w / scale)}×${Math.round(h / scale)} 縮小` : '';
  return { blob, ext: 'webp', note: `${w}×${h}${resized}，${kb(file.size)} → ${kb(blob.size)}` };
}

function kb(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export interface UsedAsset {
  /** 放進遊戲的檔案（圖片可能已轉成 webp）。 */
  blob: Blob;
  /** 正式檔名，例如 kitchen_morning.webp。 */
  fileName: string;
  note: string;
}

/**
 * 把一個檔案放進遊戲當作某個素材：圖片轉 webp、音檔先確認能播，放進本機素材並立刻換上。
 * 失敗時丟出看得懂的錯誤。開發者面板與故事編輯器的「素材」頁共用。
 */
export async function useAssetFile(
  engine: Engine,
  view: AdvView,
  kind: UploadKind,
  name: string,
  f: File,
  opts: { preview?: boolean } = {},
): Promise<UsedAsset> {
  const folder = UPLOAD_KINDS.find((k) => k.kind === kind)!.folder;
  if (kind === 'voice' || kind === 'music' || kind === 'sfx') {
    const ext = extOf(f.name);
    const allowed = kind === 'music' ? MUSIC_EXTENSIONS : VOICE_EXTENSIONS;
    if (!view.audio) throw new Error('這個頁面沒有聲音引擎');
    const played =
      kind === 'voice' ? await view.audio.useVoiceFile(name, f) : kind === 'sfx' ? await view.audio.useSfxFile(name, f) : await view.audio.useFile(name, f);
    if (!played) throw new Error(`瀏覽器無法播放：${f.name}`);
    // 副檔名不對時也先放進來試聽；匯出專案檔時用正確的副檔名
    const fileName = `${name}.${allowed.includes(ext) ? ext : allowed[0]}`;
    putLocalFile(`${folder}/${fileName}`, f);
    if (kind === 'music' && (engine.scene?.music === name || view.audio.musicName === name)) view.audio.playMusic(name);
    // 音效：放進去後馬上播一次給你聽
    if (kind === 'sfx' && opts.preview) view.audio.playSfx(name);
    const note = allowed.includes(ext) ? '' : `正式檔案要是 ${allowed.join(' 或 ')}，這個檔是 .${ext || '?'}`;
    return { blob: f, fileName, note };
  }
  const { blob, ext, note } = await prepareImage(f, kind);
  putLocalFile(`${folder}/${name}.${ext}`, blob);
  forgetImage(kind, name);
  await view.refreshAsset(kind, name);
  return { blob, fileName: `${name}.${ext}`, note };
}

export type AssetStatus = 'site' | 'local' | 'missing';

/** 素材現在的狀態：本機素材（上傳或專案檔）、網站上有檔案、還沒有（佔位中）。 */
export async function assetStatus(view: AdvView, kind: UploadKind, name: string): Promise<AssetStatus> {
  const folder = UPLOAD_KINDS.find((k) => k.kind === kind)!.folder;
  const exts = kind === 'music' ? MUSIC_EXTENSIONS : kind === 'voice' || kind === 'sfx' ? VOICE_EXTENSIONS : IMAGE_EXTENSIONS;
  if (localFileUrl(folder, name, exts)) return 'local';
  let has = false;
  if (kind === 'voice') has = (await view.audio?.hasVoice(name)) ?? false;
  else if (kind === 'sfx') has = (await view.audio?.hasSfx(name)) ?? false;
  else if (kind === 'music') has = (await view.audio?.hasMusic(name)) ?? false;
  else has = !isPlaceholder(await resolveImage(kind, name));
  return has ? 'site' : 'missing';
}

/** 開發者面板裡的「上傳素材」區塊。 */
export function buildUploadSection(engine: Engine, view: AdvView, savedToProject = false): HTMLElement {
  const kindSelect = el('select', { name: 'dev-upload-kind' });
  for (const k of UPLOAD_KINDS) kindSelect.append(el('option', { value: k.kind }, [k.label]));
  const nameSelect = el('select', { name: 'dev-upload-name' });
  const file = el('input', { type: 'file', name: 'dev-upload-file', multiple: '' });
  const status = el('p', { class: 'dev-note', 'data-dev': 'upload-status' });
  const results = el('ul', { class: 'dev-uploads' });
  const github = el('a', { class: 'dev-link', target: '_blank', rel: 'noopener' });
  const folderNote = el('p', { class: 'dev-note' });
  const uploaded = new Set<string>();

  const current = () => UPLOAD_KINDS.find((k) => k.kind === kindSelect.value)!;

  /** 列出這類素材需要的檔名，標出缺檔的（缺的排前面）。 */
  const fillNames = async () => {
    const k = current();
    file.accept = k.accept;
    const names = neededNames(engine, k.kind);
    nameSelect.replaceChildren(el('option', { value: '' }, ['（依檔名自動對應）']));
    const has = await Promise.all(names.map((n) => exists(k.kind, n)));
    if (k.kind !== current().kind) return;
    const rows = names.map((n, i) => ({ n, has: has[i] }));
    rows.sort((a, b) => Number(a.has === true) - Number(b.has === true));
    for (const r of rows) {
      const mark = uploaded.has(`${k.kind}/${r.n}`) ? '（已上傳）' : r.has === false ? '（缺）' : '';
      nameSelect.append(el('option', { value: r.n }, [`${r.n}${mark}`]));
    }
    const url = githubUploadUrl(k.folder);
    github.hidden = !url;
    if (url) {
      github.href = url;
      github.textContent = `打開 GitHub 上傳頁（${assetFolderLabel(k.folder)}）`;
    }
    const missing = rows.filter((r) => r.has === false).length;
    folderNote.textContent =
      `腳本用到 ${names.length} 個${k.label}${missing ? `，缺 ${missing} 個` : ''}。` +
      `正式檔案要放在 ${assetFolderLabel(k.folder)}，檔名＝上面的名稱。`;
  };

  const exists = async (kind: UploadKind, name: string): Promise<boolean | null> => {
    if (kind === 'voice') return view.audio ? view.audio.hasVoice(name) : null;
    if (kind === 'sfx') return view.audio ? view.audio.hasSfx(name) : null;
    if (kind === 'music') return null;
    return !isPlaceholder(await resolveImage(kind, name));
  };

  const addResult = (label: string, blob: Blob | null, fileName: string, note: string) => {
    const li = el('li', {}, [el('strong', {}, [label]), ` ${note}`]);
    if (blob) {
      const a = el('a', { href: URL.createObjectURL(blob), download: fileName, class: 'dev-link' }, [`下載 ${fileName}`]);
      li.append(el('br'), a);
    }
    results.prepend(li);
  };

  file.onchange = async () => {
    const k = current();
    const files = [...(file.files ?? [])];
    file.value = '';
    if (!files.length) return;
    const names = new Set(neededNames(engine, k.kind));
    const chosen = nameSelect.value;
    let ok = 0;
    for (const f of files) {
      // 只選一個檔案而且下拉選單有選名稱＝用選的名稱；否則用檔名（去掉副檔名）
      const name = files.length === 1 && chosen ? chosen : baseName(f.name);
      const unknown = !names.has(name) ? '（腳本裡沒有用到這個名稱，檢查一下拼字）' : '';
      try {
        const r = await useAssetFile(engine, view, k.kind, name, f, { preview: files.length === 1 });
        addResult(name, r.blob, r.fileName, `已放進遊戲${r.note ? `（${r.note}）` : ''}${unknown}`);
        uploaded.add(`${k.kind}/${name}`);
        ok++;
      } catch (err) {
        addResult(name, null, '', `✗ ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    status.textContent = savedToProject
      ? `${ok} / ${files.length} 個檔案已放進遊戲，並存進本機專案（重新整理也還在，匯出專案檔時會一起帶走）。`
      : `${ok} / ${files.length} 個檔案已放進遊戲。只在這次開啟的頁面有效，重新整理就會消失；要留下來，可以按上方「存成本機專案」，或下載下面的檔案放進 GitHub 的 ${assetFolderLabel(k.folder)}。`;
    void fillNames();
  };

  kindSelect.onchange = () => void fillNames();
  void fillNames();

  return el('div', { class: 'dev-upload' }, [
    el('label', { class: 'dev-row' }, ['類型', kindSelect]),
    el('label', { class: 'dev-row' }, ['名稱', nameSelect]),
    el('label', { class: 'dev-row' }, ['檔案', file]),
    el('p', { class: 'dev-note' }, [
      '可以一次選多個檔案：檔名要和腳本裡的名稱一樣（例如 a1_s04_01_clerk.mp3）。只選一個檔案時，可以在「名稱」指定要換掉哪一個。圖片會自動轉成 webp，太大會縮小。新的音效名稱要先在故事編輯器的台詞「♪ 聲音」裡設定，才會出現在名稱清單。',
    ]),
    folderNote,
    github,
    status,
    results,
  ]);
}
