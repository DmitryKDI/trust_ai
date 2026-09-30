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
  await page.locator('.detail').screenshot({ path: path.join(out, 'bti-detail.png') });
  // Площадь гостиной с плана БТИ (23,1) → весь план растягивается по ней.
  await page.locator('details.card summary').click();
  const living = page.locator('details.card label.field').filter({ has: page.locator('span', { hasText: /^Гостиная/ }) }).locator('input');
  await living.fill('23,1');
  await page.getByRole('button', { name: 'Растянуть план по площади и пересобрать' }).click();
  await expect(page.locator('details.card label.field').filter({ has: page.locator('span', { hasText: /^Гостиная/ }) })).toContainText('23,1 м²', { timeout: 60_000 });
  await expect(page.locator('.vcard').first()).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(1500);
  await page.locator('.detail').screenshot({ path: path.join(out, 'bti-detail-scaled.png') });

});

const page2 = path.resolve(__dirname, '../../data/cases/bti-page/pages/page.png');
test('страница БТИ с рамкой: план находится внутри листа', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop' || !fs.existsSync(page2));
  await page.goto('/');
  await page.getByPlaceholder(/Например/).fill('Страница БТИ');
  await page.getByRole('button', { name: 'Создать проект' }).click();
  await page.getByRole('button', { name: /Загрузка/ }).click();
  await page.locator('input[type=file]').first().setInputFiles(page2);
  await page.getByRole('button', { name: 'Построить варианты' }).click();
  await expect(page.locator('.vcard').first()).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(1000);
  await page.locator('.detail').screenshot({ path: path.join(out, 'bti-page-detail.png') });
});
