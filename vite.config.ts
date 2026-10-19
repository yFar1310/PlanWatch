import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [vue(), cloudflare({ viteEnvironment: { name: 'worker' } })],
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
});
