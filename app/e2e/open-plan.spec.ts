// Public fixture: browser worker path and persistence, on desktop and touch/mobile.
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bench/plans/net15/plan.jpg');
test('открытый net15: загрузка, worker, семь зон и сохранённый источник', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await page.getByPlaceholder(/Например/).fill('Контроль net15');
  await page.getByRole('button', { name: 'Создать проект' }).click();
  await page.getByRole('button', { name: /Загрузка/ }).click();
  await page.locator('input[type=file]').first().setInputFiles(fixture);
  await page.getByPlaceholder('например, 52,4').fill('48,4');
  await page.getByRole('button', { name: 'Построить варианты', exact: true }).click();
  await expect(page.locator('.vcard').first()).toBeVisible({ timeout: 150_000 });
  await expect(page.getByText(/План прочитан автоматически: 7 помещ/)).toBeVisible();
  await expect(page.getByText('Сохранение…', { exact: true })).toBeHidden();
  await page.reload();
  const stored = await page.evaluate(async () => {
    const req = indexedDB.open('trust-planner');
    const db = await new Promise<IDBDatabase>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    try {
      const rows = await new Promise<any[]>((resolve, reject) => {
        const q = db.transaction('projects').objectStore('projects').getAll();
        q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error);
      });
      const p = rows.find(row => row.alias === 'Контроль net15');
      return { zones: p.geometry.rooms.length, documentId: p.geometry.sourceDocumentId, sourceId: p.documents[0].id, page: p.geometry.sourcePage, method: p.geometry.calibration.method, hasSourceImage: !!p.planImage?.url };
    } finally { db.close(); }
  });
  expect(stored.zones).toBe(7);
  expect(stored.documentId).toBe(stored.sourceId);
  expect(stored.page).toBe(1);
  expect(stored.method).toBe('area');
  expect(stored.hasSourceImage).toBe(true);
});
