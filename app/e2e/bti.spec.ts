// Реальный скан БТИ (локальные данные клиента, не коммитятся): картинка → варианты → страница клиента.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const img = path.resolve(__dirname, '../../data/cases/user-bti/pages/bti.jpg');
const out = path.resolve(__dirname, '../../data/reports');

test.skip(!fs.existsSync(img), 'нет локального скана');

test('скан БТИ: построить варианты одной кнопкой', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  page.on('dialog', (d) => d.accept());
  await page.goto('/');
  await page.getByPlaceholder(/Например/).fill('Скан БТИ');
  await page.getByRole('button', { name: 'Создать проект' }).click();
  await page.getByRole('button', { name: /Загрузка/ }).click();
  await page.locator('input[type=file]').first().setInputFiles(img);
  await page.getByPlaceholder('например, 52,4').fill('82');
  await page.getByRole('button', { name: 'Построить варианты' }).click();
  await expect(page.locator('.vcard').first()).toBeVisible({ timeout: 120_000 });
  fs.mkdirSync(out, { recursive: true });
  await page.waitForTimeout(1500);
  const rec = await page.evaluate(async () => {
    const req = indexedDB.open('trust-planner');
    const db: IDBDatabase = await new Promise((r) => { req.onsuccess = () => r(req.result); });
    const all: { alias: string; recognition?: unknown; variants: { title: string; items: unknown[]; issues: { severity: string; message: string }[] }[] }[] = await new Promise((r) => { const q = db.transaction('projects').objectStore('projects').getAll(); q.onsuccess = () => r(q.result); });
    const p = all.find((x) => x.alias === 'Скан БТИ')!;
    return { recognition: p.recognition, variants: p.variants.map((v) => ({ t: v.title, n: v.items.length, e: v.issues.filter((i) => i.severity === 'error').map((i) => i.message) })) };
  });
  fs.writeFileSync(path.join(out, 'bti-browser.json'), JSON.stringify(rec, null, 1));
  await page.screenshot({ path: path.join(out, 'bti-variants.png'), fullPage: true });
  for (const style of ['warm', 'blueprint']) {
    await page.locator('select').filter({ has: page.locator('option[value="warm"]') }).selectOption(style);
    await page.locator('.detail').screenshot({ path: path.join(out, `bti-detail-${style}.png`) });
  }
  await page.locator('select').filter({ has: page.locator('option[value="warm"]') }).selectOption('graphite');
  await page.locator('.detail').screenshot({ path: path.join(out, 'bti-detail-graphite.png') });
});
