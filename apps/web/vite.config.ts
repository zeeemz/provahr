import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy: the API is same-origin `/api` in dev (apps/api runs on :4000).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
