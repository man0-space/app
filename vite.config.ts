import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  if (!env.VITE_API_URL) throw new Error('VITE_API_URL is required.');
  const target = env.VITE_API_URL.replace(/^https:\/\/api\.man0\.space/, 'http://api.man0.space');
  return {
    plugins: [react(), tailwindcss()],
    define: { global: 'globalThis' },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        buffer: 'buffer/',
      },
    },
    server: {
      host: true,
      port: 4001,
      strictPort: false,
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          secure: false,
          timeout: 120000,
          proxyTimeout: 120000,
        },
      },
    },
    preview: {
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          secure: false,
          timeout: 120000,
          proxyTimeout: 120000,
        },
      },
    },
    build: { target: 'es2022' },
  };
});
