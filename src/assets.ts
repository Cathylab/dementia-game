// 圖片素材解析：先嘗試載入 public/assets 下的真實檔案，不存在時以 canvas 產生佔位圖。
import { hash, seeded } from './util';

export type ImageKind = 'bg' | 'char' | 'fg';

const BASE = `${import.meta.env.BASE_URL}assets`;
const cache = new Map<string, Promise<string>>();

export function assetPath(kind: ImageKind, name: string): string {
  return `${BASE}/${kind}/${name}.png`;
}

/** 回傳可直接放進 <img src> 或 background-image 的網址。 */
export function resolveImage(kind: ImageKind, name: string): Promise<string> {
  const key = `${kind}/${name}`;
  let p = cache.get(key);
  if (!p) {
    const url = assetPath(kind, name);
    p = new Promise<string>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = () => resolve(placeholder(kind, name));
      img.src = url;
    });
    cache.set(key, p);
  }
  return p;
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

/** 背景：色塊＋簡單形狀＋場景名稱文字。 */
function drawBackground(name: string): string {
  const [c, g] = canvas(1920, 1080);
  const rnd = seeded(name);
  const hue = hash(name) % 360;
  const night = /night|dark|dusk/.test(name);
  const light = night ? 18 : 52;
  const grad = g.createLinearGradient(0, 0, 0, 1080);
  grad.addColorStop(0, `hsl(${hue} 35% ${light + 14}%)`);
  grad.addColorStop(1, `hsl(${(hue + 30) % 360} 30% ${light - 10}%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 1920, 1080);
  // 地平線與幾塊家具／建築色塊
  g.fillStyle = `hsl(${hue} 25% ${light - 16}%)`;
  g.fillRect(0, 700, 1920, 380);
  for (let i = 0; i < 7; i++) {
    const w = 120 + rnd() * 320;
    const h = 120 + rnd() * 420;
    const x = rnd() * 1920;
    g.fillStyle = `hsl(${(hue + rnd() * 60) % 360} ${20 + rnd() * 25}% ${light - 20 + rnd() * 30}% / 0.85)`;
    g.fillRect(x, 720 - h * 0.6, w, h);
  }
  // 窗戶或光源
  g.fillStyle = night ? 'hsl(50 60% 75% / 0.35)' : 'hsl(50 80% 92% / 0.5)';
  g.beginPath();
  g.arc(300 + rnd() * 1300, 200 + rnd() * 150, 90 + rnd() * 60, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.78)';
  g.font = `bold 96px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 960, 470);
  g.font = `40px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillText(`assets/bg/${name}.png`, 960, 570);
  return c.toDataURL('image/png');
}

/** 立繪：深色剪影。檔名為 {角色id}_{表情}。 */
function drawCharacter(name: string): string {
  const [c, g] = canvas(640, 1200);
  const [id, expression = ''] = splitCharName(name);
  const hue = hash(id) % 360;
  g.fillStyle = `hsl(${hue} 18% 13%)`;
  // 頭
  g.beginPath();
  g.ellipse(320, 260, 120, 140, 0, 0, Math.PI * 2);
  g.fill();
  // 脖子＋身體
  g.beginPath();
  g.moveTo(270, 380);
  g.lineTo(370, 380);
  g.lineTo(380, 440);
  g.bezierCurveTo(560, 470, 610, 600, 620, 1200);
  g.lineTo(20, 1200);
  g.bezierCurveTo(30, 600, 80, 470, 260, 440);
  g.closePath();
  g.fill();
  // 角色識別色帶（之後換成真實立繪即可）
  g.fillStyle = `hsl(${hue} 55% 45% / 0.9)`;
  g.fillRect(250, 150, 140, 18);
  // 表情提示：眼睛與嘴的線條
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 6;
  g.lineCap = 'round';
  const mouth = { smile: 1, sad: -1, worried: -0.5 }[expression] ?? 0;
  g.beginPath();
  g.moveTo(270, 250);
  g.lineTo(295, 250);
  g.moveTo(345, 250);
  g.lineTo(370, 250);
  g.moveTo(285, 320);
  g.quadraticCurveTo(320, 320 + mouth * 22, 355, 320);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.4)';
  g.font = `34px ${FONT}`;
  g.textAlign = 'center';
  g.fillText(name, 320, 1150);
  return c.toDataURL('image/png');
}

/** 前景物件：簡單形狀。 */
function drawObject(name: string): string {
  const [c, g] = canvas(900, 560);
  const rnd = seeded(name);
  const hue = hash(name) % 360;
  g.fillStyle = `hsl(${hue} 30% 22%)`;
  // 手
  g.beginPath();
  g.ellipse(450, 560, 330, 150, 0, Math.PI, Math.PI * 2);
  g.fill();
  g.fillStyle = `hsl(${hue} 50% 55%)`;
  g.strokeStyle = `hsl(${hue} 40% 25%)`;
  g.lineWidth = 8;
  const shape = Math.floor(rnd() * 3);
  g.beginPath();
  if (shape === 0) g.roundRect(230, 170, 440, 250, 30);
  else if (shape === 1) g.ellipse(450, 300, 210, 140, 0, 0, Math.PI * 2);
  else g.roundRect(330, 110, 240, 330, 40);
  g.fill();
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.font = `bold 48px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 450, 300);
  return c.toDataURL('image/png');
}

export function splitCharName(name: string): [string, string] {
  const i = name.lastIndexOf('_');
  return i < 0 ? [name, ''] : [name.slice(0, i), name.slice(i + 1)];
}
