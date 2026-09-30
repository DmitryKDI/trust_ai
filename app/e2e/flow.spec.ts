// Сквозной путь на демо-квартире (синтетические данные, не клиентские):
// импорт проекта → утверждение разметки → варианты → утверждение → страница клиента.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const geometry = JSON.parse(fs.readFileSync(path.join(__dirname, 'demo-geometry.json'), 'utf8'));
const shots = path.join(__dirname, '..', '..', 'docs', 'screenshots');

test('демо: от разметки до страницы клиента', async ({ page }, info) => {
  const tag = info.project.name;
  page.on('dialog', (d) => d.accept());
  await page.goto('/');
  const now = new Date().toISOString();
  const project = {
    id: `e2e-${tag}-${Date.now()}`, alias: 'Демо-квартира', city: 'Москва', manager: 'Демо', date: now.slice(0, 10), createdAt: now, updatedAt: now,
    brief: { area: '65', adults: 2, children: 1, childrenAges: '6', rooms: '', priorities: 'Больше хранения', workFromHome: true, style: 'Современный спокойный', budget: '', limits: '', mustHave: '', bans: '', bedAccessBothSides: true, diningSeats: 4, preferShower: false },
    documents: [], geometry, variants: [], selectedVariantId: null, review: null,
    concept: { styleName: 'Тёплая сдержанность', palette: [{ name: 'Молочный', hex: '#eee8df' }, { name: 'Песочный', hex: '#cbb9a7' }, { name: 'Орех', hex: '#8d6f5b' }, { name: 'Графит', hex: '#4a4f52' }], materials: ['Дуб', 'Матовая краска', 'Керамогранит'], references: [], rationale: 'Светлая база и тёплое дерево.' },
    ruleOverrides: {}, referenceNotes: '', referencePage: null,
  };
  const file = { format: 'trust-planner-project', version: 1, exportedAt: now, project, files: {} };
  await page.locator('input[type=file]').setInputFiles({ name: 'demo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });

  await page.getByRole('button', { name: /Разметка/ }).click();
  await page.getByRole('button', { name: 'Утвердить геометрию' }).click();
  await expect(page.getByText('Геометрия утверждена').first()).toBeVisible();
  await page.screenshot({ path: path.join(shots, `app-${tag}-markup.png`), fullPage: true });

  await page.getByRole('button', { name: 'К вариантам' }).click();
  await page.getByRole('button', { name: /Построить варианты/ }).click();
  await expect(page.locator('.vcard').first()).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.vcard')).toHaveCount(3);
  await page.getByRole('button', { name: 'Утвердить для клиента' }).click();
  await page.screenshot({ path: path.join(shots, `app-${tag}-variants.png`), fullPage: true });

  await page.getByRole('button', { name: /Для клиента/ }).click();
  await expect(page.locator('.cost .num')).toContainText('млн ₽');
  await page.screenshot({ path: path.join(shots, `app-${tag}-client.png`), fullPage: true });

  // Нет горизонтальной прокрутки ни на одном экране.
  for (const step of ['Проект', 'Бриф', 'Разметка', 'Варианты', 'Мини-концепция', 'Для клиента']) {
    await page.getByRole('button', { name: new RegExp(step) }).first().click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, step).toBeLessThanOrEqual(1);
  }
});
