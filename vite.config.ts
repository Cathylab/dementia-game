import { defineConfig } from 'vite';
import { scriptSavePlugin } from './vite-plugin-script-save.ts';

// base: './' 讓建置結果可以放在任何子路徑下（例如 GitHub Pages 的 /<repo>/）。
export default defineConfig({
  base: './',
  plugins: [scriptSavePlugin()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1000,
  },
});
