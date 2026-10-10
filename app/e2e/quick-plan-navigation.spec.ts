import { expect, test, type Locator, type Page } from '@playwright/test';
import { twoRoom } from '../tests/fixtures/synthetic';
import { newProject } from '../src/model/defaults';
import { geometryHash } from '../src/geometry/plan';

async function example(page: Page) {
  const p = newProject({ alias: 'Первый экран плана', city: '', manager: '', date: '' });
  p.geometry = twoRoom();
  p.geometry.walls[0] = { ...p.geometry.walls[0], source: 'suggested', verifiedByManager: false };
  p.geometry.walls[1] = { ...p.geometry.walls[1], source: 'suggested', verifiedByManager: true };
  p.geometry.rooms[0] = { ...p.geometry.rooms[0], source: 'suggested', verifiedByManager: false };
  p.geometry.openings[0] = { ...p.geometry.openings[0], source: 'suggested', verifiedByManager: false };
  p.geometry.approvedHash = geometryHash(p.geometry);
  p.planImage = { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', widthMm: 10000, heightMm: 7000 };
  p.variants = [{ id: 'nav-v', scenario: 'space', title: 'Пример', idea: 'Проверка', geometryHash: geometryHash(p.geometry), items: [], benefits: [], compromises: [], assumptions: [], changes: [], issues: [], metrics: {}, approved: false, editedByManager: false }];
  await page.goto('/'); await page.locator('input[type=file]').setInputFiles({ name: 'pan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'trust-planner-project', version: 1, project: p, files: {} })) });
  return p;
}
function quick(page: Page) { return page.locator('details').filter({ has: page.locator('summary', { hasText: /^Быстрая правка/ }) }); }
async function saved(page: Page) { return page.evaluate(async () => { const db = await new Promise<IDBDatabase>(resolve => { const q = indexedDB.open('trust-planner'); q.onsuccess = () => resolve(q.result); }); const all = await new Promise<any[]>(resolve => { const q = db.transaction('projects').objectStore('projects').getAll(); q.onsuccess = () => resolve(q.result); }); db.close(); return all.find(p => p.alias === 'Первый экран плана'); }); }
async function at(svg: Locator, x: number, y: number) { return svg.evaluate((el: SVGSVGElement, pos) => { const pt = el.createSVGPoint(); pt.x = pos.x; pt.y = pos.y; const s = pt.matrixTransform(el.getScreenCTM()!); return { x: s.x, y: s.y }; }, { x, y }); }
async function clickWorld(page: Page, svg: Locator, x: number, y: number) { await svg.scrollIntoViewIfNeeded(); const p = await at(svg, x, y); await page.mouse.click(p.x, p.y); }
async function drag(page: Page, svg: Locator, dx: number, dy: number, button: 'left' | 'middle' = 'left') {
  await svg.scrollIntoViewIfNeeded(); const box = await svg.boundingBox(); const start = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  await page.mouse.move(start.x, start.y); await page.mouse.down({ button }); await page.mouse.move(start.x + dx, start.y + dy, { steps: 7 }); await page.mouse.up({ button });
}

test('Рука, H, пробел, средняя кнопка и Вписать двигают только вид плана', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); const p = await example(page), root = quick(page), svg = root.locator('svg');
  const initial = await svg.getAttribute('viewBox');
  await root.getByRole('button', { name: 'Рука', exact: true }).click(); await expect(root.getByRole('button', { name: 'Рука', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await svg.scrollIntoViewIfNeeded(); const before = await at(svg, 1000, 1000);
  await drag(page, svg, 75, 40); const after = await at(svg, 1000, 1000);
  expect(after.x - before.x).toBeCloseTo(75, 0); expect(after.y - before.y).toBeCloseTo(40, 0);
  await expect(svg).not.toHaveAttribute('viewBox', initial!); await expect(svg).toHaveCSS('cursor', 'grab');
  await root.getByRole('button', { name: 'Вписать', exact: true }).click(); await expect(svg).toHaveAttribute('viewBox', initial!);
  await root.getByRole('button', { name: 'Стена', exact: true }).click(); await clickWorld(page, svg, 7000, 4500); await clickWorld(page, svg, 8200, 4500);
  const draft = await svg.locator('[data-wall-draft]').getAttribute('d');
  await page.keyboard.down('Space'); await drag(page, svg, -55, 25); await page.keyboard.up('Space');
  await expect(svg.locator('[data-wall-draft]')).toHaveAttribute('d', draft!); await expect(svg.locator('[data-wall-id]')).toHaveCount(6);
  await drag(page, svg, 30, -20, 'middle'); await expect(svg.locator('[data-wall-draft]')).toHaveAttribute('d', draft!);
  await page.keyboard.press('Escape'); await page.keyboard.press('h'); await expect(root.getByRole('button', { name: 'Рука', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await saved(page))?.geometry).toEqual(p.geometry);
  await root.getByRole('button', { name: 'Вписать', exact: true }).click(); await root.getByRole('button', { name: 'Выбрать', exact: true }).click(); await clickWorld(page, svg, 2000, 2000);
  await expect(svg.locator(`[data-room-id="${p.geometry.rooms[0].id}"]`)).toHaveAttribute('data-selected', 'true'); expect(errors).toEqual([]);
});

test('найденные, проверенные и ручные элементы видны сразу; исходник сравнивается без правки', async ({ page }) => {
  const p = await example(page), root = quick(page), svg = root.locator('svg');
  await expect(svg.locator('[data-recognition-overlay]')).toHaveCount(1);
  await expect(svg.locator(`[data-recognition-id="${p.geometry.walls[0].id}"]`)).toHaveAttribute('data-recognition-source', 'automatic');
  await expect(svg.locator(`[data-recognition-id="${p.geometry.walls[1].id}"]`)).toHaveAttribute('data-recognition-source', 'verified');
  await expect(svg.locator(`[data-recognition-id="${p.geometry.walls[2].id}"]`)).toHaveAttribute('data-recognition-source', 'manual');
  await expect(svg.locator(`[data-recognition-id="${p.geometry.openings[0].id}"]`)).toHaveAttribute('data-recognition-kind', 'door');
  await root.getByText('Что нанесено на план', { exact: true }).click(); await expect(root.getByRole('table', { name: 'Найденные и ручные элементы' })).toContainText('Стены');
  await root.getByLabel('Подсветка найденных и ручных элементов', { exact: true }).uncheck(); await expect(svg.locator('[data-recognition-overlay]')).toHaveCount(0);
  await root.getByLabel('Подсветка найденных и ручных элементов', { exact: true }).check();
  await root.getByLabel('Только исходный план', { exact: true }).check(); await expect(svg.locator('[data-recognition-overlay]')).toHaveCount(0); await expect(svg.locator('[data-wall-id]')).toHaveCount(0);
  await expect(svg.locator('image')).toHaveAttribute('opacity', '1'); await drag(page, svg, 60, 15);
  await expect.poll(async () => (await saved(page))?.geometry).toEqual(p.geometry);
  await root.getByLabel('Только исходный план', { exact: true }).uncheck(); await expect(svg.locator('[data-wall-id]')).toHaveCount(6); await expect(svg.locator('[data-recognition-overlay]')).toHaveCount(1);
});
