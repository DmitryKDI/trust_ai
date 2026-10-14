// Быстрая правка распознанного плана (план из открытых источников, bench/plans/net20).
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const img = path.resolve(__dirname, '../../bench/plans/net20/plan.jpg');
const shots = path.resolve(__dirname, '../../docs/screenshots');

/** Щелчок по точке картинки плана (доли ширины и высоты исходной картинки). */
async function clickImage(page: Page, fx: number, fy: number) {
  const box = (await page.locator('.qf-canvas svg image').boundingBox())!;
  await page.mouse.click(box.x + fx * box.width, box.y + fy * box.height);
}

async function geometry(page: Page) {
  return page.evaluate(async () => {
    const req = indexedDB.open('trust-planner');
    const db: IDBDatabase = await new Promise((r) => { req.onsuccess = () => r(req.result); });
    const all: { alias: string; geometry: { rooms: { name: string; type: string; typeSource?: string }[]; openings: { type: string; isEntrance: boolean }[]; approved: boolean } }[] =
      await new Promise((r) => { const q = db.transaction('projects').objectStore('projects').getAll(); q.onsuccess = () => r(q.result); });
    return all.find((x) => x.alias === 'Быстрая правка')!.geometry;
  });
}

test('быстрая правка: добавить пропущенную комнату, назначить тип, поставить дверь', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop' || !fs.existsSync(img));
  page.on('dialog', (d) => d.accept());
  await page.goto('/');
  await page.getByPlaceholder(/Например/).fill('Быстрая правка');
  await page.getByRole('button', { name: 'Создать проект' }).click();
  await page.getByRole('button', { name: /Загрузка/ }).click();
  await page.locator('input[type=file]').first().setInputFiles(img);
  await page.getByRole('button', { name: 'Построить варианты' }).click();
  await expect(page.locator('.vcard').first()).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.qf-canvas svg image')).toBeVisible();
  await page.waitForTimeout(800); // пиксели картинки для «волшебной палочки»
  const before = await geometry(page);

  // Туалет №7 справа от коридора на net20 не распознан — добавляем щелчком внутри.
  await page.getByRole('button', { name: 'Добавить комнату' }).click();
  await page.getByLabel('Назначение новой зоны').selectOption('bath');
  await clickImage(page, 0.70, 0.37);
  await expect(page.locator('.canvas-hint')).toContainText('Помещение добавлено');
  await page.locator('.qf-chips').getByRole('button', { name: 'Туалет', exact: true }).click();
  await page.waitForTimeout(600);
  const after = await geometry(page);
  expect(after.rooms.length).toBe(before.rooms.length + 1);
  expect(after.rooms.some((r) => r.type === 'wc' && r.name === 'Туалет' && r.typeSource === 'manual')).toBe(true);
  expect(after.approved).toBe(true);

  // Дверь из коридора в добавленный санузел: щелчок по стене между ними.
  await page.getByRole('button', { name: 'Дверь', exact: true }).click();
  await clickImage(page, 0.612, 0.39);
  await expect(page.locator('.canvas-hint')).toContainText('добавлена');
  await page.waitForTimeout(600);
  const doors = (await geometry(page)).openings.filter((o) => o.type === 'door').length;
  expect(doors).toBe(after.openings.filter((o) => o.type === 'door').length + 1);

  await page.locator('details.card').filter({ hasText: 'Быстрая правка плана' }).screenshot({ path: path.join(shots, 'app-desktop-quickfix.png') });
  await page.getByRole('button', { name: 'Пересобрать варианты по исправленному плану' }).click();
  await expect(page.locator('.vcard').first()).toBeVisible({ timeout: 120_000 });
});
