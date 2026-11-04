// 小圖庫（需求書 6-7）：常用的背景與物品，簡單的平面插畫（SVG），選了以後轉成 webp 放進專案。
import { contentBox, fitCutout } from './photo';

// 全部寫在程式裡，離線版也有；風格刻意簡單、淡色，和手繪、佔位圖放在一起不突兀。

export interface GalleryItem {
  id: string;
  kind: 'bg' | 'fg';
  title: string;
  /** 適合的背景名稱關鍵字（用來把圖庫裡最像的排前面）。 */
  keywords: string[];
  svg: string;
}

const BG = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2304 1080" width="2304" height="1080">${body}</svg>`;
const FG = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 900" width="900" height="900">${body}</svg>`;

/** 窗戶：外框、玻璃、十字窗格。 */
const win = (x: number, y: number, w: number, h: number, sky: string) =>
  `<rect x="${x - 14}" y="${y - 14}" width="${w + 28}" height="${h + 28}" rx="8" fill="#fbf7ef"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${sky}"/>` +
  `<rect x="${x + w / 2 - 6}" y="${y}" width="12" height="${h}" fill="#fbf7ef"/><rect x="${x}" y="${y + h / 2 - 6}" width="${w}" height="12" fill="#fbf7ef"/>`;

export const GALLERY: GalleryItem[] = [
  {
    id: 'classroom',
    kind: 'bg',
    title: '教室',
    keywords: ['class', 'school', 'room', '教室', '學校'],
    svg: BG(
      `<rect width="2304" height="1080" fill="#e9e2cf"/><rect y="820" width="2304" height="260" fill="#b99a74"/>` +
        `<rect x="560" y="170" width="1180" height="460" rx="10" fill="#7a5a3c"/><rect x="590" y="200" width="1120" height="400" fill="#3f5b4b"/>` +
        `<path d="M680 300 h260 M680 360 h420 M680 420 h330" stroke="#e8efe6" stroke-width="10" stroke-linecap="round" opacity=".75"/>` +
        `<rect x="600" y="610" width="1100" height="16" fill="#8a6a4a"/>` +
        win(120, 200, 300, 380, '#cfe3ee') +
        win(1890, 200, 300, 380, '#cfe3ee') +
        [300, 900, 1500].map((x) => `<rect x="${x}" y="760" width="440" height="40" rx="6" fill="#c9a777"/><rect x="${x + 30}" y="800" width="20" height="200" fill="#8f7558"/><rect x="${x + 390}" y="800" width="20" height="200" fill="#8f7558"/>`).join('') +
        `<circle cx="1150" cy="110" r="46" fill="#fbf7ef" stroke="#7a5a3c" stroke-width="8"/><path d="M1150 110 v-28 M1150 110 h20" stroke="#7a5a3c" stroke-width="7" stroke-linecap="round"/>`,
    ),
  },
  {
    id: 'living_room',
    kind: 'bg',
    title: '客廳',
    keywords: ['living', 'home', 'house', '客廳', '家'],
    svg: BG(
      `<rect width="2304" height="1080" fill="#efe3d0"/><rect y="800" width="2304" height="280" fill="#c7a988"/><rect y="790" width="2304" height="18" fill="#a9876a"/>` +
        win(1500, 160, 520, 420, '#d7e8ef') +
        `<rect x="1470" y="130" width="40" height="560" fill="#d9a5a0" opacity=".8"/><rect x="2010" y="130" width="40" height="560" fill="#d9a5a0" opacity=".8"/>` +
        `<rect x="360" y="560" width="820" height="230" rx="40" fill="#8aa0a8"/><rect x="330" y="470" width="880" height="140" rx="50" fill="#9db1b8"/><rect x="300" y="580" width="90" height="220" rx="30" fill="#7d939b"/><rect x="1150" y="580" width="90" height="220" rx="30" fill="#7d939b"/>` +
        `<rect x="560" y="860" width="460" height="30" rx="8" fill="#8f6c4f"/><rect x="590" y="890" width="16" height="110" fill="#7a5a3c"/><rect x="974" y="890" width="16" height="110" fill="#7a5a3c"/>` +
        `<rect x="520" y="170" width="300" height="220" rx="6" fill="#fbf7ef" stroke="#a9876a" stroke-width="12"/><circle cx="640" cy="260" r="40" fill="#e6c9a8"/><rect x="590" y="300" width="100" height="70" rx="30" fill="#c99f86"/>` +
        `<rect x="1300" y="600" width="70" height="190" fill="#8f6c4f"/><circle cx="1335" cy="560" r="80" fill="#9db890"/>`,
    ),
  },
  {
    id: 'bedroom',
    kind: 'bg',
    title: '臥室',
    keywords: ['bed', 'room', '臥室', '房間'],
    svg: BG(
      `<rect width="2304" height="1080" fill="#e7e2ec"/><rect y="820" width="2304" height="260" fill="#b8a48f"/>` +
        win(300, 180, 420, 400, '#d6e4f0') +
        `<rect x="1100" y="420" width="1000" height="80" rx="20" fill="#8f7558"/><rect x="1100" y="500" width="1000" height="260" rx="20" fill="#f3efe7"/><rect x="1100" y="560" width="1000" height="200" rx="20" fill="#a7b8d0"/>` +
        `<rect x="1160" y="470" width="260" height="90" rx="40" fill="#fbf7ef"/><rect x="1100" y="740" width="40" height="120" fill="#7a5a3c"/><rect x="2060" y="740" width="40" height="120" fill="#7a5a3c"/>` +
        `<rect x="860" y="600" width="180" height="220" rx="10" fill="#c9a777"/><rect x="900" y="520" width="20" height="80" fill="#7a5a3c"/><path d="M860 520 h100 l-30 -80 h-40 z" fill="#f2d79b"/>`,
    ),
  },
  {
    id: 'kitchen',
    kind: 'bg',
    title: '廚房',
    keywords: ['kitchen', 'cook', '廚房', '餐'],
    svg: BG(
      `<rect width="2304" height="1080" fill="#eee6d6"/><rect y="860" width="2304" height="220" fill="#b49a7c"/>` +
        `<rect x="0" y="560" width="2304" height="300" fill="#c9b49a"/><rect x="0" y="540" width="2304" height="34" fill="#e9dfcf"/>` +
        [120, 520, 920, 1700].map((x) => `<rect x="${x}" y="600" width="360" height="240" rx="8" fill="#d6c4ab"/><rect x="${x + 160}" y="700" width="40" height="10" rx="5" fill="#8f7558"/>`).join('') +
        `<rect x="160" y="140" width="1000" height="260" rx="8" fill="#d6c4ab"/><path d="M660 140 v260" stroke="#b49a7c" stroke-width="8"/>` +
        win(1400, 150, 460, 300, '#d7e8ef') +
        `<rect x="1320" y="500" width="260" height="40" rx="10" fill="#8f8f8f"/><circle cx="1400" cy="500" r="10" fill="#555"/>` +
        `<path d="M1440 470 q30 -40 0 -80 q-30 -40 0 -80" stroke="#c0c0c0" stroke-width="10" fill="none" opacity=".6"/><rect x="1360" y="460" width="160" height="40" rx="10" fill="#c85f4f"/>`,
    ),
  },
  {
    id: 'street',
    kind: 'bg',
    title: '街道',
    keywords: ['street', 'road', 'town', 'outside', '街', '路', '外'],
    svg: BG(
      `<rect width="2304" height="1080" fill="#d6e6ef"/><rect y="760" width="2304" height="320" fill="#9a9a96"/><rect y="740" width="2304" height="40" fill="#c4bfb4"/>` +
        `<path d="M0 930 h2304" stroke="#e9e6dd" stroke-width="14" stroke-dasharray="120 90"/>` +
        [
          [80, 260, 380, '#e7c9a5'],
          [500, 180, 340, '#c9d4c0'],
          [880, 300, 420, '#e2b8ad'],
          [1340, 220, 360, '#d4c7e0'],
          [1740, 280, 480, '#e6d6a8'],
        ]
          .map(
            ([x, y, w, c]) =>
              `<rect x="${x}" y="${y}" width="${w}" height="${740 - (y as number)}" fill="${c}"/>` +
              [0, 1, 2].map((r) => `<rect x="${(x as number) + 40}" y="${(y as number) + 50 + r * 130}" width="${(w as number) - 80}" height="70" rx="4" fill="#fbf7ef" opacity=".7"/>`).join(''),
          )
          .join('') +
        `<rect x="1250" y="460" width="14" height="280" fill="#6c6c6c"/><circle cx="1257" cy="450" r="26" fill="#f2d79b"/>`,
    ),
  },
  {
    id: 'park',
    kind: 'bg',
    title: '公園',
    keywords: ['park', 'garden', 'tree', '公園', '花園', '樹'],
    svg: BG(
      `<rect width="2304" height="1080" fill="#dcebf0"/><circle cx="1900" cy="200" r="90" fill="#fbf1cf"/>` +
        `<path d="M0 700 q600 -120 1150 0 t1154 0 v380 h-2304 z" fill="#a9c79a"/><path d="M0 820 q700 -80 1300 20 t1004 -10 v250 h-2304 z" fill="#93b585"/>` +
        `<path d="M900 1080 q150 -200 260 -300 q120 -100 300 -120" stroke="#e6dcc4" stroke-width="90" fill="none" stroke-linecap="round"/>` +
        [
          [260, 520, 170],
          [620, 470, 140],
          [1700, 500, 190],
          [2080, 560, 130],
        ]
          .map(([x, y, r]) => `<rect x="${x - 18}" y="${y}" width="36" height="${r * 1.4}" fill="#8a6a4a"/><circle cx="${x}" cy="${y}" r="${r}" fill="#7fa671"/>`)
          .join('') +
        `<rect x="1300" y="720" width="300" height="24" rx="6" fill="#a9876a"/><rect x="1300" y="670" width="300" height="20" rx="6" fill="#a9876a"/><rect x="1320" y="744" width="14" height="70" fill="#6c5a48"/><rect x="1566" y="744" width="14" height="70" fill="#6c5a48"/>`,
    ),
  },
  {
    id: 'hospital',
    kind: 'bg',
    title: '診間',
    keywords: ['hospital', 'clinic', 'doctor', '醫院', '診'],
    svg: BG(
      `<rect width="2304" height="1080" fill="#e4ecec"/><rect y="820" width="2304" height="260" fill="#b9c4c2"/>` +
        win(1600, 180, 440, 360, '#d7e8ef') +
        `<rect x="300" y="560" width="760" height="40" rx="8" fill="#e9e6dd"/><rect x="330" y="600" width="24" height="220" fill="#8f9a98"/><rect x="1006" y="600" width="24" height="220" fill="#8f9a98"/>` +
        `<rect x="420" y="380" width="300" height="180" rx="10" fill="#4b5b62"/><rect x="440" y="400" width="260" height="140" fill="#9fc2cc"/>` +
        `<rect x="1180" y="460" width="300" height="360" rx="20" fill="#f3f3ef"/><rect x="1180" y="430" width="300" height="60" rx="20" fill="#9ab7b0"/>` +
        `<rect x="420" y="160" width="360" height="140" rx="8" fill="#fbf7ef"/><path d="M600 190 v80 M560 230 h80" stroke="#c85f4f" stroke-width="22" stroke-linecap="round"/>`,
    ),
  },
  {
    id: 'night_room',
    kind: 'bg',
    title: '夜晚的房間',
    keywords: ['night', 'dark', '夜', '晚'],
    svg: BG(
      `<rect width="2304" height="1080" fill="#2f3445"/><rect y="820" width="2304" height="260" fill="#23263a"/>` +
        win(800, 160, 640, 440, '#1a2238') +
        `<circle cx="1260" cy="290" r="54" fill="#f3e7b8"/><circle cx="1240" cy="280" r="54" fill="#1a2238"/>` +
        [900, 980, 1100, 1350, 880].map((x, i) => `<circle cx="${x}" cy="${220 + ((i * 97) % 300)}" r="5" fill="#f3e7b8"/>`).join('') +
        `<rect x="1700" y="560" width="200" height="260" rx="10" fill="#3b4154"/><path d="M1740 560 h120 l-30 -90 h-60 z" fill="#f3d99a" opacity=".85"/><circle cx="1800" cy="560" r="260" fill="#f3d99a" opacity=".08"/>`,
    ),
  },
  // ───────── 物品 ─────────
  {
    id: 'key',
    kind: 'fg',
    title: '鑰匙',
    keywords: ['key', '鑰匙'],
    svg: FG(
      `<g transform="rotate(-30 450 600)"><circle cx="300" cy="600" r="130" fill="none" stroke="#c9a54a" stroke-width="56"/><rect x="420" y="575" width="420" height="50" rx="10" fill="#c9a54a"/><rect x="700" y="620" width="40" height="90" fill="#c9a54a"/><rect x="780" y="620" width="40" height="60" fill="#c9a54a"/></g>`,
    ),
  },
  {
    id: 'photo',
    kind: 'fg',
    title: '相片',
    keywords: ['photo', 'picture', '照片', '相片'],
    svg: FG(
      `<g transform="rotate(-6 450 520)"><rect x="160" y="200" width="580" height="640" rx="10" fill="#fbf7ef" stroke="#d9d2c3" stroke-width="6"/><rect x="200" y="240" width="500" height="460" fill="#cfe1e6"/><path d="M200 700 l170 -200 l120 120 l90 -80 l120 160 z" fill="#93b585"/><circle cx="330" cy="400" r="60" fill="#e6c9a8"/><circle cx="560" cy="410" r="55" fill="#d9b394"/></g>`,
    ),
  },
  {
    id: 'letter',
    kind: 'fg',
    title: '信',
    keywords: ['letter', 'note', 'paper', '信', '紙條', '便利貼'],
    svg: FG(`<rect x="130" y="320" width="640" height="420" rx="14" fill="#f4ecdc" stroke="#cdbfa5" stroke-width="8"/><path d="M130 330 l320 240 l320 -240" fill="none" stroke="#cdbfa5" stroke-width="10"/><circle cx="450" cy="560" r="34" fill="#c85f4f"/>`),
  },
  {
    id: 'phone',
    kind: 'fg',
    title: '手機',
    keywords: ['phone', 'mobile', '手機', '電話'],
    svg: FG(`<rect x="300" y="100" width="300" height="760" rx="44" fill="#3b4154"/><rect x="322" y="160" width="256" height="600" rx="12" fill="#bcd3e0"/><rect x="330" y="200" width="240" height="60" rx="10" fill="#fbf7ef"/><rect x="330" y="280" width="180" height="60" rx="10" fill="#fbf7ef"/><circle cx="450" cy="808" r="22" fill="#5a6075"/>`),
  },
  {
    id: 'clock',
    kind: 'fg',
    title: '時鐘',
    keywords: ['clock', 'time', 'watch', '時鐘', '鐘', '錶'],
    svg: FG(`<circle cx="450" cy="480" r="330" fill="#fbf7ef" stroke="#8f6c4f" stroke-width="40"/>${Array.from({ length: 12 }, (_, i) => `<rect x="442" y="180" width="16" height="44" fill="#8f6c4f" transform="rotate(${i * 30} 450 480)"/>`).join('')}<path d="M450 480 v-200 M450 480 l140 80" stroke="#3b4154" stroke-width="22" stroke-linecap="round"/><circle cx="450" cy="480" r="22" fill="#3b4154"/>`),
  },
  {
    id: 'medicine',
    kind: 'fg',
    title: '藥袋',
    keywords: ['medicine', 'pill', 'drug', '藥'],
    svg: FG(`<rect x="200" y="200" width="500" height="640" rx="18" fill="#f3f3ef" stroke="#c9d2d0" stroke-width="8"/><rect x="200" y="200" width="500" height="120" rx="18" fill="#9ab7b0"/><path d="M450 230 v60 M420 260 h60" stroke="#fbf7ef" stroke-width="18" stroke-linecap="round"/><path d="M260 400 h380 M260 470 h300 M260 540 h340" stroke="#b9c4c2" stroke-width="16" stroke-linecap="round"/><rect x="300" y="640" width="130" height="64" rx="32" fill="#e2b8ad"/><rect x="470" y="640" width="130" height="64" rx="32" fill="#f2d79b"/>`),
  },
  {
    id: 'cup',
    kind: 'fg',
    title: '杯子',
    keywords: ['cup', 'mug', 'tea', 'coffee', '杯', '茶'],
    svg: FG(`<path d="M220 380 h400 l-40 440 q-4 40 -44 40 h-232 q-40 0 -44 -40 z" fill="#e2b8ad"/><path d="M610 460 q140 0 140 120 t-170 140" fill="none" stroke="#e2b8ad" stroke-width="44"/><ellipse cx="420" cy="380" rx="200" ry="34" fill="#a9876a"/><path d="M360 300 q30 -50 0 -100 M470 300 q30 -50 0 -100" stroke="#c9c2b4" stroke-width="16" fill="none" stroke-linecap="round"/>`),
  },
  {
    id: 'book',
    kind: 'fg',
    title: '書本',
    keywords: ['book', 'diary', 'notebook', '書', '日記', '筆記'],
    svg: FG(`<rect x="200" y="200" width="500" height="660" rx="16" fill="#7d939b"/><rect x="240" y="200" width="30" height="660" fill="#6a7f87"/><rect x="330" y="300" width="300" height="120" rx="8" fill="#fbf7ef"/><path d="M370 340 h220 M370 380 h160" stroke="#b9c4c2" stroke-width="14" stroke-linecap="round"/><rect x="560" y="780" width="40" height="120" fill="#c85f4f"/>`),
  },
];

