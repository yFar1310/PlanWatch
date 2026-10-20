import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [tailwindcss(), vue(), cloudflare({ viteEnvironment: { name: 'worker' } })],
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
});
