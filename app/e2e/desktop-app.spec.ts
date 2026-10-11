import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import { newProject } from '../src/model/defaults';
import { twoRoom } from '../tests/fixtures/synthetic';
import { geometryHash } from '../src/geometry/plan';

const exe = path.resolve('release/win-unpacked/TrustRemontPlanner.exe');
const launch = () => electron.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], timeout: 60_000 });
async function close(app: ElectronApplication) {
  const exited = new Promise(resolve => app.process().once('exit', resolve));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await exited;
}

test('real packaged EXE: offline UI, safe renderer, import, three 3D views, native PDF and backup, persistence on immediate close', async ({}, info) => {
  let app = await launch();
  try {
    let page = await app.firstWindow();
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
    expect(page.url()).toBe('trust://planner/');
    const native = await app.evaluate(({ app }) => ({ packaged: app.isPackaged }));
    expect(native.packaged).toBe(true);
    expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined');
    // An external navigation is blocked before any network request or new window.
    await page.evaluate(() => { window.open('https://example.com'); window.location.assign('https://example.com'); });
    await expect(page).toHaveURL('trust://planner/');
    expect((await app.windows()).length).toBe(1);
    const project = newProject({ alias: 'Настольный проект', city: 'Москва', manager: 'До правки', date: '2026-10-11' });
    project.geometry = twoRoom(); const hash = geometryHash(project.geometry); project.geometry.approvedHash = hash;
    project.variants = ['space', 'storage', 'family'].map((scenario, i) => ({ id: `native-v${i}`, scenario: scenario as 'space' | 'storage' | 'family', title: ['Пространство', 'Хранение', 'Семейный'][i], idea: 'Проверка настольной версии', geometryHash: hash,
      items: [{ id: `sofa${i}`, type: 'sofa' as const, x: 7000 + i * 250, y: 2200, w: 2200, d: 950, rot: 0 as const, roomId: project.geometry.rooms[1].id, ruleId: null, movedByManager: true }], benefits: [], compromises: [], assumptions: [], changes: [], issues: [], metrics: {}, approved: i === 0, editedByManager: false }));
    project.selectedVariantId = project.variants[0].id;
    await page.locator('input[type=file]').setInputFiles({ name: 'previous-version.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'trust-planner-project', version: 1, project, files: {} })) });
    await page.getByRole('button', { name: /Для клиента/ }).first().click();
    await expect(page.locator('[data-client-3d]')).toHaveCount(3);
    const pdf = path.resolve(info.outputPath('native-client.pdf'));
    await fs.mkdir(path.dirname(pdf), { recursive: true });
    await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, pdf);
    await page.getByRole('button', { name: 'Сохранить PDF', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('PDF сохранён.');
    const bytes = await fs.readFile(pdf); expect(bytes.subarray(0, 4).toString()).toBe('%PDF'); expect(bytes.length).toBeGreaterThan(20_000);
    await page.screenshot({ path: info.outputPath('native-client.png'), fullPage: true });
    // Loading that PDF as a plan exercises the PDF worker over the packaged custom protocol.
    await page.getByRole('button', { name: /Загрузка/ }).first().click();
    await page.locator('input[type=file]').first().setInputFiles(pdf);
    await expect(page.getByText(/стр\. ·/).first()).toBeVisible();
    const backup = path.resolve(info.outputPath('project.trust-plan.json'));
    await app.evaluate(({ session }, filename) => { session.defaultSession.on('will-download', (_e, item) => item.setSavePath(filename)); }, backup);
    await page.getByRole('button', { name: /Проект/ }).first().click();
    await page.getByRole('button', { name: 'Резервная копия (JSON)' }).click();
    await expect.poll(async () => { try { return JSON.parse(await fs.readFile(backup, 'utf8')).format; } catch { return ''; } }).toBe('trust-planner-project');
    const imported = JSON.parse(await fs.readFile(backup, 'utf8')); expect(Object.keys(imported.files)).toHaveLength(1);
    // Close before the 400 ms debounce; the native close handshake must finish saving.
    await page.getByLabel('Менеджер', { exact: true }).fill('Сохранено перед закрытием');
    await close(app);
    app = await launch(); page = await app.firstWindow();
    await expect(page.getByText('Настольный проект', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Открыть', exact: true }).click();
    await page.getByRole('button', { name: /Проект/ }).first().click();
    await expect(page.getByLabel('Менеджер', { exact: true })).toHaveValue('Сохранено перед закрытием');
    await expect(page.getByText('Сохранено на компьютере', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await close(app).catch(() => app.close()); }
});
