import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';
import { newProject } from '../src/model/defaults';
import { twoRoom } from '../tests/fixtures/synthetic';
import { geometryHash } from '../src/geometry/plan';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractFile } from '@electron/asar';
import { getCurrentFuseWire, FuseV1Options } from '@electron/fuses';

const execute = promisify(execFile);

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
    const project = newProject({ alias: 'Настольный проект', city: 'Москва', manager: 'До правки', date: '2026-10-11' });
    project.geometry = twoRoom(); const hash = geometryHash(project.geometry); project.geometry.approvedHash = hash;
    project.variants = ['space', 'storage', 'family'].map((scenario, i) => ({ id: `native-v${i}`, scenario: scenario as 'space' | 'storage' | 'family', title: ['Пространство', 'Хранение', 'Семейный'][i], idea: 'Проверка настольной версии', geometryHash: hash,
      items: [{ id: `sofa${i}`, type: 'sofa' as const, x: 7000 + i * 250, y: 2200, w: 2200, d: 950, rot: 0 as const, roomId: project.geometry.rooms[1].id, ruleId: null, movedByManager: true }], benefits: [], compromises: [], assumptions: [], changes: [], issues: [], metrics: {}, approved: i === 0, editedByManager: false }));
    project.selectedVariantId = project.variants[0].id;
    await page.locator('input[type=file]').setInputFiles({ name: 'previous-version.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'trust-planner-project', version: 1, project, files: {} })) });
    await page.getByRole('button', { name: /Для клиента/ }).first().click();
    await expect(page.locator('[data-client-3d]')).toHaveCount(3);
    await app.evaluate(({ shell }) => {
      (globalThis as any).__companyLinks = [];
      shell.openExternal = async url => { (globalThis as any).__companyLinks.push(url); };
    });
    await page.getByRole('link', { name: 'Обсудить ремонт', exact: true }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as any).__companyLinks)).toEqual(['https://trustremont.ru/']);
    expect(page.url()).toBe('trust://planner/');
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
    // Electron cancels navigation before commit; check its authoritative URL rather
    // than waiting for a Playwright navigation event that was intentionally denied.
    await page.evaluate(() => { window.open('https://example.com'); window.location.assign('https://example.com'); });
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getURL())).toBe('trust://planner/');
    expect((await app.windows()).length).toBe(1);
    expect(errors).toEqual([]);
  } finally { await close(app).catch(() => app.close()); }
});

