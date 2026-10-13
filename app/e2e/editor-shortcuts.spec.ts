import { expect, test, type Locator, type Page } from '@playwright/test';
import { twoRoom, brief, wall } from '../tests/fixtures/synthetic';
import type { PlanGeometry } from '../src/model/types';
import { newProject } from '../src/model/defaults';
import { geometryHash } from '../src/geometry/plan';

async function importExample(page: Page, geometry: PlanGeometry = twoRoom()) {
  const project = newProject({ alias: 'Горячие клавиши', city: 'Москва', manager: '', date: '2026-10-05' });
  project.brief = brief;
  project.geometry = geometry;
  project.geometry.approvedHash = geometryHash(project.geometry);
  project.variants = [{ id: 'shortcut-variant', scenario: 'space', title: 'Пример', idea: 'Проверка клавиш', geometryHash: geometryHash(project.geometry),
    items: [{ id: 'shortcut-tub', type: 'bathtub', x: 2500, y: 2000, rot: 0, w: 1700, d: 700, roomId: project.geometry.rooms[0]?.id ?? null, ruleId: null, movedByManager: false }],
    benefits: [], compromises: [], assumptions: [], changes: [], issues: [], metrics: {}, approved: false, editedByManager: false }];
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'shortcuts.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'trust-planner-project', version: 1, project, files: {} })) });
  return project;
}

