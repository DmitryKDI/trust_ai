const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { MAIN_URL, CSP, isAppUrl, isCompanyUrl, assetPath, pdfName } = require('./security.cjs');
const { createUpdateController } = require('./updates.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'trust', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }]);
app.setName('Траст ремонт — Планировщик');
app.setAppUserModelId('ru.trustremont.planner');
// Stable, per-user storage survives application upgrades and works without a browser profile.
app.setPath('userData', path.join(app.getPath('appData'), 'TrustRemontPlanner'));
// Test isolation is available only for unpackaged development launches.
if (!app.isPackaged && process.env.TRUST_DESKTOP_TEST_DATA) app.setPath('userData', path.resolve(process.env.TRUST_DESKTOP_TEST_DATA));
const gotLock = app.requestSingleInstanceLock();
let win, pendingClose, closing = false, allowClose = false, savingPdf = false, updateClosing = false;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
const trusted = event => win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && isAppUrl(event.senderFrame.url);
async function saveBeforeExit() {
  if (!win || win.isDestroyed() || pendingClose) return false;
  const requestId = randomUUID();
  const saved = await new Promise(resolve => {
    const timer = setTimeout(() => { pendingClose = null; resolve(false); }, 8000);
    pendingClose = { requestId, finish: value => { clearTimeout(timer); pendingClose = null; resolve(value); } };
    win.webContents.send('trust:prepare-close', requestId);
  });
  if (!saved) return false;
  try { await session.defaultSession.flushStorageData(); return true; } catch { return false; }
}

if (!gotLock) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(async () => {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    protocol.handle('trust', async request => {
      const file = assetPath(path.join(__dirname, '../dist'), request.url);
      if (!file || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
      try {
        const body = await fs.readFile(file);
        return new Response(request.method === 'HEAD' ? null : body, { headers: { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' } });
      } catch { return new Response('Not found', { status: 404 }); }
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.on('will-download', (_event, item, contents) => {
      if (!win || contents !== win.webContents) { item.cancel(); return; }
      item.setSaveDialogOptions({ title: 'Сохранить файл планировщика', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
    });
    win = new BrowserWindow({ width: 1440, height: 960, minWidth: 1024, minHeight: 700, show: false, backgroundColor: '#f4ece3', title: 'Траст ремонт — Планировщик', icon: path.join(__dirname, 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, devTools: !app.isPackaged } });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isCompanyUrl(url)) void shell.openExternal('https://trustremont.ru/').catch(() => {});
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', event => { if (!isAppUrl(event.url)) event.preventDefault(); });
    win.webContents.on('will-frame-navigate', event => { if (!isAppUrl(event.url)) event.preventDefault(); });
    win.webContents.on('will-attach-webview', event => event.preventDefault());
    win.webContents.on('will-prevent-unload', event => event.preventDefault()); // Native close handler below flushes autosave first.
    win.on('ready-to-show', () => win.show());
    win.on('close', async event => {
      if (allowClose) return;
      event.preventDefault();
      if (closing) return;
      closing = true;
      const saved = await saveBeforeExit();
      if (!saved) {
        const result = await dialog.showMessageBox(win, { type: 'warning', title: 'Проект ещё не сохранён', message: 'Не удалось завершить автосохранение.', detail: 'Вернитесь в проект и повторите сохранение или сохраните резервную копию.', buttons: ['Вернуться в проект', 'Закрыть без сохранения'], defaultId: 0, cancelId: 0 });
        if (result.response === 0) { closing = false; return; }
      }
      allowClose = true;
      if (!saved) await session.defaultSession.flushStorageData();
      win.close();
    });
    ipcMain.on('trust:close-ready', (event, value) => { if (pendingClose && trusted(event) && value?.requestId === pendingClose.requestId && typeof value.saved === 'boolean') pendingClose.finish(value.saved); });
    const updater = app.isPackaged && process.platform === 'win32' ? require('electron-updater').autoUpdater : null;
    const updates = createUpdateController({ updater, currentVersion: app.getVersion(),
      onState: state => {
        if (updateClosing && ['ready', 'error'].includes(state.status)) { allowClose = false; closing = false; updateClosing = false; }
        if (!win.isDestroyed()) win.webContents.send('trust:updates-state', state);
      },
      beforeInstall: async () => {
        if (closing || savingPdf) return false;
        closing = true; updateClosing = true;
        const saved = await saveBeforeExit();
        if (!saved) closing = false;
        return saved;
      },
      install: () => { allowClose = true; updater.quitAndInstall(true, true); },
    });
    for (const [channel, action] of [
      ['trust:updates-state', () => updates.getState()], ['trust:updates-check', () => updates.check()],
      ['trust:updates-download', () => updates.download()], ['trust:updates-install', () => updates.installUpdate()],
    ]) ipcMain.handle(channel, event => { if (!trusted(event)) throw new Error('Обновления недоступны.'); return action(); });
    ipcMain.handle('trust:save-pdf', async (event, name) => {
      if (!trusted(event) || savingPdf) throw new Error('Сохранение PDF недоступно.');
      savingPdf = true;
      try {
        const result = await dialog.showSaveDialog(win, { title: 'Сохранить КП в PDF', defaultPath: path.join(app.getPath('documents'), pdfName(name)), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
        if (result.canceled || !result.filePath) return false;
        const data = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: 'A4' });
        await fs.writeFile(result.filePath, data);
        return true;
      } catch { throw new Error('Не удалось записать PDF. Выберите другую папку и повторите.'); }
      finally { savingPdf = false; }
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Файл', submenu: [{ label: 'Выход', role: 'quit' }] },
      { label: 'Правка', submenu: [{ label: 'Вырезать', role: 'cut' }, { label: 'Копировать', role: 'copy' }, { label: 'Вставить', role: 'paste' }, { label: 'Выделить всё', role: 'selectAll' }] },
      { label: 'Вид', submenu: [{ label: 'Увеличить', role: 'zoomIn' }, { label: 'Уменьшить', role: 'zoomOut' }, { label: 'Обычный масштаб', role: 'resetZoom' }, { type: 'separator' }, { label: 'Полный экран', role: 'togglefullscreen' }] },
      { label: 'Справка', submenu: [{ label: 'Проверить обновления', click: () => { win.webContents.send('trust:updates-open'); void updates.check(); } }, { type: 'separator' }, { label: 'О программе', click: () => dialog.showMessageBox(win, { title: 'Траст ремонт — Планировщик', message: `Версия ${app.getVersion()}`, detail: 'Планы, проекты и обучение сохраняются на этом компьютере. Обновления загружаются из GitHub Releases. Для переноса из прежней версии экспортируйте проекты в JSON и импортируйте их здесь.' }) }] },
    ]));
    await win.loadURL(MAIN_URL);
    if (updater) setTimeout(() => { if (!win.isDestroyed() && updates.getState().status === 'idle') void updates.check(); }, 8000).unref();
  }).catch(error => { dialog.showErrorBox('Не удалось открыть планировщик', String(error.message ?? error)); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
}
