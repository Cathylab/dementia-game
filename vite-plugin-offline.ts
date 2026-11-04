// 離線版建置（vite build --mode offline → dist-offline/）：解壓縮後直接雙擊 html 就能玩（網址是 file://）。
// 瀏覽器在 file:// 下不准載入 ES 模組、不准 fetch 本機檔案，所以：
// - 程式打包成一般 script（iife），連同 CSS 直接寫進 html；
// - 每個專案的 script.json 與音檔清單寫進 html（window.__VN_EMBED__），不用 fetch；
// - 圖片、音檔照舊放在 examples/、templates/ 底下，用相對路徑載入（contentPlugin 負責複製）。
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin, Rollup } from 'vite';
import { listAudioFiles, listProjects, MANIFEST_FOLDERS, readPacks } from './vite-plugin-content.ts';

/** 產生哪些 html：檔名 → 預設載入的專案。 */
export const OFFLINE_PAGES: Record<string, string> = {
  '玩 Demo.html': 'examples/寫給未來的我',
  '空白範本.html': 'templates/空白',
};

/** 放進 <script> 裡的文字不能出現 </script 或 <!--。 */
function safeScript(code: string): string {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function offlinePlugin(): Plugin {
  let root = '';
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
      const html = bundle['index.html'] as Rollup.OutputAsset | undefined;
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
        projects[p.dir] = { title: p.title, kind: p.kind, script, manifests };
      }

      const packs = await readPacks(root);

      // 去掉原本的 <script type="module" src> 與 <link rel="stylesheet|modulepreload">
      const base = String(html.source)
        .replace(/<script\b[^>]*\bsrc=[^>]*><\/script>\s*/g, '')
        .replace(/<link\b[^>]*\brel="(?:stylesheet|modulepreload)"[^>]*>\s*/g, '');

      for (const [fileName, defaultProject] of Object.entries(OFFLINE_PAGES)) {
        if (!(defaultProject in projects)) continue;
        const embed = JSON.stringify({ defaultProject, projects, packs }).replace(/</g, '\\u003c');
        const title = (projects[defaultProject] as { title: string }).title;
        const page = base
          .replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(title)}</title>`)
          .replace('</head>', () => `    <style>\n${css}\n    </style>\n  </head>`)
          .replace(
            '</body>',
            () => `    <script>window.__VN_EMBED__ = ${embed};</script>\n    <script>\n${safeScript(entry.code)}\n    </script>\n  </body>`,
          );
        this.emitFile({ type: 'asset', fileName, source: page });
      }
      // 原本的 index.html、js、css 都已經寫進上面的 html 了
      delete bundle['index.html'];
      delete bundle[entry.fileName];
      for (const f of files) if (f.type === 'asset' && f.fileName.endsWith('.css')) delete bundle[f.fileName];
    },
  };
}
