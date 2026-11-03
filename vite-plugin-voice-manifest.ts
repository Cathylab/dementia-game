// 配音（v3）：產生 assets/voice/manifest.json，列出 public/assets/voice 裡實際存在的音檔。
// 遊戲只請求清單上有的檔案，缺檔時完全不發請求，瀏覽器主控台不會出現 404 紅字。
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

const MANIFEST = 'assets/voice/manifest.json';

async function listVoiceFiles(publicDir: string): Promise<string[]> {
  try {
    const files = await readdir(resolve(publicDir, 'assets/voice'));
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
      server.middlewares.use(`/${MANIFEST}`, (_req, res) => {
        void listVoiceFiles(publicDir).then((files) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(JSON.stringify(files));
        });
      });
    },
    // 建置：把清單寫進輸出資料夾
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: MANIFEST, source: JSON.stringify(await listVoiceFiles(publicDir)) });
    },
  };
}
