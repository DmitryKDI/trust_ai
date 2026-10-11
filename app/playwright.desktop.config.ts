import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'e2e', testMatch: 'desktop-app.spec.ts', timeout: 180_000, workers: 1, reporter: 'line' });
