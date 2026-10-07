import { expect, test, type Locator, type Page } from '@playwright/test';
import { twoRoom, rect } from '../tests/fixtures/synthetic';
import { newProject } from '../src/model/defaults';
import { geometryHash } from '../src/geometry/plan';

async function example(page: Page, three = false) {
  const p = newProject({ alias: 'Редактор группы', city: '', manager: '', date: '' });
  p.geometry = twoRoom(); p.geometry.wetZones = [{ id: 'wet-edit', polygon: rect(1000, 4000, 2500, 5500), source: 'manual', sourcePage: 1, verifiedByManager: true }]; p.geometry.approvedHash = geometryHash(p.geometry);
  p.variants = [{ id: 'edit-v', scenario: 'space', title: 'Пример', idea: 'Редактор', geometryHash: geometryHash(p.geometry), items: [
    { id: 'sofa-one', type: 'sofa', x: 2000, y: 2000, w: 1000, d: 600, rot: 0, roomId: p.geometry.rooms[0].id, ruleId: null, movedByManager: false },
    { id: 'sofa-two', type: 'sofa', x: 4000, y: 2000, w: 1000, d: 600, rot: 0, roomId: p.geometry.rooms[0].id, ruleId: null, movedByManager: false }], benefits: [], compromises: [], assumptions: [], changes: [], issues: [], metrics: {}, approved: false, editedByManager: false }];
  if (three) { p.variants = [p.variants[0], ...(['storage', 'family'] as const).map((scenario, n) => ({ ...p.variants[0], id: `keep-${n}`, scenario, title: scenario, items: p.variants[0].items.map(i => ({ ...i, id: `${i.id}-${n}` })), approved: n === 0 }))]; p.selectedVariantId = 'keep-0'; }
  await page.goto('/'); await page.locator('input[type=file]').setInputFiles({ name: 'edit.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'trust-planner-project', version: 1, project: p, files: {} })) });
  return p;
}
async function saved(page: Page) { return page.evaluate(async () => { const db = await new Promise<IDBDatabase>(resolve => { const q = indexedDB.open('trust-planner'); q.onsuccess = () => resolve(q.result); }); const all = await new Promise<any[]>(resolve => { const q = db.transaction('projects').objectStore('projects').getAll(); q.onsuccess = () => resolve(q.result); }); db.close(); return all.find(p => p.alias === 'Редактор группы'); }); }
async function point(svg: Locator, x: number, y: number) {
  await svg.scrollIntoViewIfNeeded(); const p = await svg.evaluate((el: SVGSVGElement, value) => { const p = el.createSVGPoint(); p.x = value.x; p.y = value.y; const s = p.matrixTransform(el.getScreenCTM()!); return { x: s.x, y: s.y }; }, { x, y }); return p;
}
async function click(page: Page, svg: Locator, x: number, y: number) { const p = await point(svg, x, y); await page.mouse.click(p.x, p.y); }
async function drag(page: Page, svg: Locator, from: [number, number], to: [number, number]) { const a = await point(svg, ...from), b = await point(svg, ...to); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up(); }

test('Shift, общая смена типа, замыкание и углы зон сохраняются с отменой', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); const p = await example(page);
  const quick = page.locator('details').filter({ has: page.locator('summary', { hasText: /^Быстрая правка/ }) }), svg = quick.locator('svg');
  await click(page, svg, 500, 0); await page.keyboard.down('Shift'); await click(page, svg, 5000, 3000); await page.keyboard.up('Shift');
  await expect(quick.locator('[data-batch-selection]')).toHaveAttribute('data-batch-selection', '2');
  await quick.getByLabel('Тип выбранных элементов').selectOption('partition');
  await expect(svg.locator(`[data-wall-id="${p.geometry.walls[0].id}"]`)).toHaveAttribute('data-wall-kind', 'partition');
  await quick.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect(svg.locator(`[data-wall-id="${p.geometry.walls[0].id}"]`)).toHaveAttribute('data-wall-kind', 'bearing');
  await quick.getByRole('button', { name: 'Стена', exact: true }).click();
  await click(page, svg, 7000, 4300); await click(page, svg, 8700, 4300); await click(page, svg, 8700, 5900); await click(page, svg, 7020, 4310);
  await expect(svg.locator('[data-wall-id]')).toHaveCount(9); await expect(svg.locator('[data-wall-draft]')).toHaveCount(0);
  await expect.poll(async () => (await saved(page))?.geometry.walls.at(-1)?.b).toEqual({ x: 7000, y: 4300 });
  await quick.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect(svg.locator('[data-wall-id]')).toHaveCount(6);
  await click(page, svg, 1700, 4700); await expect(svg.locator('[data-vertex-handle]')).toHaveCount(4);
  await drag(page, svg, [1000, 4000], [800, 3800]); await expect.poll(async () => (await saved(page))?.geometry.wetZones[0].polygon[0]).toEqual({ x: 800, y: 3800 });
  await quick.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect(svg.locator('[data-vertex-handle="0"]')).toHaveAttribute('cx', '1000');
  await click(page, svg, 3000, 1000); await drag(page, svg, [150, 150], [400, 400]);
  await expect.poll(async () => (await saved(page))?.geometry.rooms[0].polygon[0]).toEqual({ x: 400, y: 400 });
  await page.reload(); await page.locator('.prow').filter({ hasText: p.alias }).getByRole('button', { name: 'Открыть', exact: true }).click();
  await expect(page.locator('.qf-canvas [data-room-id]').first()).toHaveAttribute('d', /^M400\.0 400\.0/); expect(errors).toEqual([]);
});