/** 依名稱把圖庫排序：關鍵字像的排前面。 */
export function galleryFor(kind: 'bg' | 'fg', name: string): GalleryItem[] {
  const n = name.toLowerCase();
  const score = (g: GalleryItem) => (g.keywords.some((k) => n.includes(k.toLowerCase())) ? 1 : 0);
  return GALLERY.filter((g) => g.kind === kind).sort((a, b) => score(b) - score(a));
}

export function svgUrl(g: GalleryItem): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(g.svg)}`;
}

/** 把圖庫的圖轉成 webp（不支援時 png）。 */
export async function galleryBlob(g: GalleryItem): Promise<{ blob: Blob; ext: 'webp' | 'png' }> {
  const img = new Image();
  img.src = svgUrl(g);
  await img.decode();
  let c = document.createElement('canvas');
  if (g.kind === 'bg') {
    c.width = 2304;
    c.height = 1080;
    c.getContext('2d')!.drawImage(img, 0, 0, 2304, 1080);
  } else {
    // 物品：裁到畫的範圍，底部貼齊下緣（和手繪拍照一樣）
    c.width = c.height = 900;
    const g2 = c.getContext('2d', { willReadFrequently: true })!;
    g2.drawImage(img, 0, 0, 900, 900);
    const box = contentBox(g2.getImageData(0, 0, 900, 900)) ?? { x: 0, y: 0, w: 900, h: 900 };
    const fit = fitCutout('fg', box.w, box.h);
    const out = document.createElement('canvas');
    out.width = fit.canvasW;
    out.height = fit.canvasH;
    out.getContext('2d')!.drawImage(c, box.x, box.y, box.w, box.h, fit.x, fit.y, fit.w, fit.h);
    c = out;
  }
  const webp = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.9));
  if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp' };
  const png = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (!png) throw new Error('瀏覽器無法輸出圖片');
  return { blob: png, ext: 'png' };
}
