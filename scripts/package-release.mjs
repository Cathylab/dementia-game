// 打包 Release 壓縮檔（需求書 4.3）：dist-offline/ 的內容＋使用說明，放在一個資料夾裡壓成 zip。
// 用法：npm run package（會先建置）；或 node scripts/package-release.mjs [輸出檔] [版本]
// 不會發佈任何東西：發佈由 .github/workflows/release.yml 在推送版本標籤時做。
import { readdir, readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 壓縮檔裡最外層資料夾的名稱（產品名稱還沒定：需求書「待使用者決定」#1）。 */
export const FOLDER = '同理體驗視覺小說';
/** 只給網站用、離線版不需要的檔案。 */
const SKIP = new Set(['player-template.html', 'projects.json', 'packs.json']);
const STORED = /\.(webp|png|jpe?g|gif|mp3|ogg|m4a|wav|zip)$/i;

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

/** 收集要放進壓縮檔的檔案：壓縮檔內路徑 → 本機路徑。 */
export async function releaseFiles(root = ROOT) {
  const files = new Map();
  const offline = join(root, 'dist-offline');
  for (const p of await walk(offline)) {
    const rel = relative(offline, p).split(sep).join('/');
    if (SKIP.has(rel)) continue;
    files.set(`${FOLDER}/${rel}`, p);
  }
  files.set(`${FOLDER}/使用說明.html`, join(root, 'guide', '使用說明.html'));
  for (const p of await walk(join(root, 'guide', 'usage'))) files.set(`${FOLDER}/usage/${relative(join(root, 'guide', 'usage'), p)}`, p);
  return files;
}

export async function packageRelease(outFile, root = ROOT) {
  const files = await releaseFiles(root);
  if (![...files.keys()].some((k) => k.endsWith('/開始.html'))) throw new Error('dist-offline/ 裡沒有 開始.html，請先 npm run build');
  const zip = {};
  for (const [path, src] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const data = new Uint8Array(await readFile(src));
    zip[path] = STORED.test(path) ? [data, { level: 0 }] : data;
  }
  const bytes = zipSync(zip, { level: 6 });
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, bytes);
  return { outFile, files: files.size, bytes: bytes.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const version = process.argv[3] ?? 'dev';
  const out = resolve(process.argv[2] ?? join(ROOT, 'release', `${FOLDER}-${version}.zip`));
  const r = await packageRelease(out);
  const mb = (r.bytes / 1024 / 1024).toFixed(1);
  console.log(`已產生 ${relative(ROOT, r.outFile)}：${r.files} 個檔案，${mb} MB`);
  if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `file=${r.outFile}\nsize=${mb} MB\n`, { flag: 'a' });
}
