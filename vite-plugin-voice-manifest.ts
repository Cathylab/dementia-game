// 配音（v3）與音效：產生 assets/voice/manifest.json、assets/sfx/manifest.json，列出實際存在的音檔。
// 遊戲只請求清單上有的檔案，缺檔時完全不發請求，瀏覽器主控台不會出現 404 紅字。
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** 有清單的音檔資料夾（public/assets/ 底下）。 */
const FOLDERS = ['voice', 'sfx'] as const;
const manifestPath = (folder: string) => `assets/${folder}/manifest.json`;

export async function listAudioFiles(publicDir: string, folder: string): Promise<string[]> {
  try {
    const files = await readdir(resolve(publicDir, 'assets', folder));
    return files.filter((f) => /\.(mp3|ogg)$/i.test(f)).sort();
  } catch {
    return [];
  }
}

export function voiceManifestPlugin(): Plugin {
  let publicDir = '';
  return {
    name: 'dementia-voice-manifest',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    // 開發模式：每次請求都重新掃描，放進新音檔不用重開伺服器
    configureServer(server) {
      for (const folder of FOLDERS) {
        server.middlewares.use(`/${manifestPath(folder)}`, (_req, res) => {
          void listAudioFiles(publicDir, folder).then((files) => {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
            res.end(JSON.stringify(files));
          });
        });
      }
    },
    // 建置：把清單寫進輸出資料夾
    async generateBundle() {
      for (const folder of FOLDERS) {
        this.emitFile({ type: 'asset', fileName: manifestPath(folder), source: JSON.stringify(await listAudioFiles(publicDir, folder)) });
      }
    },
  };
}
