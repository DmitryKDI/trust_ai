import { expect, test, type Locator, type Page } from '@playwright/test';
import { twoRoom, rect } from '../tests/fixtures/synthetic';
import { newProject } from '../src/model/defaults';
import { geometryHash } from '../src/geometry/plan';

async function example(page: Page, three = false, mixed = false) {
  const p = newProject({ alias: 'Редактор группы', city: '', manager: '', date: '' });
  p.geometry = twoRoom(); p.geometry.wetZones = [{ id: 'wet-edit', polygon: rect(1000, 4000, 2500, 5500), source: 'manual', sourcePage: 1, verifiedByManager: true }]; p.geometry.approvedHash = geometryHash(p.geometry);
  p.variants = [{ id: 'edit-v', scenario: 'space', title: 'Пример', idea: 'Редактор', geometryHash: geometryHash(p.geometry), items: [
    { id: 'sofa-one', type: 'sofa', x: 2000, y: 2000, w: 1000, d: 600, rot: 0, roomId: p.geometry.rooms[0].id, ruleId: null, movedByManager: false },
    { id: 'sofa-two', type: 'sofa', x: 4000, y: 2000, w: 1000, d: 600, rot: 0, roomId: p.geometry.rooms[0].id, ruleId: null, movedByManager: false }], benefits: [], compromises: [], assumptions: [], changes: [], issues: [], metrics: {}, approved: false, editedByManager: false }];
  if (mixed) {
    p.geometry.fixed = [{ id: 'fixed-mixed', kind: 'riser', polygon: rect(7000, 5000, 7200, 5200), source: 'manual', sourcePage: 1, verifiedByManager: true }];
    p.variants[0].items[1].type = 'armchair'; p.geometry.approvedHash = geometryHash(p.geometry); p.variants[0].geometryHash = geometryHash(p.geometry);
  }
  if (three) { p.variants = [p.variants[0], ...(['storage', 'family'] as const).map((scenario, n) => ({ ...p.variants[0], id: `keep-${n}`, scenario, title: scenario, items: p.variants[0].items.map(i => ({ ...i, id: `${i.id}-${n}` })), approved: n === 0 }))]; p.selectedVariantId = 'keep-0'; }
  await page.goto('/'); await page.locator('input[type=file]').setInputFiles({ name: 'edit.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'trust-planner-project', version: 1, project: p, files: {} })) });
  await expect(page.locator('.qf-canvas [data-wall-id]')).toHaveCount(6);
  return p;
}
async function saved(page: Page) { return page.evaluate(async () => { const alias = document.querySelector('.top strong')?.textContent; const db = await new Promise<IDBDatabase>(resolve => { const q = indexedDB.open('trust-planner'); q.onsuccess = () => resolve(q.result); }); const all = await new Promise<any[]>(resolve => { const q = db.transaction('projects').objectStore('projects').getAll(); q.onsuccess = () => resolve(q.result); }); db.close(); return all.find(p => p.alias === alias); }); }
async function point(svg: Locator, x: number, y: number) {
  await svg.scrollIntoViewIfNeeded(); const p = await svg.evaluate((el: SVGSVGElement, value) => { const p = el.createSVGPoint(); p.x = value.x; p.y = value.y; const s = p.matrixTransform(el.getScreenCTM()!); return { x: s.x, y: s.y }; }, { x, y }); return p;
}
async function click(page: Page, svg: Locator, x: number, y: number) { const p = await point(svg, x, y); await page.mouse.click(p.x, p.y); }
async function drag(page: Page, svg: Locator, from: [number, number], to: [number, number], shiftLayout = false) { const a = await point(svg, ...from), b = await point(svg, ...to); await page.mouse.move(a.x, a.y); await page.mouse.down(); if (shiftLayout) await svg.evaluate(el => { (el.closest('.detail') as HTMLElement).style.marginTop = '78px'; }); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up(); if (shiftLayout) await svg.evaluate(el => { (el.closest('.detail') as HTMLElement).style.marginTop = ''; }); }

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
  await drag(page, svg, [2500, 2300], [2900, 2500], true); await expect(detail.getByLabel('Ширина предмета, мм', { exact: true })).toHaveValue('1400'); await expect(detail.getByLabel('Глубина предмета, мм', { exact: true })).toHaveValue('800');
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

test('смешанная группа: мебель, стена, окно, зона, комната и стояк; удалить и отменить одним действием', async ({ page }) => {
  const p = await example(page, false, true), detail = page.locator('.detail'), svg = detail.locator('svg').first();
  await click(page, svg, 2000, 2000);
  await page.keyboard.down('Shift');
  for (const pos of [[4000,2000],[500,0],[2500,0],[1700,4700],[3000,3200],[7100,5100]] as [number,number][]) await click(page, svg, ...pos);
  await page.keyboard.up('Shift');
  await expect(detail.locator('[data-mixed-selection]')).toHaveAttribute('data-mixed-selection', '7');
  await expect(svg.locator('[data-item-id][data-selected="true"]')).toHaveCount(2);
  await expect(svg.locator('[data-wall-id][data-selected="true"]')).toHaveCount(1);
  await expect(svg.locator('[data-opening-id][data-selected="true"]')).toHaveCount(1);
  await expect(svg.locator('[data-room-id][data-selected="true"]')).toHaveCount(1);
  await expect(svg.locator('[data-wet-id][data-selected="true"]')).toHaveCount(1);
  await expect(svg.locator('[data-fixed-id][data-selected="true"]')).toHaveCount(1);
  await page.keyboard.down('Shift'); await click(page, svg, 2500, 0); await page.keyboard.up('Shift');
  await expect(detail.locator('[data-mixed-selection]')).toHaveAttribute('data-mixed-selection', '6');
  await page.keyboard.down('Shift'); await click(page, svg, 2500, 0); await page.keyboard.up('Shift');
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await saved(page))?.variants[0].items.length).toBe(0);
  await expect(svg.locator('[data-wall-id]')).toHaveCount(5); await expect(svg.locator('[data-room-id]')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await saved(page))?.geometry).toEqual(p.geometry);
  await expect.poll(async () => (await saved(page))?.variants[0].items).toEqual(p.variants[0].items);
});

