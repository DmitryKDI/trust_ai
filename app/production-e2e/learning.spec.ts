import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bench/plans/net15/plan.jpg');
const readProject = (page: import('@playwright/test').Page, alias: string) => page.evaluate(async name => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const q = indexedDB.open('trust-planner'); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
  try { return await new Promise<any>((resolve, reject) => { const q = db.transaction('projects').objectStore('projects').getAll(); q.onsuccess = () => resolve(q.result.find(p => p.alias === name)); q.onerror = () => reject(q.error); }); } finally { db.close(); }
}, alias);

test('manual type -> confirmed example -> same uploaded plan remembers corrections; learning can be bypassed', async ({ page }) => {
  const create = async (alias: string, area = false) => {
    await page.getByPlaceholder(/Например/).fill(alias);
    await page.getByRole('button', { name: 'Создать проект' }).click();
    await page.getByRole('button', { name: /Загрузка/ }).click();
    await page.locator('input[type=file]').first().setInputFiles(fixture);
    if (area) await page.getByPlaceholder('например, 52,4').fill('48,4');
    await page.getByRole('button', { name: 'Построить варианты', exact: true }).click();
    await expect(page.locator('.vcard').first()).toBeVisible({ timeout: 150_000 });
    await expect(page.getByText('Сохранение…', { exact: true })).toBeHidden();
  };
  await page.goto('./');
  await create('Проверенный пример', true);
  const before = await readProject(page, 'Проверенный пример');
  const rooms = page.locator('details').filter({ has: page.locator('summary', { hasText: /^Комнаты/ }) });
  await rooms.locator('summary').click();
  await rooms.locator('select').first().selectOption('corridor');
  await page.getByText(/Обучение на моих правках · страниц:/).click();
  await page.getByRole('button', { name: 'Сохранить проверенный план для обучения' }).click();
  await expect(page.getByRole('status')).toContainText('Проверенный план сохранён');
  await expect(page.getByText(/Сохранено страниц: 1 · назначений: 1/)).toBeVisible();
  await expect(page.getByText('Сохранение…', { exact: true })).toBeHidden();
  const taught = await readProject(page, 'Проверенный пример');
  expect(taught.geometry.rooms[0].type).toBe('corridor');
  expect(taught.geometry.rooms[0].polygon).toEqual(before.geometry.rooms[0].polygon);
  if (process.env.LEARNING_SCREENSHOT && test.info().project.name === 'desktop') {
    await rooms.locator('summary').click();
    await page.locator('main').screenshot({ path: process.env.LEARNING_SCREENSHOT });
  }
  await page.reload();
  await page.getByRole('button', { name: 'Все проекты', exact: true }).click();
  await create('Повторная загрузка');
  await expect(page.getByText(/Использован проверенный вами план/)).toBeVisible();
  const recalled = await readProject(page, 'Повторная загрузка');
  expect(recalled.geometry.rooms).toEqual(taught.geometry.rooms);
  expect(recalled.geometry.calibration).toEqual(taught.geometry.calibration);
  expect(recalled.geometry.sourceDocumentId).not.toBe(taught.geometry.sourceDocumentId);
  await page.getByRole('button', { name: /Загрузка/ }).click();
  await page.getByLabel('Использовать мои проверенные планы и примеры назначений').uncheck();
  await page.getByPlaceholder('например, 52,4').fill('48,4');
  await page.getByRole('button', { name: 'Построить варианты', exact: true }).click();
  await expect(page.locator('.vcard').first()).toBeVisible({ timeout: 150_000 });
  await expect(page.getByText(/Использован проверенный вами план/)).toHaveCount(0);
  await expect(page.getByText('Сохранение…', { exact: true })).toBeHidden();
  const fresh = await readProject(page, 'Повторная загрузка');
  expect(fresh.geometry.rooms[0].type).toBe(before.geometry.rooms[0].type);
  // Manual drawing exposes type selection on touch devices without hovering.
  await page.getByRole('button', { name: /Разметка/ }).first().click();
  await page.getByRole('button', { name: 'Помещение по точкам', exact: false }).click();
  await page.getByLabel('Назначение новой зоны').selectOption('bath');
  await expect(page.getByLabel('Назначение новой зоны')).toHaveValue('bath');
});
