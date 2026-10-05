import { expect, test, type Page } from '@playwright/test';
import { newProject } from '../src/model/defaults';
import { twoRoom } from '../tests/fixtures/synthetic';
import { geometryHash } from '../src/geometry/plan';
import { PNG } from 'pngjs';

test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });
async function saved(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('trust-planner'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const all = await new Promise<any[]>((resolve, reject) => { const r = db.transaction('projects').objectStore('projects').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    db.close(); return all.find(p => p.alias === 'Объёмная сцена');
  });
}

test('3D: сцена, размеры, материалы, ракурс для клиента и сохранение проекта', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const project = newProject({ alias: 'Объёмная сцена', city: 'Москва', manager: 'Демо', date: '2026-10-05' });
  project.geometry = twoRoom(); project.geometry.approvedHash = geometryHash(project.geometry);
  const hash = geometryHash(project.geometry);
  project.variants = ['space', 'storage', 'family'].map((scenario, n) => ({ id: `scene-v${n}`, scenario: scenario as 'space' | 'storage' | 'family', title: ['Пространство', 'Хранение', 'Семейный'][n], idea: 'Тест объёмной схемы', geometryHash: hash,
    items: [{ id: `bath${n}`, type: 'bathtub' as const, x: 2500, y: 2100, w: 1700, d: 700, rot: 90 as const, roomId: project.geometry.rooms[0].id, ruleId: null, movedByManager: true },
      { id: `sofa${n}`, type: 'sofa' as const, x: 7000 + n * 300, y: 2200, w: 2200, d: 950, rot: 0 as const, roomId: project.geometry.rooms[1].id, ruleId: null, movedByManager: true }],
    benefits: [], compromises: [], assumptions: [], changes: [], issues: [], metrics: {}, approved: n === 0, editedByManager: false }));
  project.selectedVariantId = project.variants[0].id;
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'trust-planner-project', version: 1, project, files: {} })) });
  await page.getByRole('button', { name: /Мини-концепция/ }).first().click();
  const canvas = page.getByLabel('3D: Пространство', { exact: true });
  await expect(canvas).toHaveAttribute('data-scene-ready', 'true');
  expect(Number(await canvas.getAttribute('data-scene-nodes'))).toBeGreaterThan(5);
  const pixels = await canvas.evaluate((el: HTMLCanvasElement) => {
    const gl = el.getContext('webgl')!, a = new Uint8Array(el.width * el.height * 4); gl.readPixels(0, 0, el.width, el.height, gl.RGBA, gl.UNSIGNED_BYTE, a);
    let nonBackground = 0; for (let i = 0; i < a.length; i += 4) if (a[i] < 220 || a[i + 1] < 210 || a[i + 2] < 200) nonBackground++; return nonBackground;
  });
  expect(pixels).toBeGreaterThan(5000);
  await page.getByLabel('Высота потолка, мм', { exact: true }).fill('3100'); await page.getByLabel('Высота потолка, мм', { exact: true }).press('Enter');
  await page.getByText('Высоты мебели', { exact: true }).click();
  await page.getByLabel('Ванна: высота, мм', { exact: true }).fill('550'); await page.getByLabel('Ванна: высота, мм', { exact: true }).press('Enter');
  await page.getByText('Каталог материалов (0)', { exact: true }).click();
  const texture = new PNG({ width: 8, height: 8 });
  for (let i = 0; i < texture.data.length; i += 4) { texture.data[i] = 112; texture.data[i + 1] = 76; texture.data[i + 2] = 50; texture.data[i + 3] = 255; }
  const textureDataUrl = 'data:image/png;base64,' + PNG.sync.write(texture).toString('base64');
  await page.getByLabel('Импорт каталога материалов', { exact: true }).setInputFiles({ name: 'materials.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, materials: [{ id: 'floor-test', name: 'Тёмный дуб', category: 'floor', color: '#704c32', price: 2500, unit: 'м²', textureDataUrl, tileWidthMm: 1200, tileHeightMm: 200 }] })) });
  await page.getByLabel('Материал: Пол', { exact: true }).selectOption('floor-test');
  await expect.poll(async () => (await saved(page)).concept.scene3d.assignments.floor).toBe('floor-test');
  await page.getByLabel('Импорт каталога материалов', { exact: true }).setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"version":9,"materials":[]}') });
  await expect(page.getByRole('alert')).toContainText('Нужен каталог');
  expect((await saved(page)).concept.materialCatalog.materials[0].id).toBe('floor-test');
  await page.getByLabel('Вариант 3D', { exact: true }).selectOption('scene-v1');
  await expect(page.getByLabel('3D: Хранение', { exact: true })).toHaveAttribute('data-scene-ready', 'true');
  await page.getByLabel('Вариант 3D', { exact: true }).selectOption('scene-v0');
  await page.getByRole('button', { name: 'Сверху', exact: true }).click();
  await page.getByRole('button', { name: 'Общий вид', exact: true }).click();
  if (info.project.name === 'desktop') {
    const preview = await canvas.evaluate((el: HTMLCanvasElement) => { const c = document.createElement('canvas'); c.width = 900; c.height = Math.round(el.height / el.width * 900); c.getContext('2d')!.drawImage(el, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', .7); });
    console.log('SCENE_PREVIEW:' + preview);
  }
  await page.getByRole('button', { name: 'Сохранить ракурс', exact: true }).click();
  await expect.poll(async () => (await saved(page)).concept.references.length).toBe(1);
  await page.getByRole('button', { name: /Для клиента/ }).first().click();
  await expect(page.locator('.client .ref img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await page.reload();
  await page.locator('.prow').filter({ hasText: 'Объёмная сцена' }).getByRole('button', { name: 'Открыть', exact: true }).click();
  await page.getByRole('button', { name: /Мини-концепция/ }).first().click();
  await expect(page.getByLabel('Высота потолка, мм', { exact: true })).toHaveValue('3100');
  const restored = await saved(page);
  expect(restored.concept.scene3d.heights.bathtub).toBe(550); expect(restored.concept.scene3d.assignments.floor).toBe('floor-test');
  expect(restored.concept.materialCatalog.materials[0].textureDataUrl).toBe(textureDataUrl);
  expect(restored.variants[0].items[0]).toMatchObject({ w: 1700, d: 700, rot: 90 });
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
});
