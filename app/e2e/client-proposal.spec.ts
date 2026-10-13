import { expect, test } from '@playwright/test';
import { newProject } from '../src/model/defaults';
import { twoRoom } from '../tests/fixtures/synthetic';
import { geometryHash } from '../src/geometry/plan';
import fs from 'node:fs/promises';

test('КП: продающий титул, читаемые варианты и экспорт полного предложения', async ({ page }, info) => {
  const project = newProject({ alias: 'Квартира для семьи', city: 'Москва', manager: 'Роман', date: '2026-10-13' });
  project.geometry = twoRoom();
  const hash = geometryHash(project.geometry);
  project.geometry.approvedHash = hash;
  project.variants = ['space', 'storage', 'family'].map((scenario, i) => ({
    id: `proposal-${i}`, scenario: scenario as 'space' | 'storage' | 'family',
    title: ['Больше пространства', 'Максимум хранения', 'Семейный'][i],
    idea: ['Свободные проходы и светлая общая зона', 'Каждой вещи — своё место', 'У каждого своё место для отдыха и работы'][i],
    geometryHash: hash,
    items: [{ id: `sofa-${i}`, type: 'sofa' as const, x: 7000 + i * 250, y: 2200, w: 2200, d: 950, rot: 0 as const, roomId: project.geometry.rooms[1].id, ruleId: null, movedByManager: true }],
    benefits: ['Свободный проход между зонами', 'Место для семейного отдыха', 'Хранение вдоль свободной стены'],
    compromises: ['Размеры мебели уточняются после обмера'], assumptions: [], changes: [], issues: [], metrics: {}, approved: i === 1, editedByManager: false,
  }));
  project.selectedVariantId = project.variants[1].id;
  await page.goto('/');
  await page.locator('input[type=file]').setInputFiles({ name: 'proposal.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'trust-planner-project', version: 1, project, files: {} })) });
  await page.getByRole('button', { name: /Для клиента/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Квартира, в которой удобно жить.' })).toBeVisible();
  await expect(page.locator('.client > :first-child')).toHaveClass('proposal-cover');
  await expect(page.locator('.client-variant')).toHaveCount(3);
  await expect(page.locator('[data-client-3d]')).toHaveCount(3);
  await expect(page.locator('[data-cover-3d]')).toHaveCount(1);
  expect(await page.locator('[data-client-3d]').evaluateAll(images => images.every(el => (el as HTMLImageElement).naturalWidth >= 1600))).toBe(true);
  await expect(page.locator('.clientfooter a')).toHaveAttribute('href', 'https://trustremont.ru');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('proposal.png'), fullPage: true });
  if (info.project.name === 'desktop') {
    await page.emulateMedia({ media: 'print' });
    const breaks = await page.locator('.client-variant').evaluateAll(nodes => nodes.map(n => getComputedStyle(n).breakBefore));
    expect(breaks).toEqual(['page', 'page', 'page']);
    const columns = await page.locator('.proposal-variant-views').first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(2);
    await page.pdf({ path: info.outputPath('proposal.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
    const bytes = await fs.readFile(info.outputPath('proposal.pdf'));
    const boxes = [...bytes.toString('latin1').matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
    expect(boxes).toHaveLength(7);
    expect(boxes.every(box => Number(box[1]) > Number(box[2]))).toBe(true);
  }
});
