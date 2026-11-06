import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // make web-dev points this at the deployed API.
    proxy: process.env.API_URL
      ? { '/api': { target: process.env.API_URL, changeOrigin: true } }
      : undefined,
  },
  build: { target: 'es2022' },
});
