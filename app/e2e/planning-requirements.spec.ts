import { expect, test, type Page } from '@playwright/test';
import { twoRoom } from '../tests/fixtures/synthetic';
import { newProject } from '../src/model/defaults';
import { geometryHash } from '../src/geometry/plan';
async function example(page: Page) {
  const p = newProject({ alias: 'Требования и фиксация', city: '', manager: '', date: '' }); p.geometry = twoRoom(); p.geometry.approvedHash = geometryHash(p.geometry);
  p.variants = [{ id: 'fixture-v', scenario: 'space', title: 'Пример', idea: 'Проверка', geometryHash: geometryHash(p.geometry), items: [
    { id: 'one', type: 'sofa', x: 2000, y: 2000, w: 1000, d: 600, rot: 0, roomId: p.geometry.rooms[0].id, ruleId: null, movedByManager: false },
    { id: 'two', type: 'sofa', x: 4000, y: 2000, w: 1000, d: 600, rot: 0, roomId: p.geometry.rooms[0].id, ruleId: null, movedByManager: false }], benefits: [], compromises: [], assumptions: [], changes: [], issues: [], metrics: {}, approved: false, editedByManager: false }];
  await page.goto('/'); await page.locator('input[type=file]').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'trust-planner-project', version: 1, project: p, files: {} })) }); return p;
}
async function saved(page: Page) { return page.evaluate(async () => { const db = await new Promise<IDBDatabase>(resolve => { const q = indexedDB.open('trust-planner'); q.onsuccess = () => resolve(q.result); }); const all = await new Promise<any[]>(resolve => { const q = db.transaction('projects').objectStore('projects').getAll(); q.onsuccess = () => resolve(q.result); }); db.close(); return all.find(p => p.alias === 'Требования и фиксация'); }); }

test('фиксация, расстояния и пересборка комнаты сохраняются после перезагрузки', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); const p = await example(page);
  const detail = page.locator('.detail'), item = detail.locator('[data-item-id="one"]'); await item.click();
  await expect(detail.locator('[data-measurement="wall-left"]')).toHaveAttribute('data-mm', '1350');
  await expect(detail.locator('[data-measurement="nearest-item"]')).toHaveAttribute('data-mm', '1000');
  await detail.getByRole('button', { name: 'Закрепить выбранную мебель', exact: true }).click();
  await expect(detail.locator('[data-resize-handle]')).toHaveCount(0);
  await expect.poll(async () => (await saved(page))?.variants[0].items[0].locked).toBe(true);
  await item.scrollIntoViewIfNeeded();
  const box = await item.boundingBox(); await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.down(); await page.mouse.move(box!.x + box!.width / 2 + 70, box!.y + box!.height / 2 + 70); await page.mouse.up();
  await expect.poll(async () => (await saved(page))?.variants[0].items[0].x).toBe(2000);
  await detail.getByLabel('Комната для пересборки', { exact: true }).selectOption(p.geometry.rooms[1].id);
  await detail.getByRole('button', { name: 'Пересобрать только эту комнату', exact: true }).click();
  await expect.poll(async () => (await saved(page))?.variants[0].id, { timeout: 90000 }).not.toBe('fixture-v');
  const current = (await saved(page)).variants[0]; expect(current.items.filter((i: any) => i.roomId !== p.geometry.rooms[1].id)).toEqual([{ ...p.variants[0].items[0], locked: true }, p.variants[0].items[1]]);
  expect(current.items.some((i: any) => i.type === 'bed-double')).toBe(true);
  await page.reload(); await page.locator('.prow').filter({ hasText: p.alias }).getByRole('button', { name: 'Открыть', exact: true }).click();
  await page.locator('.detail [data-item-id="one"]').click(); await expect(page.getByRole('button', { name: 'Снять закрепление', exact: true })).toBeVisible(); expect(errors).toEqual([]);
});

test('смена брифа снимает утверждение и требует явной проверки', async ({ page }) => {
  await example(page); await page.getByRole('button', { name: 'Утвердить для клиента', exact: true }).click();
  await expect.poll(async () => (await saved(page))?.variants[0].approved).toBe(true);
  await page.locator('.nav button').filter({ hasText: 'Бриф' }).click();
  await page.getByLabel('Рабочих мест для взрослых', { exact: true }).fill('2');
  await expect.poll(async () => (await saved(page))?.selectedVariantId).toBeNull();
  await page.locator('.nav button').filter({ hasText: 'Варианты' }).click();
  await expect(page.getByRole('button', { name: 'Утвердить для клиента', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Проверить по текущему брифу', exact: true }).click();
  await expect(page.getByLabel('Выполнение требований')).toContainText('Рабочие места взрослых: 0 из 2');
  await expect(page.getByRole('button', { name: 'Утвердить для клиента', exact: true })).toBeDisabled();
  await page.locator('.nav button').filter({ hasText: 'Бриф' }).click(); await page.getByLabel('Рабочих мест для взрослых', { exact: true }).fill('0');
  await page.locator('.nav button').filter({ hasText: 'Варианты' }).click(); await page.getByRole('button', { name: 'Проверить по текущему брифу', exact: true }).click();
  await page.getByRole('button', { name: 'Утвердить для клиента', exact: true }).click();
  await expect.poll(async () => (await saved(page))?.variants[0].approved).toBe(true);
});
