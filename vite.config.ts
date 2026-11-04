import { defineConfig } from 'vite';
import { contentPlugin } from './vite-plugin-content.ts';
import { offlinePlugin } from './vite-plugin-offline.ts';
import { scriptSavePlugin } from './vite-plugin-script-save.ts';

// base: './' 讓建置結果可以放在任何子路徑下（例如 GitHub Pages 的 /<repo>/）。
// 遊戲內容不在 public/，而在 examples/、templates/、packs/，由 contentPlugin 提供與複製。
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
            rollupOptions: { output: { format: 'iife' as const, inlineDynamicImports: true } },
          }
        : {}),
    },
  };
});
