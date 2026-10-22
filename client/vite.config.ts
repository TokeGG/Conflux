import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', assetsDir: 'bundle', chunkSizeWarningLimit: 1500 },
  // local development: `npx tsx server/dev.ts` serves /api (the Pages Function's twin); without it the game runs as a guest
  server: { port: 5173, proxy: { '/api': { target: 'http://127.0.0.1:8788', changeOrigin: true } } },
});