async function point(page: Page, svg: Locator, x: number, y: number, click = true) {
  await svg.scrollIntoViewIfNeeded();
  const p = await svg.evaluate((el, pos) => {
    const svg = el as SVGSVGElement;
    const p = svg.createSVGPoint(); p.x = pos.x; p.y = pos.y;
    const screen = p.matrixTransform(svg.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  }, { x, y });
  if (click) await page.mouse.click(p.x, p.y); else await page.mouse.move(p.x, p.y);
}

test('новый запуск открывает пустую форму, старый проект доступен вручную', async ({ page }) => {
  const p = await importExample(page);
  await expect(page.getByText('Сохранение…', { exact: true })).toBeHidden();
  // Проверяем миграцию из старого поведения: даже старый ключ не восстанавливает проект.
  await page.evaluate(id => localStorage.setItem('trust-planner:last', id), p.id);
  await page.reload();
  await expect(page.getByPlaceholder(/Например/)).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Создать проект', exact: true })).toBeVisible();
  await expect(page.locator('.shell')).toHaveCount(0);
  await page.locator('.prow').filter({ hasText: p.alias }).getByRole('button', { name: 'Открыть', exact: true }).click();
  await expect(page.locator('.qf-canvas [data-wall-id]')).toHaveCount(6);
  await expect(page.locator('.detail [data-item-id="shortcut-tub"]')).toHaveCount(1);
});

test('полилинии, Enter, Esc, история и Delete работают в активном редакторе', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  await importExample(page);
  const quick = page.locator('details').filter({ has: page.locator('summary', { hasText: /^Быстрая правка/ }) });
  const svg = quick.locator('svg');
  const tub = page.locator('.detail [data-item-id="shortcut-tub"]');
  await tub.scrollIntoViewIfNeeded(); await tub.click();
  await quick.getByRole('button', { name: 'Стена', exact: true }).click();
  await point(page, svg, 7000, 4500);
  await page.keyboard.down('Shift');
  await point(page, svg, 8500, 4650);
  await point(page, svg, 8400, 5600);
  await page.keyboard.up('Shift');
  await point(page, svg, 7000, 5600);
  await expect(svg.locator('[data-wall-id]')).toHaveCount(6);
  await expect(svg.locator('[data-wall-draft]')).toHaveAttribute('d', 'M7000 4500L8500 4500L8500 5600L7000 5600');
  // Наведение после последнего клика не добавляет лишний сегмент при Enter.
  await point(page, svg, 7500, 5900, false);
  await page.keyboard.press('Enter');
  await expect(svg.locator('[data-wall-id]')).toHaveCount(9);
  await expect(svg.locator('[data-wall-draft]')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(svg.locator('[data-wall-id]')).toHaveCount(6);
  await page.keyboard.press('Control+y');
  await expect(svg.locator('[data-wall-id]')).toHaveCount(9);
  await point(page, svg, 7750, 4500);
  // Ввод толщины не запускает Delete для выбранной стены.
  const thickness = quick.getByLabel('Толщина выбранной стены, мм');
  await thickness.focus(); await page.keyboard.press('Delete');
  await expect(svg.locator('[data-wall-id]')).toHaveCount(9);
  await point(page, svg, 7750, 4500); await page.keyboard.press('Delete');
  await expect(svg.locator('[data-wall-id]')).toHaveCount(8);
  await expect(tub).toHaveCount(1);
  await page.keyboard.press('w');
  await point(page, svg, 7000, 4500); await point(page, svg, 7500, 4900);
  await page.keyboard.press('Escape');
  await expect(svg.locator('[data-wall-id]')).toHaveCount(8);
  await expect(svg.locator('[data-wall-draft]')).toHaveCount(0);
  // Выбор мебели переключает область горячих клавиш: стена остаётся на месте.
  await tub.scrollIntoViewIfNeeded(); await tub.click(); await page.keyboard.press('Delete');
  await expect(tub).toHaveCount(0);
  await expect(svg.locator('[data-wall-id]')).toHaveCount(8);

  await page.getByRole('button', { name: /Разметка/ }).first().click();
  const full = page.locator('.canvas-wrap svg');
  await page.getByRole('button', { name: 'Стена', exact: true }).click();
  await point(page, full, 1500, 1500); await page.keyboard.down('Shift');
  await point(page, full, 3200, 1650); await point(page, full, 3300, 3000);
  await point(page, full, 1500, 3100); await page.keyboard.up('Shift');
  await expect(full.locator('[data-wall-id]')).toHaveCount(8);
  await page.keyboard.press('Control+z');
  await expect(full.locator('[data-wall-draft]')).toHaveAttribute('d', /M1500 1500L3200 1500L3200 3000/);
  await full.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'н', code: 'KeyY', ctrlKey: true, bubbles: true })));
  await expect(full.locator('[data-wall-draft]')).toHaveAttribute('d', /M1500 1500L3200 1500L3200 3000L1500 3000/);
  await full.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'я', code: 'KeyZ', ctrlKey: true, bubbles: true })));
  await expect(full.locator('[data-wall-draft]')).toHaveAttribute('d', /M1500 1500L3200 1500L3200 3000/);
  await page.keyboard.press('Enter');
  await expect(full.locator('[data-wall-id]')).toHaveCount(10);
  await page.keyboard.press('Control+z'); await expect(full.locator('[data-wall-id]')).toHaveCount(8);
  await page.keyboard.press('Control+y'); await expect(full.locator('[data-wall-id]')).toHaveCount(10);
  await point(page, full, 2400, 1500); await page.keyboard.press('Delete');
  await expect(full.locator('[data-wall-id]')).toHaveCount(9);
  await page.keyboard.press('w'); await point(page, full, 1500, 1500); await point(page, full, 2200, 1900);
  await page.keyboard.press('Escape'); await expect(full.locator('[data-wall-id]')).toHaveCount(9);
});

test('автокомната соединяет близкий угол без исходного скана; отмена и повтор возвращают результат', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop');
  const g = twoRoom();
  g.rooms = []; g.openings = []; g.fixed = [];
  g.walls = [
    wall({ x: 0, y: 0 }, { x: 2920, y: 0 }, 40),
    wall({ x: 3000, y: 80 }, { x: 3000, y: 3000 }, 40),
    wall({ x: 3000, y: 3000 }, { x: 0, y: 3000 }, 40),
    wall({ x: 0, y: 3000 }, { x: 0, y: 0 }, 40),
  ];
  await importExample(page, g);
  const quick = page.locator('details').filter({ has: page.locator('summary', { hasText: /^Быстрая правка/ }) });
  const svg = quick.locator('svg');
  await expect(quick.getByRole('button', { name: 'Соединить углы стен', exact: true })).toBeVisible();
  const add = quick.getByRole('button', { name: 'Добавить комнату', exact: true });
  await expect(add).toBeEnabled(); await add.click();
  await point(page, svg, 1500, 1500);
  await expect(svg.locator('[data-room-id]')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(svg.locator('[data-room-id]')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(svg.locator('[data-room-id]')).toHaveCount(1);
});
