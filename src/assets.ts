// 圖片素材解析：先嘗試載入 public/assets 下的真實檔案（.webp、.png、.jpg 依序），
// 都不存在時以 canvas 產生佔位圖。
import { localFileUrl } from './localfiles';
import { assetBase } from './paths';
import { IMAGE_EXTENSIONS } from './script';
import { hash, seeded } from './util';

export type ImageKind = 'bg' | 'char' | 'fg';

const cache = new Map<string, Promise<string>>();

export function assetPath(kind: ImageKind, name: string, ext = 'png'): string {
  return `${assetBase()}/${kind}/${name}.${ext}`;
}

/** 回傳可直接放進 <img src> 或 background-image 的網址。 */
export function resolveImage(kind: ImageKind, name: string): Promise<string> {
  const key = `${kind}/${name}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const local = localFileUrl(kind, name, IMAGE_EXTENSIONS);
      if (local) return local;
      for (const ext of IMAGE_EXTENSIONS) {
        const url = assetPath(kind, name, ext);
        if (await loads(url)) return url;
      }
      return placeholder(kind, name);
    })();
    cache.set(key, p);
  }
  return p;
}

/**
 * 本機素材換了（上傳、開啟專案檔）：忘掉之前找到的結果，下次重新找。
 * 立繪換了表情檔以後，之前退回 neutral 的結果也要重新找，所以整個角色的快取一起清掉。
 */
export function forgetImage(kind: ImageKind, name: string): void {
  if (kind === 'char') {
    const [id] = splitCharName(name);
    for (const key of [...cache.keys()]) if (key.startsWith(`char/${id}_`)) cache.delete(key);
  }
  cache.delete(`${kind}/${name}`);
}

function loads(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

const sizes = new Map<string, Promise<{ width: number; height: number }>>();

/** 圖片的原始寬高（物件熱點要對齊背景圖時用）。 */
export function imageSize(url: string): Promise<{ width: number; height: number }> {
  let p = sizes.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 16, height: 9 });
      img.src = url;
    });
    sizes.set(url, p);
  }
  return p;
}

/**
 * 立繪：先找 {id}_{expression}，沒有就找 {id}_neutral，再沒有才用佔位圖
 * （佔位圖上寫的是原本要的表情，方便知道缺哪張）。
 */
export async function resolveSprite(charId: string, expression: string): Promise<string> {
  const url = await resolveImage('char', `${charId}_${expression}`);
  if (!isPlaceholder(url) || expression === 'neutral') return url;
  const neutral = await resolveImage('char', `${charId}_neutral`);
  return isPlaceholder(neutral) ? url : neutral;
}

/** 是否為程式產生的佔位圖（測試與開發者面板用）。 */
export function isPlaceholder(url: string): boolean {
  return url.startsWith('data:');
}

function placeholder(kind: ImageKind, name: string): string {
  if (kind === 'bg') return drawBackground(name);
  if (kind === 'char') return drawCharacter(name);
  return drawObject(name);
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

const FONT = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif';

// ───────── 佔位圖（需求書 5.4）：沒有任何圖片也能拿去展示 ─────────
// 依名稱決定一致的色調與構圖（同一個名稱永遠畫一樣的圖），柔和的水彩感色塊，不寫大字。

interface Palette {
  wall: [string, string];
  floor: string;
  accent: string;
  light: string;
}

const PALETTES: Palette[] = [
  { wall: ['#efe3cf', '#d9c4a4'], floor: '#b89a74', accent: '#8a6f55', light: '#fff6dc' },
  { wall: ['#dfe6e2', '#bccbc4'], floor: '#9aa99f', accent: '#6c7f77', light: '#f4fbf6' },
  { wall: ['#ece0e4', '#d4bfc6'], floor: '#b39aa3', accent: '#87707a', light: '#fff4f6' },
  { wall: ['#e2e6ef', '#c3cadb'], floor: '#9ea6ba', accent: '#6f7890', light: '#f5f7ff' },
  { wall: ['#efe8d6', '#d8cba7'], floor: '#b7a57d', accent: '#7f7356', light: '#fffbe8' },
];
const NIGHT: Palette = { wall: ['#2b2f3d', '#1c1f2a'], floor: '#15171f', accent: '#3b4154', light: '#f3d99a' };

type SceneKind = 'home' | 'school' | 'outdoor' | 'stage' | 'shop';

function sceneKind(name: string): SceneKind {
  const n = name.toLowerCase();
  if (/stage|hall|banquet|theat|auditorium|wedding|ceremony/.test(n)) return 'stage';
  if (/school|class|corridor|campus|library/.test(n)) return 'school';
  if (/car|bus|train|street|road|outdoor|park|garden|beach|station/.test(n)) return 'outdoor';
  if (/shop|store|market|clinic|hospital|office|bridal/.test(n)) return 'shop';
  return 'home';
}

/** 紙張質感：細小的淡色斑點。 */
function grain(g: CanvasRenderingContext2D, w: number, h: number, rnd: () => number, dark: boolean): void {
  g.fillStyle = dark ? 'rgba(255,255,255,0.025)' : 'rgba(80,60,40,0.035)';
  for (let i = 0; i < 2600; i++) g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
}

function softRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, r = 18): void {
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

function vignette(g: CanvasRenderingContext2D, w: number, h: number, strength: number): void {
  const v = g.createRadialGradient(w / 2, h * 0.45, h * 0.3, w / 2, h / 2, w * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, `rgba(20,14,8,${strength})`);
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
}

/** 背景：依名稱的種類（室內、教室、戶外、舞台、店家）與色調畫一張安靜的場景。 */
function drawBackground(name: string): string {
  const W = 2304;
  const H = 1080;
  const [c, g] = canvas(W, H);
  const rnd = seeded(name);
  const night = /night|midnight|dark|dusk|evening/.test(name.toLowerCase());
  const pal = night ? NIGHT : PALETTES[hash(name) % PALETTES.length];
  const kind = sceneKind(name);
  const horizon = H * (0.62 + rnd() * 0.06);

  // 牆面（或天空）
  const wall = g.createLinearGradient(0, 0, 0, horizon);
  wall.addColorStop(0, pal.wall[0]);
  wall.addColorStop(1, pal.wall[1]);
  g.fillStyle = wall;
  g.fillRect(0, 0, W, horizon);
  // 地面
  const floor = g.createLinearGradient(0, horizon, 0, H);
  floor.addColorStop(0, pal.floor);
  floor.addColorStop(1, pal.accent);
  g.fillStyle = floor;
  g.fillRect(0, horizon, W, H - horizon);

  const window = (x: number, y: number, w: number, h: number) => {
    softRect(g, x - 10, y - 10, w + 20, h + 20, pal.accent, 10);
    const sky = g.createLinearGradient(0, y, 0, y + h);
    sky.addColorStop(0, night ? '#1b2440' : '#cfe3f0');
    sky.addColorStop(1, night ? '#2c3554' : pal.light);
    softRect(g, x, y, w, h, '', 6);
    g.fillStyle = sky;
    g.fill();
    g.fillStyle = pal.accent;
    g.fillRect(x + w / 2 - 5, y, 10, h);
    g.fillRect(x, y + h / 2 - 5, w, 10);
  };

  if (kind === 'home') {
    window(W * (0.55 + rnd() * 0.15), H * 0.14, 420, 340);
    softRect(g, W * 0.06, H * 0.2, 360, horizon - H * 0.2 + 30, pal.accent + 'cc'); // 櫃子
    softRect(g, W * 0.3, horizon - 40, 640, 46, pal.accent); // 桌面
    softRect(g, W * 0.33, horizon, 24, 230, pal.accent);
    softRect(g, W * 0.3 + 600, horizon, 24, 230, pal.accent);
  } else if (kind === 'school') {
    softRect(g, W * 0.12, H * 0.16, 900, 300, night ? '#26332c' : '#3f5a4c', 8); // 黑板
    for (let i = 0; i < 3; i++) window(W * 0.62 + i * 250, H * 0.16, 200, 300);
    for (let r = 0; r < 2; r++)
      for (let i = 0; i < 5; i++) softRect(g, W * 0.08 + i * 420 + r * 120, horizon + 60 + r * 150, 260, 36, pal.accent, 8);
  } else if (kind === 'outdoor') {
    // 遠山、路
    g.fillStyle = pal.accent + '88';
    g.beginPath();
    g.moveTo(0, horizon);
    for (let x = 0; x <= W; x += W / 8) g.lineTo(x, horizon - 80 - rnd() * 140);
    g.lineTo(W, horizon);
    g.fill();
    g.fillStyle = pal.wall[1];
    g.beginPath();
    g.moveTo(W * 0.42, horizon);
    g.lineTo(W * 0.58, horizon);
    g.lineTo(W * 0.85, H);
    g.lineTo(W * 0.15, H);
    g.fill();
    g.fillStyle = night ? 'rgba(243,217,154,0.6)' : 'rgba(255,255,255,0.7)';
    g.beginPath();
    g.arc(W * (0.2 + rnd() * 0.6), H * 0.18, 60, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 'stage') {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 0, W, H);
    for (const side of [0, 1]) {
      const x = side ? W * 0.82 : 0;
      const cur = g.createLinearGradient(x, 0, x + W * 0.18, 0);
      cur.addColorStop(0, '#5a2230');
      cur.addColorStop(1, '#7a3442');
      g.fillStyle = cur;
      g.fillRect(x, 0, W * 0.18, H);
    }
    const spot = g.createRadialGradient(W / 2, horizon + 40, 20, W / 2, horizon + 40, 520);
    spot.addColorStop(0, 'rgba(255,240,200,0.55)');
    spot.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = spot;
    g.fillRect(0, 0, W, H);
  } else {
    for (let i = 0; i < 4; i++) softRect(g, W * 0.06 + i * 300, H * 0.18, 240, horizon - H * 0.18 - 20, pal.accent + 'aa', 8); // 架子
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) softRect(g, W * 0.07 + i * 300, H * 0.24 + j * 140, 200, 18, pal.light + 'cc', 4);
    softRect(g, W * 0.55, horizon - 120, 700, 140, pal.accent, 12); // 櫃台
    window(W * 0.62, H * 0.12, 380, 280);
  }

  // 窗光
  const glow = g.createRadialGradient(W * 0.68, H * 0.3, 40, W * 0.68, H * 0.3, 700);
  glow.addColorStop(0, night ? 'rgba(243,217,154,0.18)' : 'rgba(255,250,235,0.35)');
  glow.addColorStop(1, 'rgba(255,250,235,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  grain(g, W, H, rnd, night);
  vignette(g, W, H, night ? 0.5 : 0.28);

  // 小標籤：讓作者知道這是哪一張（不搶畫面）
  g.font = `28px ${FONT}`;
  const label = `${name}（佔位）`;
  const tw = g.measureText(label).width;
  // 背景比畫面寬（左右各約 8% 會被裁掉），標籤放在一定看得到的左上角
  const lx = W * 0.1;
  softRect(g, lx, 36, tw + 36, 48, 'rgba(0,0,0,0.22)', 24);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.textBaseline = 'middle';
  g.fillText(label, lx + 18, 60);
  return c.toDataURL('image/png');
}

/** 立繪：柔和的剪影。檔名為 {角色id}_{表情}。 */
function drawCharacter(name: string): string {
  const [c, g] = canvas(640, 1200);
  const [id, expression = ''] = splitCharName(name);
  const hue = hash(id) % 360;
  const body = g.createLinearGradient(0, 200, 0, 1200);
  body.addColorStop(0, `hsl(${hue} 22% 34%)`);
  body.addColorStop(1, `hsl(${hue} 26% 20%)`);
  g.fillStyle = body;
  // 頭
  g.beginPath();
  g.ellipse(320, 260, 118, 138, 0, 0, Math.PI * 2);
  g.fill();
  // 頭髮（依角色不同的長度）
  const hairLong = hash(`${id}hair`) % 3;
  g.fillStyle = `hsl(${hue} 18% 18%)`;
  g.beginPath();
  g.ellipse(320, 215, 128, 110, 0, Math.PI, Math.PI * 2);
  if (hairLong === 2) {
    g.rect(192, 215, 40, 230);
    g.rect(408, 215, 40, 230);
  }
  g.fill();
  // 脖子＋身體
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(275, 380);
  g.lineTo(365, 380);
  g.lineTo(378, 440);
  g.bezierCurveTo(560, 470, 610, 620, 620, 1200);
  g.lineTo(20, 1200);
  g.bezierCurveTo(30, 620, 80, 470, 262, 440);
  g.closePath();
  g.fill();
  // 邊緣光
  g.strokeStyle = `hsl(${hue} 40% 70% / 0.35)`;
  g.lineWidth = 6;
  g.beginPath();
  g.ellipse(320, 260, 118, 138, 0, -Math.PI * 0.9, -Math.PI * 0.1);
  g.stroke();
  // 表情：淡淡的眼睛與嘴
  g.strokeStyle = 'rgba(255,255,255,0.28)';
  g.lineWidth = 5;
  g.lineCap = 'round';
  const mouth = { smile: 1, sad: -1, worried: -0.5 }[expression] ?? 0;
  g.beginPath();
  g.moveTo(275, 262);
  g.lineTo(298, 262);
  g.moveTo(342, 262);
  g.lineTo(365, 262);
  g.moveTo(292, 325);
  g.quadraticCurveTo(320, 325 + mouth * 18, 348, 325);
  g.stroke();
  return c.toDataURL('image/png');
}

type ObjectIcon = 'glasses' | 'paper' | 'phone' | 'bag' | 'ring' | 'cup' | 'gem';

function objectIcon(name: string): ObjectIcon {
  const n = name.toLowerCase();
  if (/glass/.test(n)) return 'glasses';
  if (/letter|note|paper|essay|book|invitation|speech|roll|card|diary|photo/.test(n)) return 'paper';
  if (/phone|chat|album|tablet/.test(n)) return 'phone';
  if (/bag|medicine|pill|box/.test(n)) return 'bag';
  if (/ring|necklace|collar|veil|qipao|charm|bracelet/.test(n)) return 'ring';
  if (/cup|tea|mug|bottle/.test(n)) return 'cup';
  return 'gem';
}

/** 物品：透明背景上的簡單圖示（依名稱猜種類），柔和的光暈。 */
function drawObject(name: string): string {
  const W = 900;
  const H = 560;
  const [c, g] = canvas(W, H);
  const hue = hash(name) % 360;
  const cx = W / 2;
  const cy = H * 0.56;
  const halo = g.createRadialGradient(cx, cy, 20, cx, cy, 260);
  halo.addColorStop(0, `hsl(${hue} 60% 85% / 0.55)`);
  halo.addColorStop(1, `hsl(${hue} 60% 85% / 0)`);
  g.fillStyle = halo;
  g.fillRect(0, 0, W, H);
  const fill = `hsl(${hue} 35% 62%)`;
  const ink = `hsl(${hue} 30% 28%)`;
  g.lineWidth = 10;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = ink;
  g.fillStyle = fill;
  const icon = objectIcon(name);
  g.beginPath();
  if (icon === 'glasses') {
    g.arc(cx - 110, cy, 80, 0, Math.PI * 2);
    g.moveTo(cx + 190, cy);
    g.arc(cx + 110, cy, 80, 0, Math.PI * 2);
    g.fillStyle = `hsl(${hue} 50% 90% / 0.6)`;
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(cx - 30, cy - 10);
    g.quadraticCurveTo(cx, cy - 34, cx + 30, cy - 10);
    g.stroke();
  } else if (icon === 'paper') {
    g.roundRect(cx - 150, cy - 190, 300, 360, 14);
    g.fillStyle = '#f7f2e6';
    g.fill();
    g.stroke();
    g.lineWidth = 6;
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.moveTo(cx - 100, cy - 120 + i * 50);
      g.lineTo(cx + (i === 5 ? 20 : 100), cy - 120 + i * 50);
      g.stroke();
    }
  } else if (icon === 'phone') {
    g.roundRect(cx - 110, cy - 210, 220, 400, 34);
    g.fill();
    g.stroke();
    softRect(g, cx - 85, cy - 170, 170, 300, `hsl(${hue} 40% 92%)`, 12);
  } else if (icon === 'bag') {
    g.roundRect(cx - 160, cy - 100, 320, 250, 30);
    g.fill();
    g.stroke();
    g.beginPath();
    g.arc(cx, cy - 100, 70, Math.PI, 0);
    g.stroke();
  } else if (icon === 'ring') {
    g.lineWidth = 26;
    g.strokeStyle = fill;
    g.arc(cx, cy, 130, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 6;
    g.strokeStyle = ink;
    g.beginPath();
    g.arc(cx, cy, 145, 0, Math.PI * 2);
    g.stroke();
  } else if (icon === 'cup') {
    g.roundRect(cx - 120, cy - 120, 240, 250, [10, 10, 60, 60]);
    g.fill();
    g.stroke();
    g.beginPath();
    g.arc(cx + 150, cy, 50, -Math.PI / 2, Math.PI / 2);
    g.stroke();
  } else {
    g.moveTo(cx, cy - 170);
    g.lineTo(cx + 150, cy);
    g.lineTo(cx, cy + 170);
    g.lineTo(cx - 150, cy);
    g.closePath();
    g.fill();
    g.stroke();
  }
  return c.toDataURL('image/png');
}

export function splitCharName(name: string): [string, string] {
  const i = name.lastIndexOf('_');
  return i < 0 ? [name, ''] : [name.slice(0, i), name.slice(i + 1)];
}
