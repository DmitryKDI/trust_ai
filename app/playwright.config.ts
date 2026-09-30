import { defineConfig } from '@playwright/test';

// Используем установленный в системе Edge — без загрузки браузеров Playwright.
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: { baseURL: 'http://127.0.0.1:5190', channel: 'msedge', headless: true },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5190', reuseExistingServer: true, timeout: 60_000 },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
  ],
});
