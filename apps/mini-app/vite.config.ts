import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { MINI_APP_HEADERS } from '../../packages/shared/src/security';

const API = process.env.VITE_API_PROXY ?? 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Tunnels (ngrok / cloudflared) send their own Host header.
    allowedHosts: true,
    proxy: { '/api': { target: API, changeOrigin: false } },
    // Dev only: Vite injects inline scripts for HMR, so the CSP is applied in preview/production.
    headers: { 'referrer-policy': MINI_APP_HEADERS['referrer-policy']! },
  },
  preview: { port: Number(process.env.PREVIEW_PORT ?? 4173), proxy: { '/api': { target: API } }, headers: MINI_APP_HEADERS },
  build: { target: 'es2022', sourcemap: true },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts?(x)'] },
});
