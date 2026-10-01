import { defineConfig } from 'vite';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);

export default defineConfig({
  root: here,
  publicDir: path.join(here, 'public'),
  resolve: { alias: { '@shared': path.resolve(here, '../shared') } },
  server: {
    port: 5173,
    host: true,
    fs: { allow: [path.resolve(here, '..')] },
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
      '/api': { target: 'http://localhost:3000' },
    },
  },
  build: {
    outDir: path.resolve(here, '../dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: path.join(here, 'index.html') },
  },
});
