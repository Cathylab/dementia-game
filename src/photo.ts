// 手繪拍照的圖片處理（需求書 6-7）：去掉白紙背景、找出畫的範圍、依素材種類裁切並調整大小。
// 像素運算只用 { data, width, height }，不碰 DOM，測試可以直接用；畫到 canvas 的部分在 processPhoto。

export type PhotoKind = 'bg' | 'char' | 'fg';

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** 每種素材的輸出大小。背景固定 2304×1080；立繪固定 1000×1800（腳底貼齊下緣）；物品寬 900、高度依內容。 */
export const PHOTO_SIZE = {
  bg: { w: 2304, h: 1080 },
  char: { w: 1000, h: 1800 },
  fg: { w: 900, h: 900 },
} as const;

/** 估計紙張的顏色：取四個角落附近的像素，每個顏色分量取中位數。 */
export function paperColor(img: Pixels): [number, number, number] {
  const { width: w, height: h, data } = img;
  const s = Math.max(2, Math.round(Math.min(w, h) * 0.06));
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const step = Math.max(1, Math.floor(s / 6));
  for (const [x0, y0] of [
    [0, 0],
    [w - s, 0],
    [0, h - s],
    [w - s, h - s],
  ]) {
    for (let y = Math.max(0, y0); y < Math.min(h, y0 + s); y += step) {
      for (let x = Math.max(0, x0); x < Math.min(w, x0 + s); x += step) {
        const i = (y * w + x) * 4;
        rs.push(data[i]);
        gs.push(data[i + 1]);
        bs.push(data[i + 2]);
      }
    }
  }
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1] ?? 255;
  return [med(rs), med(gs), med(bs)];
}

/**
 * 去掉白紙背景：和紙張顏色接近的像素變透明，邊緣漸變（不會有鋸齒白邊）。
 * 同時把紙張顏色校正成白色，讓拍照時偏黃、偏暗的顏色回到原本的樣子。
 * tolerance：差多少以內算紙（0–255），預設 40。
 */
export function removePaper(img: Pixels, tolerance = 40): Pixels {
  const [pr, pg, pb] = paperColor(img);
  const out = new Uint8ClampedArray(img.data);
  const soft = tolerance * 0.75;
  for (let i = 0; i < out.length; i += 4) {
    const r = img.data[i];
    const g = img.data[i + 1];
    const b = img.data[i + 2];
    // 依紙的顏色做白平衡
    out[i] = Math.min(255, (r * 255) / Math.max(pr, 1));
    out[i + 1] = Math.min(255, (g * 255) / Math.max(pg, 1));
    out[i + 2] = Math.min(255, (b * 255) / Math.max(pb, 1));
    const d = Math.max(Math.abs(r - pr), Math.abs(g - pg), Math.abs(b - pb));
    const a = d <= tolerance - soft ? 0 : d >= tolerance + soft ? 1 : (d - (tolerance - soft)) / (2 * soft);
    out[i + 3] = Math.round(img.data[i + 3] * a);
  }
  return { data: out, width: img.width, height: img.height };
}

