import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../bench/plans/net15/plan.jpg');
async function clickImage(page: Page, x: number, y: number) {
  const b = (await page.locator('.qf-canvas svg image').boundingBox())!;
  await page.mouse.click(b.x + b.width * x, b.y + b.height * y);
}
test('manual bathroom partition stays visible with furniture and is remembered on the same file', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const create = async (alias: string) => {
    await page.getByPlaceholder(/Например/).fill(alias);
    await page.getByRole('button', { name: 'Создать проект' }).click();
    await page.getByRole('button', { name: /Загрузка/ }).click();
    await page.locator('input[type=file]').first().setInputFiles(fixture);
    await page.getByPlaceholder('например, 52,4').fill('48,4');
    await page.getByRole('button', { name: 'Построить варианты', exact: true }).click();
    await expect(page.locator('.vcard').first()).toBeVisible({ timeout: 150_000 });
  };
  await page.goto('./'); await create('Ручные стены');
  // Correct the existing heuristic labels manually for this demonstration.
  const roomPanel = page.locator('details').filter({ has: page.locator('summary', { hasText: /^Комнаты/ }) });
  await roomPanel.locator('summary').click();
  await roomPanel.locator('select').nth(0).selectOption('corridor');
  await roomPanel.locator('select').nth(2).selectOption('bath');
  await roomPanel.locator('select').nth(5).selectOption('balcony');
  const toolbar = page.getByRole('toolbar', { name: 'Быстрая правка' });
  await toolbar.getByRole('button', { name: 'Стена', exact: true }).click();
  await page.getByLabel('Тип новой стены').selectOption('partition');
  await page.getByLabel('Толщина новой стены, мм').fill('150');
  // Existing divider between the two sanitary rooms, drawn from the public source image.
  await clickImage(page, 0.78, 0.225); await clickImage(page, 0.93, 0.225); await page.keyboard.press('Enter');
  await expect(page.locator('.canvas-hint')).toContainText('Стены добавлены');
  const drawn = page.locator('.qf-canvas [data-wall-id]').first();
  await expect(drawn).toBeVisible();
  const id = await drawn.getAttribute('data-wall-id');
  const box = (await drawn.boundingBox())!;
  // Pick the free end: the current automatic recognizer has a false door in the middle.
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.5);
  await expect(page.getByLabel('Тип выбранной стены')).toHaveValue('partition');
  await page.getByLabel('Тип выбранной стены').selectOption('bearing');
  await expect(drawn).toHaveAttribute('data-wall-kind', 'bearing');
  await page.getByLabel('Тип выбранной стены').selectOption('unknown');
  await expect(drawn).toHaveAttribute('fill', /^url\(#wallUnknown/);
  await page.getByLabel('Тип выбранной стены').selectOption('partition');
  // The source has a solid divider here. Remove the erroneous automatic opening explicitly.
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.35);
  await page.locator('.qf-actions').getByRole('button', { name: 'Удалить', exact: true }).click();
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height * 0.5);
  await expect(page.getByLabel('Использовать границы зон как основу стен')).toBeChecked();
  await page.getByRole('button', { name: 'Пересобрать варианты по исправленному плану' }).click();
  await expect(page.getByText('Пересобираю…', { exact: true })).toHaveCount(0, { timeout: 150_000 });
  await expect(page.locator('.vcard').first()).toBeVisible();
  for (const style of ['graphite', 'warm', 'blueprint', 'original']) {
    await page.getByLabel('Стиль плана').selectOption(style);
    await expect(page.locator('.vcard').first().locator(`[data-wall-id="${id}"]`)).toBeVisible();
    if (style !== 'original') await expect(page.locator('.vcard').first().locator('[data-layer="wall-base"]')).toHaveAttribute('data-room-walls', 'true');
  }
  await page.getByLabel('Стиль плана').selectOption('graphite');
  if (process.env.WALLS_SCREENSHOT) await page.locator('details').filter({ has: page.locator('summary', { hasText: /^Быстрая правка/ }) }).screenshot({ path: process.env.WALLS_SCREENSHOT });
  await page.getByText(/Обучение на моих правках · страниц:/).click();
  await page.getByRole('button', { name: 'Сохранить проверенный план для обучения' }).click();
  await expect(page.getByRole('status')).toContainText('Проверенный план сохранён');
  await expect(page.getByText('Сохранение…', { exact: true })).toBeHidden();
  await page.reload();
  await create('Повтор стен');
  await expect(page.getByText(/Использован проверенный вами план/)).toBeVisible();
  await expect(page.locator('.qf-canvas [data-wall-id]')).toHaveCount(1);
  await expect(page.locator('.qf-canvas [data-wall-id]').first()).toHaveAttribute('data-wall-kind', 'partition');
  await expect(page.locator('.vcard').first().locator('[data-layer="wall-base"]')).toHaveAttribute('data-room-walls', 'true');
});
