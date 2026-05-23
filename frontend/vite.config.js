// Vite config for the Mise mobile UI.
// Dev server proxies /api and /auth to the Node/Express backend (../src) so the
// client talks to the real, token-authenticated API in development — no CORS,
// no hardcoded host. MOCK_API=1 points the proxy at the local mock-server.js
// (same response shapes) for offline visual checks without Postgres.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiTarget = process.env.MOCK_API ? 'http://localhost:4100' : 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/auth': { target: apiTarget, changeOrigin: true },
    },
  },
});
