import { defineConfig } from '@playwright/test';

// Локально — установленный в системе Edge, без загрузки браузеров Playwright.
// В облаке (PW_CHROMIUM=/путь/к/chromium) — готовый Chromium.
const chromium = process.env.PW_CHROMIUM;
const browser = chromium ? { launchOptions: { executablePath: chromium } } : { channel: 'msedge' };

export default defineConfig({
  testDir: 'e2e',
  testIgnore: 'desktop-app.spec.ts',
  timeout: 120_000,
  use: { ...browser, baseURL: 'http://127.0.0.1:5190', headless: true },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:5190', reuseExistingServer: true, timeout: 60_000 },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
  ],
});
