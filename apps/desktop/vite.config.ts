import { defineConfig } from 'vite';
export default defineConfig({
  root: 'src/renderer', base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: '../../dist/renderer', emptyOutDir: true, sourcemap: false }
});
