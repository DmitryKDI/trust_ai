import { expect, test } from '@playwright/test';
import { newProject } from '../src/model/defaults';

function minimalPdf() {
  const content = '20 20 260 260 re 2 w S\n';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << >> /Contents 4 0 R >>', `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(x => `${x.toString().padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test('invalid backup is rejected before opening and script links are blocked', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); const p = newProject({ alias: 'Unsafe', city: '', manager: '', date: '' });
  p.concept.references = [{ id: 'r', url: 'data:image/png;base64,AAAA', caption: '', sourceName: '', sourceUrl: 'javascript:alert(1)', kind: 'reference' }];
  await page.locator('input[type=file]').setInputFiles({ name: 'unsafe.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'trust-planner-project', version: 1, project: p, files: {} })) });
  await expect(page.locator('.notice.err')).toContainText('ссылка на источник'); await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('save failure is visible, retry restores data and immediate close persists edits', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await page.getByRole('button', { name: 'Создать проект', exact: true }).click();
  await expect(page.getByText('Сохранено в браузере', { exact: true })).toBeVisible();
  await page.evaluate(() => { const original = IDBObjectStore.prototype.put; (window as any).failPlannerSave = true; IDBObjectStore.prototype.put = function (...args: any[]) { if (this.name === 'projects' && (window as any).failPlannerSave) throw new DOMException('Synthetic quota', 'QuotaExceededError'); return original.apply(this, args as any); }; });
  await page.getByLabel('Псевдоним или номер клиента', { exact: true }).fill('Не потерять');
  await expect(page.getByRole('alert')).toContainText('Не удалось сохранить проект'); await expect(page.getByText('Не сохранено', { exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).failPlannerSave = false; }); await page.getByRole('button', { name: 'Повторить сохранение' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('Псевдоним или номер клиента', { exact: true }).fill('Мгновенное закрытие'); await page.getByRole('button', { name: 'Все проекты', exact: true }).click();
  await expect(page.locator('.prow')).toContainText('Мгновенное закрытие'); await page.reload(); await expect(page.locator('.prow')).toContainText('Мгновенное закрытие');
  expect(errors).toEqual([]);
});

test('patched PDF worker reads and renders an uploaded PDF in the browser', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await page.getByRole('button', { name: 'Создать проект', exact: true }).click(); await page.getByRole('button', { name: 'К загрузке плана', exact: true }).click();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: minimalPdf() });
  await expect(page.locator('.thumb img')).toBeVisible();
  await page.getByRole('button', { name: /Разметка/ }).click(); await expect(page.locator('svg image')).toHaveAttribute('href', /^blob:/);
  expect(errors).toEqual([]);
});

test('local server refuses other origins and sibling repository files', async ({ request }) => {
  const response = await request.get('/', { headers: { Origin: 'https://untrusted.example' } });
  expect(response.headers()['access-control-allow-origin']).toBeUndefined(); expect(response.headers()['x-content-type-options']).toBe('nosniff');
  const blocked = await request.get('/@fs/' + process.cwd().replace(/\\/g, '/').replace(/\/app$/, '') + '/docs/TZ.md');
  expect(blocked.status()).toBe(403);
});

test('HTML in imported client data stays text; repeated imports preserve the original project', async ({ page }) => {
  const p = newProject({ alias: 'Original project', city: '', manager: '', date: '' });
  const importBackup = async () => page.locator('input[type=file]').setInputFiles({ name: 'probe.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'trust-planner-project', version: 1, project: p, files: {} })) });
  await page.goto('/'); await importBackup(); await expect(page.getByRole('heading', { name: 'О проекте', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Все проекты', exact: true }).click();
  p.alias = '<img src=x onerror="window.backupPwned=true">'; await importBackup();
  await expect(page.getByRole('heading', { name: 'О проекте', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).backupPwned)).toBeUndefined();
  await page.getByRole('button', { name: 'Все проекты', exact: true }).click();
  await expect(page.locator('.prow').filter({ hasText: 'Original project' })).toHaveCount(1);
  await expect(page.locator('.prow').filter({ hasText: '(копия)' })).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).backupPwned)).toBeUndefined();
});
