import { defineConfig, devices } from '@playwright/test';

const API_PORT = 3101;
const APP_PORT = 5273;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    launchOptions: {
      // Fake microphone (a beep) so the real getUserMedia + MediaRecorder path runs in CI.
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
    permissions: ['microphone'],
  },
  projects: [{ name: 'mobile-390', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } }],
  webServer: [
    {
      command: `node scripts/e2e-api.mjs`,
      port: API_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_PORT: String(API_PORT), MINI_APP_URL: `http://localhost:${APP_PORT}`, DATA_DIR: '.data/e2e', NODE_ENV: 'development', API_RATE_LIMIT_PER_MINUTE: '5000', RECOGNITION_PER_MINUTE: '50', LOG_LEVEL: 'warn', MUSIC_PROVIDERS: 'mock', RECOGNITION_PROVIDERS: 'mock', BOT_TOKEN: '', DATABASE_URL: '' },
    },
    {
      command: `pnpm --filter @auris/mini-app exec vite --port ${APP_PORT} --strictPort`,
      port: APP_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_API_PROXY: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