test('подписи уменьшаются вместе с планом при отдалении в быстрой правке и разметке', async ({ page }) => {
  await example(page);
  const quick = page.locator('details').filter({ has: page.locator('summary', { hasText: /^Быстрая правка/ }) });
  for (const mode of ['quick', 'markup']) {
    if (mode === 'markup') await page.getByRole('button', { name: /Разметка/ }).first().click();
    const svg = mode === 'quick' ? quick.locator('svg') : page.locator('.editor svg').first();
    await svg.scrollIntoViewIfNeeded();
    const label = svg.locator('[data-room-label] text').first(), before = await label.boundingBox(), font = await label.getAttribute('font-size');
    const box = await svg.boundingBox(); await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.wheel(0, 700);
    await expect.poll(async () => (await label.boundingBox())!.width).toBeLessThan(before!.width * .7);
    await expect(label).toHaveAttribute('font-size', font!);
  }
});

test('контур комнаты замыкается Enter на последней точке, две точки создают прямоугольник', async ({ page }) => {
  const p = await example(page); p.geometry.rooms = [p.geometry.rooms[0]]; p.geometry.approvedHash = geometryHash(p.geometry); p.variants[0].geometryHash = geometryHash(p.geometry);
  await page.goto('/'); await page.locator('input[type=file]').setInputFiles({ name: 'room-points.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'trust-planner-project', version: 1, project: p, files: {} })) });
  const quick = page.locator('details').filter({ has: page.locator('summary', { hasText: /^Быстрая правка/ }) }), svg = quick.locator('svg');
  const corners: [number,number][] = [[6000,1000],[9000,1000],[9000,3000],[8000,3000],[8000,2200],[6000,2200]];
  await quick.getByRole('button', { name: 'Контур комнаты', exact: true }).click();
  for (const c of corners) await click(page, svg, ...c);
  await page.keyboard.press('Enter'); await expect(svg.locator('[data-room-id]')).toHaveCount(2);
  const polygon = await svg.locator('[data-room-id]').last().getAttribute('d'); expect(polygon).toMatch(/Z$/);
  await expect.poll(async () => (await saved(page))?.geometry.rooms.at(-1)?.polygon).toEqual(corners.map(([x,y]) => ({x,y})));
  await quick.getByRole('button', { name: 'Отменить', exact: true }).click();
  await quick.getByRole('button', { name: 'Контур комнаты', exact: true }).click(); await click(page, svg, 6000, 1000); await click(page, svg, 8500, 2800); await page.keyboard.press('Enter');
  await expect.poll(async () => (await saved(page))?.geometry.rooms.at(-1)?.polygon.length).toBe(4);
  await quick.getByRole('button', { name: 'Отменить', exact: true }).click();
  await quick.getByRole('button', { name: 'Комната по углам', exact: true }).click(); await click(page, svg, 6500, 4400); await click(page, svg, 8600, 6400);
  await expect(svg.locator('[data-room-id]')).toHaveCount(2);
  await quick.getByRole('button', { name: 'Отменить', exact: true }).click();
  await page.getByRole('button', { name: /Разметка/ }).first().click();
  await page.getByRole('button', { name: 'Помещение по точкам', exact: true }).click();
  const markup = page.locator('.editor svg').first(); await click(page, markup, 6000, 1000); await click(page, markup, 8500, 2800); await page.keyboard.press('Enter');
  await expect.poll(async () => (await saved(page))?.geometry.rooms.at(-1)?.polygon.length).toBe(4);
});

test('стены привязываются к стороне распознанной зоны без ручных стен в обоих редакторах', async ({ page }) => {
  const p = await example(page);
  p.geometry.walls = [];
  p.geometry.rooms = p.geometry.rooms.map(r => ({ ...r, source: 'suggested', verifiedByManager: false }));
  p.geometry.approvedHash = geometryHash(p.geometry); p.variants[0].geometryHash = geometryHash(p.geometry);
  await page.goto('/'); await page.locator('input[type=file]').setInputFiles({ name: 'recognized.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'trust-planner-project', version: 1, project: p, files: {} })) });
  for (const editor of ['quick', 'markup']) {
    if (editor === 'markup') await page.getByRole('button', { name: /Разметка/ }).first().click();
    const root = editor === 'quick' ? page.locator('details').filter({ has: page.locator('summary', { hasText: /^Быстрая правка/ }) }) : page.locator('.view');
    const svg = editor === 'quick' ? root.locator('svg') : page.locator('.editor svg').first();
    await root.getByRole('button', { name: 'Стена', exact: true }).click();
    await click(page, svg, 180, 2000); await click(page, svg, 180, 3000); await page.keyboard.press('Enter');
    await expect.poll(async () => (await saved(page))?.geometry.walls[0]?.a).toEqual({ x: 150, y: 2000 });
    await expect.poll(async () => (await saved(page))?.geometry.walls[0]?.b).toEqual({ x: 150, y: 3000 });
    await page.keyboard.press('Control+z'); await expect(svg.locator('[data-wall-id]')).toHaveCount(0);
  }
});
