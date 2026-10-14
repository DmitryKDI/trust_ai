import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bench/plans/net15/plan.jpg');

test('Pages build: raster recognition and layout workers are compiled and run', async ({ page }) => {
  const workers: string[] = [];
  const errors: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await page.getByPlaceholder(/Например/).fill('Проверка опубликованной сборки');
  await page.getByRole('button', { name: 'Создать проект' }).click();
  await page.getByRole('button', { name: /Загрузка/ }).click();
  await page.locator('input[type=file]').first().setInputFiles(fixture);
  await page.getByPlaceholder('например, 52,4').fill('48,4');
  await page.getByRole('button', { name: 'Построить варианты', exact: true }).click();
  await expect(page.locator('.vcard')).toHaveCount(3, { timeout: 150_000 });
  await expect(page.getByText(/План прочитан автоматически: 7 помещ/)).toBeVisible();
  expect(errors).toEqual([]);
  expect(workers.length).toBeGreaterThanOrEqual(2);
  for (const url of workers) expect(new URL(url).pathname).toMatch(/^\/trust_ai\/assets\/worker-.*\.js$/);
});
