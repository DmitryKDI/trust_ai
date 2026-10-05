import { expect, test, type Page } from '@playwright/test';
import { twoRoom, brief } from '../tests/fixtures/synthetic';
import { newProject } from '../src/model/defaults';
import { geometryHash } from '../src/geometry/plan';

async function saved(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const q = indexedDB.open('trust-planner'); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
    const projects = await new Promise<any[]>((resolve, reject) => { const q = db.transaction('projects').objectStore('projects').getAll(); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
    db.close(); return projects.find(p => p.alias === 'Ручные размеры');
  });
}

test('Shift, ширина двери, две створки и размеры ванны сохраняются', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const project = newProject({ alias: 'Ручные размеры', city: 'Москва', manager: 'Тест', date: '2026-10-05' }); project.brief = brief;
  project.geometry = twoRoom(); project.geometry.approvedHash = geometryHash(project.geometry);
  project.variants = [{ id: 'manual-size-variant', scenario: 'space', title: 'Ручной пример', idea: 'Проверка размеров', geometryHash: geometryHash(project.geometry),
    items: [{ id: 'manual-tub', type: 'bathtub', x: 2500, y: 2000, rot: 0, w: 1700, d: 700, roomId: project.geometry.rooms[0].id, ruleId: null, movedByManager: false }],
    benefits: [], compromises: [], assumptions: [], changes: [], issues: [], metrics: {}, approved: false, editedByManager: false }];
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'manual.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'trust-planner-project', version: 1, project, files: {} })) });
  await page.getByRole('button', { name: /Варианты/ }).first().click();
  const canvas = page.locator('.qf-canvas svg');
  const world = async (x: number, y: number) => canvas.evaluate((svg, p) => { const point = (svg as SVGSVGElement).createSVGPoint(); point.x = p.x; point.y = p.y; const v = point.matrixTransform((svg as SVGSVGElement).getScreenCTM()!); return { x: v.x, y: v.y }; }, { x, y });
  await page.getByRole('button', { name: 'Стена', exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  const a = await world(7000, 4500), b = await world(8500, 4650);
  await page.mouse.click(a.x, a.y);
  await page.keyboard.down('Shift'); await page.mouse.move(b.x, b.y);
  await expect(canvas.locator('[data-wall-preview]')).toBeAttached();
  await expect(canvas.locator('[data-wall-preview]')).toHaveAttribute('d', /M7000 4500L[\d.]+ 4500/);
  await page.mouse.click(b.x, b.y); await page.keyboard.up('Shift');
  await expect.poll(async () => (await saved(page)).geometry.walls.length).toBe(7);
  const w = (await saved(page)).geometry.walls[6]; expect(w.a.y).toBe(w.b.y);
  await page.getByRole('button', { name: 'Дверь', exact: true }).click();
  await page.getByLabel('Ширина новой двери, мм').fill('1200'); await page.getByLabel('Ширина новой двери, мм').press('Enter');
  await page.getByLabel('Створки новой двери').selectOption('2');
  await canvas.scrollIntoViewIfNeeded(); const mid = await world(7750, 4500); await page.mouse.click(mid.x, mid.y);
  await expect(page.getByLabel('Ширина выбранного проёма, мм')).toHaveValue('1200');
  await page.getByLabel('Ширина выбранного проёма, мм').fill('1400'); await page.getByLabel('Ширина выбранного проёма, мм').press('Enter');
  await expect(canvas.locator('[data-door-leaves="2"] [data-door-leaf]')).toHaveCount(2);
  const tub = page.locator('.detail [data-item-id="manual-tub"]'); await tub.scrollIntoViewIfNeeded(); await tub.click();
  await page.getByLabel('Ширина предмета, мм').fill('1400'); await page.getByLabel('Ширина предмета, мм').press('Enter');
  await page.getByLabel('Глубина предмета, мм').fill('550'); await page.getByLabel('Глубина предмета, мм').press('Enter');
  await expect.poll(async () => (await saved(page)).variants[0].items[0].d).toBe(550);
  expect((await saved(page)).variants[0].items[0].w).toBe(1400);
  await page.reload(); await page.getByRole('button', { name: /Варианты/ }).first().click();
  const restored = await saved(page);
  expect(restored.variants[0].items[0]).toMatchObject({ w: 1400, d: 550, x: 2500, y: 2000 });
  const d = restored.geometry.openings.at(-1); expect(d.leaves).toBe(2); expect(Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y)).toBeCloseTo(1400);
});
