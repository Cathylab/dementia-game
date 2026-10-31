import { defineConfig } from 'vite';

// base: './' 讓建置結果可以放在任何子路徑下（例如 GitHub Pages 的 /<repo>/）。
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1000,
  },
});
