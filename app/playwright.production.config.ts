import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'production-e2e',
  timeout: 180_000,
  use: {
    baseURL: 'http://127.0.0.1:5191/trust_ai/',
    headless: true,
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 5191 --base=/trust_ai/',
    url: 'http://127.0.0.1:5191/trust_ai/',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
  ],
});