test('мебель: Shift, тип группы, растягивание, числа, прилипание и история', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await example(page);
  const detail = page.locator('.detail'), svg = detail.locator('svg').first();
  await click(page, svg, 2000, 2000); await page.keyboard.down('Shift'); await click(page, svg, 4000, 2000); await page.keyboard.up('Shift');
  await detail.getByLabel('Тип выбранной мебели').selectOption('armchair');
  await expect(svg.locator('[data-item-id="sofa-one"]')).toHaveAttribute('data-item-type', 'armchair'); await expect(svg.locator('[data-item-id="sofa-two"]')).toHaveAttribute('data-item-type', 'armchair');
  await detail.getByRole('button', { name: 'Отменить мебель', exact: true }).click(); await expect(svg.locator('[data-item-id="sofa-one"]')).toHaveAttribute('data-item-type', 'sofa');
  await detail.getByRole('button', { name: 'Повторить мебель', exact: true }).click(); await expect(svg.locator('[data-item-id="sofa-one"]')).toHaveAttribute('data-item-type', 'armchair');
  await click(page, svg, 2500, 4000); await click(page, svg, 2000, 2000); await expect(svg.locator('[data-resize-handle]')).toHaveCount(8);
  await drag(page, svg, [2500, 2300], [2900, 2500]); await expect(detail.getByLabel('Ширина предмета, мм', { exact: true })).toHaveValue('1400'); await expect(detail.getByLabel('Глубина предмета, мм', { exact: true })).toHaveValue('800');
  await detail.getByRole('button', { name: 'Отменить мебель', exact: true }).click(); await expect(detail.getByLabel('Ширина предмета, мм', { exact: true })).toHaveValue('1000');
  await detail.getByLabel('Ширина предмета, мм', { exact: true }).fill('1600'); await detail.getByLabel('Ширина предмета, мм', { exact: true }).press('Enter');
  await expect.poll(async () => (await saved(page))?.variants[0].items[0].w).toBe(1600);
  await drag(page, svg, [2000, 2000], [2000, 470]); await expect(detail.getByLabel('Глубина предмета, мм', { exact: true })).toHaveValue('600');
  await expect.poll(async () => (await saved(page))?.variants[0].items[0].y).toBe(450);
  await page.reload(); await page.locator('.prow').filter({ hasText: 'Редактор группы' }).getByRole('button', { name: 'Открыть', exact: true }).click(); await page.locator('.detail [data-item-id="sofa-one"]').click();
  await expect(page.getByLabel('Ширина предмета, мм', { exact: true })).toHaveValue('1600'); expect(errors).toEqual([]);
});


test('пересборка одного сохраняет остальные; общая заменяет всю тройку', async ({ page }) => {
  test.setTimeout(240_000);
  const p = await example(page, true);
  await page.getByRole('button', { name: 'Пересобрать вариант 1', exact: true }).click();
  await expect.poll(async () => (await saved(page))?.variants[0].id, { timeout: 90_000 }).not.toBe('edit-v');
  const afterOne = await saved(page);
  expect(afterOne.variants[1]).toEqual(p.variants[1]); expect(afterOne.variants[2]).toEqual(p.variants[2]); expect(afterOne.selectedVariantId).toBe('keep-0');
  await page.getByRole('button', { name: 'Пересобрать все варианты', exact: true }).click();
  await expect.poll(async () => (await saved(page))?.variants.some((v: any) => v.id === 'keep-0'), { timeout: 90_000 }).toBe(false);
  expect((await saved(page)).selectedVariantId).toBeNull();
});
