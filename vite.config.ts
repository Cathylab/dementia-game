import { defineConfig } from 'vite';
import { contentPlugin } from './vite-plugin-content.ts';
import { scriptSavePlugin } from './vite-plugin-script-save.ts';

// base: './' 讓建置結果可以放在任何子路徑下（例如 GitHub Pages 的 /<repo>/）。
// 遊戲內容不在 public/，而在 examples/、templates/、packs/，由 contentPlugin 提供與複製。
export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [scriptSavePlugin(), contentPlugin()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1000,
  },
});
