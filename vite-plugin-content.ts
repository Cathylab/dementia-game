// 內容資料夾：examples/（範例遊戲）、templates/（範本）、packs/（題材包）。
// - 開發模式：直接從 repo 提供這些檔案。
// - 建置：原樣複製到輸出資料夾。
// - 每個專案（examples/*、templates/*）產生 assets/voice/manifest.json、assets/sfx/manifest.json，
//   列出實際存在的音檔：遊戲只請求清單上有的檔案，缺檔時不發請求，主控台不會出現 404。
// - 產生 projects.json：所有專案的路徑與標題（給之後的引導網站用）。
import { createReadStream } from 'node:fs';
import { cp, readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

export const CONTENT_FOLDERS = ['examples', 'templates', 'packs'] as const;
/** 有清單的音檔資料夾（專案的 assets/ 底下）。 */
export const MANIFEST_FOLDERS = ['voice', 'sfx'] as const;

const MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export async function listAudioFiles(projectRoot: string, folder: string): Promise<string[]> {
  try {
    const files = await readdir(join(projectRoot, 'assets', folder));
    return files.filter((f) => /\.(mp3|ogg)$/i.test(f)).sort();
  } catch {
    return [];
  }
}

export interface ProjectEntry {
  /** 例如 examples/寫給未來的我 */
  dir: string;
  kind: 'example' | 'template';
  title: string;
}

/** 列出所有專案（有 script.json 的 examples/*、templates/*）。 */
export async function listProjects(root: string): Promise<ProjectEntry[]> {
  const out: ProjectEntry[] = [];
  for (const [top, kind] of [
    ['examples', 'example'],
    ['templates', 'template'],
  ] as const) {
    let names: string[] = [];
    try {
      names = (await readdir(join(root, top))).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      try {
        const script = JSON.parse(await readFile(join(root, top, name, 'script.json'), 'utf8')) as { meta?: { title?: string } };
        out.push({ dir: `${top}/${name}`, kind, title: script.meta?.title ?? name });
      } catch {
        /* 沒有 script.json 的資料夾不算專案 */
      }
    }
  }
  return out;
}

export function contentPlugin(): Plugin {
  let root = '';
  let outDir = '';
  return {
    name: 'vn-content',
    configResolved(config) {
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (url === '/projects.json') {
          void listProjects(root).then((list) => {
            res.setHeader('Content-Type', MIME['.json']);
            res.setHeader('Cache-Control', 'no-cache');
            res.end(JSON.stringify(list));
          });
          return;
        }
        const top = url.split('/')[1];
        if (!(CONTENT_FOLDERS as readonly string[]).includes(top)) return next();
        const file = resolve(root, `.${url}`);
        // 不允許 ../ 跑出內容資料夾
        if (!file.startsWith(resolve(root, top) + sep)) return next();
        // 音檔清單：每次請求都重新掃描，放進新音檔不用重開伺服器
        const m = url.match(/^\/((?:examples|templates)\/[^/]+)\/assets\/(voice|sfx)\/manifest\.json$/);
        if (m) {
          void listAudioFiles(resolve(root, m[1]), m[2]).then((files) => {
            res.setHeader('Content-Type', MIME['.json']);
            res.setHeader('Cache-Control', 'no-cache');
            res.end(JSON.stringify(files));
          });
          return;
        }
        void stat(file).then(
          (s) => {
            if (!s.isFile()) return next();
            res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
            res.setHeader('Cache-Control', 'no-cache');
            createReadStream(file).pipe(res);
          },
          () => next(),
        );
      });
    },
    // 建置：放進 bundle 的小檔案（清單）
    async generateBundle() {
      const projects = await listProjects(root);
      this.emitFile({ type: 'asset', fileName: 'projects.json', source: JSON.stringify(projects) });
      for (const p of projects) {
        for (const folder of MANIFEST_FOLDERS) {
          this.emitFile({
            type: 'asset',
            fileName: `${p.dir}/assets/${folder}/manifest.json`,
            source: JSON.stringify(await listAudioFiles(join(root, p.dir), folder)),
          });
        }
      }
    },
    // 建置：素材原樣複製（圖片、音檔不經過打包）
    async closeBundle() {
      for (const top of CONTENT_FOLDERS) {
        try {
          await cp(join(root, top), join(outDir, top), {
            recursive: true,
            // 清單由 generateBundle 產生，不要被舊檔蓋掉
            filter: (src) => !/[\\/]manifest\.json$/.test(src) && !src.endsWith('.gitkeep'),
          });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
      }
    },
  };
}
