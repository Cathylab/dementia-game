// 離線版建置（vite build --mode offline → dist-offline/）：解壓縮後直接雙擊 html 就能玩（網址是 file://）。
// 瀏覽器在 file:// 下不准載入 ES 模組、不准 fetch 本機檔案，所以：
// - 程式打包成一般 script（iife），連同 CSS 直接寫進 html；
// - 每個專案的 script.json 與音檔清單寫進 html（window.__VN_EMBED__），不用 fetch；
// - 圖片、音檔照舊放在 examples/、templates/ 底下，用相對路徑載入（contentPlugin 負責複製）。
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin, Rollup } from 'vite';
import { listAudioFiles, listProjects, MANIFEST_FOLDERS, readPacks } from './vite-plugin-content.ts';

/** 產生哪些 html：檔名 → 引導網站或遊戲、預設載入的專案。 */
export const OFFLINE_PAGES: Record<string, { page: 'guide' | 'game'; project: string }> = {
  '開始.html': { page: 'guide', project: 'examples/寫給未來的我' },
  '玩 Demo.html': { page: 'game', project: 'examples/寫給未來的我' },
  '空白範本.html': { page: 'game', project: 'templates/空白' },
};

/** 放進 <script> 裡的文字不能出現 </script 或 <!--。 */
function safeScript(code: string): string {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const PLAYER_TEMPLATE = 'player-template.html';

export function offlinePlugin(): Plugin {
  let root = '';
  let templateSource = '';
  return {
    name: 'vn-offline',
    apply: 'build',
    // 要在 Vite 產生 index.html 之後
    enforce: 'post',
    configResolved(config) {
      root = config.root;
    },
    async generateBundle(_options, bundle) {
      const files = Object.values(bundle);
      const entry = files.find((f): f is Rollup.OutputChunk => f.type === 'chunk' && f.isEntry);
      const html = files.find((f): f is Rollup.OutputAsset => f.type === 'asset' && f.fileName.endsWith('.html'));
      if (!entry || !html) throw new Error('離線版建置：找不到入口程式或 index.html');
      const css = files
        .filter((f): f is Rollup.OutputAsset => f.type === 'asset' && f.fileName.endsWith('.css'))
        .map((f) => String(f.source))
        .join('\n');

      const projects: Record<string, unknown> = {};
      for (const p of await listProjects(root)) {
        const manifests: Record<string, string[]> = {};
        for (const folder of MANIFEST_FOLDERS) manifests[folder] = await listAudioFiles(join(root, p.dir), folder);
        const script = JSON.parse(await readFile(join(root, p.dir, 'script.json'), 'utf8')) as unknown;
        // 成效評估問卷（選用）
        const survey = await readFile(join(root, p.dir, 'survey.json'), 'utf8').then((t) => JSON.parse(t) as unknown, () => undefined);
        projects[p.dir] = { title: p.title, kind: p.kind, script, manifests, ...(survey ? { survey } : {}) };
      }

      const packs = await readPacks(root);
      // 題材包的說明文件（寫作準則、注意事項）也放進去：引導流程的提示詞會用
      for (const [id, p] of Object.entries(packs)) {
        const docs = (p.docs ?? {}) as Record<string, string>;
        const texts: Record<string, string> = {};
        for (const [key, file] of Object.entries(docs)) {
          try {
            texts[key] = await readFile(join(root, 'packs', id, file), 'utf8');
          } catch {
            /* 沒有這個檔案就算了 */
          }
        }
        p._docs = texts;
      }

      // 去掉原本的 <script type="module" src> 與 <link rel="stylesheet|modulepreload">
      const base = String(html.source)
        .replace(/<script\b[^>]*\bsrc=[^>]*><\/script>\s*/g, '')
        .replace(/<link\b[^>]*\brel="(?:stylesheet|modulepreload)"[^>]*>\s*/g, '');

      // 每個專案用哪個 html 開（引導網站的連結用）
      const pages: Record<string, string> = {};
      for (const [fileName, p] of Object.entries(OFFLINE_PAGES)) if (p.page === 'game') pages[p.project] = fileName;
      for (const [fileName, { page, project: defaultProject }] of Object.entries(OFFLINE_PAGES)) {
        if (!(defaultProject in projects)) continue;
        const embed = JSON.stringify({ page, defaultProject, projects, packs, pages }).replace(/</g, '\\u003c');
        const title = page === 'guide' ? '開始做你的遊戲' : (projects[defaultProject] as { title: string }).title;
        const out = base
          .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(title)}</title>`)
          .replace(/data-page="[^"]*"/, () => `data-page="${page}"`)
          .replace('</head>', () => `    <style id="vn-style">\n${css}\n    </style>\n  </head>`)
          .replace(
            '</body>',
            () => `    <script>window.__VN_EMBED__ = ${embed};</script>\n    <script id="vn-engine">\n${safeScript(entry.code)}\n    </script>\n  </body>`,
          );
        this.emitFile({ type: 'asset', fileName, source: out });
      }
      // 匯出「可以玩的版本」用的樣板：引導網站讀它的樣式與程式（離線版直接讀自己頁面上的）
      const template = base
        .replace('</head>', () => `    <style id="vn-style">\n${css}\n    </style>\n  </head>`)
        .replace('</body>', () => `    <script id="vn-engine">\n${safeScript(entry.code)}\n    </script>\n  </body>`);
      this.emitFile({ type: 'asset', fileName: PLAYER_TEMPLATE, source: template });
      // 網站版（dist/）也放一份：網站上的引導網站匯出時用
      templateSource = template;
      // 原本的 html、js、css 都已經寫進上面的 html 了
      delete bundle[html.fileName];
      delete bundle[entry.fileName];
      for (const f of files) if (f.type === 'asset' && f.fileName.endsWith('.css')) delete bundle[f.fileName];
    },
    // 網站版先建置（dist/），離線版後建置：把樣板也放進 dist/
    async closeBundle() {
      if (!templateSource) return;
      const dist = join(root, 'dist');
      try {
        await access(dist);
      } catch {
        return;
      }
      await writeFile(join(dist, PLAYER_TEMPLATE), templateSource);
    },
  };
}
