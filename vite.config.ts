import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { contentPlugin } from './vite-plugin-content.ts';
import { offlinePlugin } from './vite-plugin-offline.ts';
import { scriptSavePlugin } from './vite-plugin-script-save.ts';

// base: './' 讓建置結果可以放在任何子路徑下（例如 GitHub Pages 的 /<repo>/）。
// 遊戲內容不在 public/，而在 examples/、templates/、packs/，由 contentPlugin 提供與複製。
// index.html 是引導網站（首頁），play.html 是遊戲；兩頁用同一份程式（src/main.ts 依 data-page 決定）。
// --mode offline：建置雙擊就能玩的離線版到 dist-offline/（見 vite-plugin-offline.ts）。
export default defineConfig(({ mode }) => {
  const offline = mode === 'offline';
  return {
    base: './',
    publicDir: false,
    plugins: [scriptSavePlugin(), contentPlugin(), ...(offline ? [offlinePlugin()] : [])],
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 1000,
      outDir: offline ? 'dist-offline' : 'dist',
      ...(offline
        ? {
            modulePreload: false,
            cssCodeSplit: false,
            // 離線版只有一份程式，三個 html（開始、玩 Demo、空白範本）由 offlinePlugin 產生
            rollupOptions: {
              input: resolve(import.meta.dirname, 'play.html'),
              output: { format: 'iife' as const },
            },
          }
        : {
            // 網站：index.html＝引導網站（首頁），play.html＝遊戲，tools.html＝製作者工具（引導網站的 #/tools）
            rollupOptions: {
              input: {
                index: resolve(import.meta.dirname, 'index.html'),
                play: resolve(import.meta.dirname, 'play.html'),
                tools: resolve(import.meta.dirname, 'tools.html'),
              },
            },
          }),
    },
  };
});