test('packaged security: CSP, blocked network, foreign IPC and archive tampering', async ({}, info) => {
  test.setTimeout(180_000);
  const wire = await getCurrentFuseWire(exe);
  for (const option of [FuseV1Options.RunAsNode, FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseV1Options.GrantFileProtocolExtraPrivileges]) expect(wire[option]).toBe(48);
  for (const option of [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseV1Options.OnlyLoadAppFromAsar]) expect(wire[option]).toBe(49);
  const app = await launch();
  const server = createServer((_req, response) => { requests++; response.end('private'); });
  let requests = 0;
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
    const blocked = await page.evaluate(async url => {
      const script = document.createElement('script'); script.textContent = 'window.inlineAttackRan=true'; document.body.append(script);
      const image = document.createElement('img'); image.setAttribute('onerror', 'window.imageAttackRan=true');
      const errorEvent = new Promise<void>(resolve => image.addEventListener('error', () => resolve())); image.src = 'data:image/png;base64,AAAA'; document.body.append(image);
      const remote = new Image(); const deniedImage = new Promise<boolean>(resolve => { remote.onerror = () => resolve(true); remote.onload = () => resolve(false); }); remote.src = url;
      let deniedFetch = false; try { await fetch(url); } catch { deniedFetch = true; }
      const imageBlocked = await deniedImage;
      await errorEvent;
      return { deniedFetch, imageBlocked, inline: (window as any).inlineAttackRan, handler: (window as any).imageAttackRan, require: typeof (window as any).require, process: typeof (window as any).process };
    }, `http://127.0.0.1:${port}/client-data`);
    expect(blocked).toEqual({ deniedFetch: true, imageBlocked: true, inline: undefined, handler: undefined, require: 'undefined', process: 'undefined' });
    expect(requests).toBe(0);
    const rejected = await app.evaluate(async ({ BrowserWindow }, url) => {
      const foreign = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } });
      try {
        await foreign.loadURL('data:text/html,<p>Untrusted security fixture</p>');
        return await foreign.webContents.executeJavaScript(`(async () => { const ipc = await Promise.all(['trust:updates-state','trust:updates-download','trust:updates-install','trust:save-pdf'].map(channel => require('electron').ipcRenderer.invoke(channel, 'probe').then(() => false, () => true))); let blocked = false; try { await fetch(${JSON.stringify(url)}); } catch { blocked = true; } return { ipc, blocked }; })()`);
      } finally { foreign.destroy(); }
    }, `http://127.0.0.1:${port}/without-csp`);
    expect(rejected).toEqual({ ipc: [true, true, true, true], blocked: true }); expect(requests).toBe(0);
    await page.evaluate(() => window.location.assign('trust://planner/assets/not-an-app.js'));
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getURL())).toBe('trust://planner/');
  } finally {
    await close(app).catch(() => app.close()); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
  // Modify only a disposable copy; the published EXE and original archive stay intact.
  const copy = path.join(tmpdir(), `trust-tamper-${randomUUID()}`);
  await fs.cp(path.dirname(exe), copy, { recursive: true });
  try {
    const marker = path.join(copy, 'injected-code-ran.txt'), poison = path.join(copy, 'poison.cjs');
    const payload = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'injected')`;
    await fs.writeFile(poison, payload);
    const injection = await execute(path.join(copy, 'TrustRemontPlanner.exe'), ['--no-error-dialogs', '-e', payload], {
      timeout: 6000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: `--require="${poison}"` },
    }).then(() => ({ killed: false }), e => ({ killed: !!e.killed }));
    expect(injection.killed).toBe(true); // Normal GUI kept running instead of evaluating -e.
    expect(await fs.access(marker).then(() => true, () => false)).toBe(false);
    const archive = path.join(copy, 'resources/app.asar'), original = await fs.readFile(archive);
    const main = extractFile(archive, 'desktop/main.cjs'), offset = original.indexOf(main);
    expect(offset).toBeGreaterThan(0);
    const tampered = Buffer.from(original); tampered[offset] = tampered[offset] === 99 ? 100 : 99;
    await fs.writeFile(archive, tampered);
    const result = await execute(path.join(copy, 'TrustRemontPlanner.exe'), ['--no-error-dialogs'], { timeout: 20_000 }).then(() => ({ output: '', failed: false }), e => ({ output: String(e.stdout ?? '') + String(e.stderr ?? ''), failed: true }));
    expect(result.failed).toBe(true); expect(result.output).toMatch(/integrity/i);
    const report = info.outputPath('tamper-check.txt'); await fs.mkdir(path.dirname(report), { recursive: true }); await fs.writeFile(report, result.output);
  } finally { await fs.rm(copy, { recursive: true, force: true }); }
});

test('installed Windows app: bad checksum is rejected; real update preserves the last edit and launches the new version', async () => {
  test.setTimeout(300_000);
  const current = JSON.parse(await fs.readFile('package.json', 'utf8')).version;
  const [major, minor, patch] = current.split('.').map(Number), next = `${major}.${minor}.${patch + 1}`;
  const installDir = path.join(tmpdir(), `trust-update-${randomUUID()}`);
  await execute(path.resolve(`release/TrustRemontPlanner-Setup-${current}.exe`), ['/S', `/D=${installDir}`], { timeout: 120_000 });
  const installedExe = path.join(installDir, 'TrustRemontPlanner.exe');
  await expect.poll(async () => { try { return (await fs.stat(installedExe)).isFile(); } catch { return false; } }, { timeout: 60_000 }).toBe(true);
  const fixture = path.resolve(`release-update-fixture/TrustRemontPlanner-Setup-${next}.exe`);
  const bytes = await fs.readFile(fixture), sha512 = createHash('sha512').update(bytes).digest('base64');
  const filename = path.basename(fixture);
  let corrupt = true, metadataRequests = 0, installerRequests = 0;
  const server = createServer((request, response) => {
    const pathname = new URL(request.url!, 'http://localhost').pathname;
    if (pathname === '/latest.yml') {
      metadataRequests++;
      const digest = corrupt ? Buffer.alloc(64).toString('base64') : sha512;
      response.writeHead(200, { 'Content-Type': 'text/yaml', 'Cache-Control': 'no-store' });
      response.end(`version: ${next}\nfiles:\n  - url: ${filename}\n    sha512: ${digest}\n    size: ${bytes.length}\npath: ${filename}\nsha512: ${digest}\nreleaseDate: '2026-10-13T00:00:00.000Z'\n`);
    } else if (pathname === `/${filename}`) {
      installerRequests++;
      response.writeHead(200, { 'Content-Length': bytes.length, 'Content-Type': 'application/octet-stream' });
      createReadStream(fixture).pipe(response);
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  let app: ElectronApplication | undefined;
  const installedLaunch = () => electron.launch({ executablePath: installedExe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], timeout: 60_000 });
  try {
    app = await installedLaunch(); let page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Проекты', exact: true })).toBeVisible();
    // The test controls the privileged main process. Production IPC has no feed setter.
    await app.evaluate(({ app }, url) => {
      const nativeRequire = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      const updater = nativeRequire('electron-updater').autoUpdater;
      updater.setFeedURL({ provider: 'generic', url });
    }, `http://127.0.0.1:${address.port}/`);
    const panel = page.getByLabel('Обновления программы', { exact: true });
    await panel.getByRole('button', { name: /^Обновления ·/ }).click();
    await panel.getByRole('button', { name: 'Проверить обновления', exact: true }).click();
    await expect(panel.locator('[data-update-status]')).toHaveAttribute('data-update-status', 'available');
    await panel.getByRole('button', { name: 'Скачать обновление', exact: true }).click();
    await expect(panel.locator('[data-update-status]')).toHaveAttribute('data-update-status', 'error', { timeout: 60_000 });
    await expect(panel).toContainText('Файл обновления повреждён');
    await expect(panel.getByRole('button', { name: 'Установить и перезапустить' })).toHaveCount(0);
    corrupt = false;
    await panel.getByRole('button', { name: 'Проверить обновления', exact: true }).click();
    await expect(panel.locator('[data-update-status]')).toHaveAttribute('data-update-status', 'available');
    await panel.getByRole('button', { name: 'Скачать обновление', exact: true }).click();
    await expect(panel.locator('[data-update-status]')).toHaveAttribute('data-update-status', 'ready', { timeout: 60_000 });
    expect(metadataRequests).toBeGreaterThanOrEqual(2); expect(installerRequests).toBe(2);
    const project = newProject({ alias: 'Проект после обновления', city: 'Москва', manager: 'До обновления', date: '2026-10-13' });
    await page.locator('input[type=file]').setInputFiles({ name: 'update-project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'trust-planner-project', version: 1, project, files: {} })) });
    // Import is asynchronous; the home form also has a manager field.
    // Wait for the actual project before making the edit that must survive.
    await expect(page.getByRole('heading', { name: 'О проекте', exact: true })).toBeVisible();
    await expect(page.getByLabel('Менеджер', { exact: true })).toHaveValue('До обновления');
    await page.getByLabel('Менеджер', { exact: true }).fill('Последняя правка перед обновлением');
    const exited = new Promise(resolve => app!.process().once('exit', resolve));
    await panel.getByRole('button', { name: 'Установить и перезапустить', exact: true }).click();
    await exited; app = undefined;
    await expect.poll(() => {
      try { return JSON.parse(extractFile(path.join(installDir, 'resources/app.asar'), 'package.json').toString()).version; } catch { return ''; }
    }, { timeout: 120_000 }).toBe(next);
    // The updater launches the application normally; stop that CI-owned instance
    // and attach Playwright to a fresh launch to inspect the preserved project.
    await expect.poll(async () => {
      try { const result = await execute('tasklist', ['/FI', 'IMAGENAME eq TrustRemontPlanner.exe', '/FO', 'CSV']); return result.stdout.includes('TrustRemontPlanner.exe'); } catch { return false; }
    }, { timeout: 60_000 }).toBe(true);
    await execute('taskkill', ['/F', '/IM', 'TrustRemontPlanner.exe']);
    app = await installedLaunch(); page = await app.firstWindow();
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe(next);
    await page.locator('.prow').filter({ hasText: project.alias }).getByRole('button', { name: 'Открыть', exact: true }).click();
    await expect(page.getByLabel('Менеджер', { exact: true })).toHaveValue('Последняя правка перед обновлением');
    expect(await page.evaluate(() => Object.keys(window.trustDesktop!))).not.toContain('setFeedURL');
  } finally {
    if (app) await close(app).catch(() => app!.close());
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(installDir, { recursive: true, force: true }).catch(() => {});
  }
});
