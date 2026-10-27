import { expect, test } from '@playwright/test';
import { newProject, emptyGeometry } from '../src/model/defaults';
import { checkedPlan } from '../src/learning/model';

// UI import/retry/reload against the real browser IndexedDB; only quota failure is injected.
test('ошибка обучения не оставляет копию, повторный импорт сохраняется целиком', async ({ page }) => {
  const project = newProject({ alias: 'Атомарный импорт', city: '', date: '', manager: '' });
  const geometry = { ...emptyGeometry(), sourcePage: 1,
    calibration: { p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, mm: 1, mmPerUnit: 1 },
    rooms: [{ id: 'r', name: 'Комната', type: 'living' as const, typeSource: 'manual' as const,
      polygon: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, { x: 0, y: 2000 }],
      source: 'manual' as const, verifiedByManager: true, sourcePage: 1 }] };
  const plan = checkedPlan('a'.repeat(64) + ':1', geometry);
  const original = { format: 'trust-planner-project', version: 1, project, files: {} };
  const upload = (archive: object) => page.locator('input[type=file]').setInputFiles({
    name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(archive)),
  });
  await page.goto('/');
  await upload(original);
  await expect(page.getByRole('heading', { name: 'О проекте', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Все проекты', exact: true }).click();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'learning') throw new DOMException('Synthetic quota', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await upload({ ...original, learning: { format: 'trust-planner-learning', version: 1, plans: [plan] } });
  await expect(page.locator('.notice.err')).toContainText('Synthetic quota');
  await expect(page.locator('.prow')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.prow')).toHaveCount(1);
  await upload({ ...original, learning: { format: 'trust-planner-learning', version: 1, plans: [plan] } });
  await expect(page.getByRole('heading', { name: 'О проекте', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Все проекты', exact: true }).click();
  await expect(page.locator('.prow')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('.prow')).toHaveCount(2);
  const plans = await page.evaluate(async () => {
    const path = '/src/storage/db.ts';
    return (await import(path)).listLearnedPlans();
  });
  expect(plans).toHaveLength(1);
  expect(plans[0].key).toBe(plan.key);
});