/** 不透明部分的範圍（alpha 大於 threshold）；整張透明時回傳 null。 */
export function contentBox(img: Pixels, threshold = 24): { x: number; y: number; w: number; h: number } | null {
  const { width: w, height: h, data } = img;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 填滿裁切：來源裁成目標比例（置中），回傳要取的來源範圍。 */
export function coverCrop(sw: number, sh: number, dw: number, dh: number): { x: number; y: number; w: number; h: number } {
  const want = dw / dh;
  if (sw / sh > want) {
    const w = Math.round(sh * want);
    return { x: Math.round((sw - w) / 2), y: 0, w, h: sh };
  }
  const h = Math.round(sw / want);
  return { x: 0, y: Math.round((sh - h) / 2), w: sw, h };
}

/**
 * 去背後的圖放到哪裡：等比例縮放、左右置中、底部貼齊下緣。
 * 立繪：放進 1000×1800，高度約 96%（太寬就以寬為準）。物品：寬 900 以內，畫布高度依內容（最多 900）。
 */
export function fitCutout(kind: 'char' | 'fg', bw: number, bh: number): { canvasW: number; canvasH: number; x: number; y: number; w: number; h: number } {
  if (kind === 'char') {
    const { w: cw, h: ch } = PHOTO_SIZE.char;
    const scale = Math.min((ch * 0.96) / bh, (cw * 0.96) / bw);
    const w = Math.round(bw * scale);
    const h = Math.round(bh * scale);
    return { canvasW: cw, canvasH: ch, x: Math.round((cw - w) / 2), y: ch - h, w, h };
  }
  const max = PHOTO_SIZE.fg.w;
  const scale = Math.min((max * 0.94) / bw, (max * 0.94) / bh);
  const w = Math.round(bw * scale);
  const h = Math.round(bh * scale);
  const canvasH = Math.min(max, Math.round(h / 0.94));
  return { canvasW: max, canvasH, x: Math.round((max - w) / 2), y: canvasH - h, w, h };
}

export interface PhotoOptions {
  /** 去掉白紙背景（立繪與物品預設要）。 */
  removeBackground?: boolean;
  tolerance?: number;
}

/** 處理的時候先縮小到這個大小（太大的照片去背很慢）。 */
const WORK_SIDE = 1600;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

async function toBlob(c: HTMLCanvasElement): Promise<{ blob: Blob; ext: 'webp' | 'png' }> {
  const webp = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.88));
  if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp' };
  const png = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (!png) throw new Error('瀏覽器無法輸出圖片');
  return { blob: png, ext: 'png' };
}

/** 把照片（或任何圖片）處理成可以直接放進遊戲的素材。 */
export async function processPhoto(
  source: Blob,
  kind: PhotoKind,
  opts: PhotoOptions = {},
): Promise<{ blob: Blob; ext: 'webp' | 'png'; width: number; height: number; note: string }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('讀不到這張圖片（請用 jpg、png 或 webp）');
  }
  if (kind === 'bg') {
    const { w, h } = PHOTO_SIZE.bg;
    const crop = coverCrop(bitmap.width, bitmap.height, w, h);
    const [c, g] = canvas(w, h);
    g.imageSmoothingQuality = 'high';
    g.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
    const out = await toBlob(c);
    const cut = crop.w < bitmap.width ? '左右' : crop.h < bitmap.height ? '上下' : '';
    return { ...out, width: w, height: h, note: `${w}×${h}${cut ? `（${cut}裁掉一點）` : ''}` };
  }
  // 立繪、物品：先縮到好處理的大小
  const s = Math.min(1, WORK_SIDE / Math.max(bitmap.width, bitmap.height));
  const ww = Math.max(1, Math.round(bitmap.width * s));
  const wh = Math.max(1, Math.round(bitmap.height * s));
  const [work, wg] = canvas(ww, wh);
  wg.drawImage(bitmap, 0, 0, ww, wh);
  let px: Pixels = wg.getImageData(0, 0, ww, wh);
  const remove = opts.removeBackground ?? true;
  if (remove) px = removePaper(px, opts.tolerance);
  wg.putImageData(new ImageData(new Uint8ClampedArray(px.data), ww, wh), 0, 0);
  const box = (remove && contentBox(px)) || { x: 0, y: 0, w: ww, h: wh };
  if (remove && box.w * box.h < ww * wh * 0.002) throw new Error('去背後幾乎什麼都沒有：畫的線條太淡，或紙不是白色。可以把「去掉白紙背景」取消再試。');
  const fit = fitCutout(kind, box.w, box.h);
  const [c, g] = canvas(fit.canvasW, fit.canvasH);
  g.imageSmoothingQuality = 'high';
  g.drawImage(work, box.x, box.y, box.w, box.h, fit.x, fit.y, fit.w, fit.h);
  const out = await toBlob(c);
  return { ...out, width: fit.canvasW, height: fit.canvasH, note: `${fit.canvasW}×${fit.canvasH}${remove ? '，已去掉白紙背景' : ''}` };
}
