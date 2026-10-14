import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const { createUpdateController } = createRequire(import.meta.url)('../desktop/updates.cjs');

function setup() {
  const updater = Object.assign(new EventEmitter(), { checkForUpdates: vi.fn(), downloadUpdate: vi.fn() });
  const beforeInstall = vi.fn(async () => true), install = vi.fn(), onState = vi.fn();
  const controller = createUpdateController({ updater, currentVersion: '0.2.2', beforeInstall, install, onState });
  return { updater, beforeInstall, install, onState, controller };
}
describe('desktop updates', () => {
  it('never silently downloads, installs, accepts prereleases or downgrades', () => {
    const { updater, controller } = setup();
    expect(updater).toMatchObject({ autoDownload: false, autoInstallOnAppQuit: false, allowPrerelease: false, allowDowngrade: false, disableWebInstaller: true });
    expect(controller.getState()).toMatchObject({ currentVersion: '0.2.2', status: 'idle' });
  });
  it('coalesces concurrent checks; no update is a normal state', async () => {
    const { updater, controller } = setup();
    let finish!: () => void;
    updater.checkForUpdates.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const a = controller.check(), b = controller.check(); expect(a).toBe(b);
    await Promise.resolve(); expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    updater.emit('update-not-available'); finish(); await a;
    expect(controller.getState().status).toBe('current');
  });
  it('rejects install-before-download; progress is bounded and actions are serialized', async () => {
    const { updater, controller, install } = setup();
    await controller.installUpdate(); await controller.download(); expect(install).not.toHaveBeenCalled(); expect(updater.downloadUpdate).not.toHaveBeenCalled();
    updater.emit('update-available', { version: '0.2.3', releaseNotes: '<script>secret</script>', path: 'C:/private' });
    let finish!: () => void;
    updater.downloadUpdate.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const a = controller.download(), b = controller.download(); expect(a).toBe(b); await Promise.resolve();
    updater.emit('download-progress', { percent: 120 }); expect(controller.getState().percent).toBe(100);
    await controller.check(); expect(updater.checkForUpdates).not.toHaveBeenCalled();
    updater.emit('update-downloaded', { version: '0.2.3' }); finish(); await a;
    expect(controller.getState()).toEqual({ currentVersion: '0.2.2', enabled: true, status: 'ready', latestVersion: '0.2.3', percent: 100 });
  });
  it('a failed checksum cannot lead to installation, and a later check can recover', async () => {
    const { updater, controller, install } = setup();
    updater.emit('update-available', { version: '0.2.3' });
    updater.downloadUpdate.mockRejectedValue(Object.assign(new Error('secret URL'), { code: 'ERR_CHECKSUM_MISMATCH' }));
    await controller.download(); await controller.installUpdate();
    expect(controller.getState()).toMatchObject({ status: 'error', message: 'Файл обновления повреждён. Повторите скачивание.' });
    expect(install).not.toHaveBeenCalled();
    updater.checkForUpdates.mockImplementation(async () => updater.emit('update-not-available'));
    await controller.check(); expect(controller.getState().status).toBe('current');
  });
  it('waits for successful saving and never installs after a failed save', async () => {
    const { updater, controller, beforeInstall, install } = setup();
    updater.emit('update-downloaded', { version: '0.2.3' }); beforeInstall.mockResolvedValueOnce(false);
    await controller.installUpdate(); expect(install).not.toHaveBeenCalled(); expect(controller.getState().status).toBe('ready');
    let saved!: () => void;
    beforeInstall.mockImplementationOnce(() => new Promise<boolean>(resolve => { saved = () => resolve(true); }));
    const a = controller.installUpdate(), b = controller.installUpdate(); expect(a).toBe(b); await Promise.resolve(); expect(install).not.toHaveBeenCalled();
    saved(); await a; expect(install).toHaveBeenCalledTimes(1);
  });
  it('offers retry without exposing native paths when the installer cannot start', async () => {
    const { updater, controller, install } = setup();
    updater.emit('update-downloaded', { version: '0.2.3' });
    install.mockImplementationOnce(() => updater.emit('error', new Error('C:/private/cache.exe')));
    await controller.installUpdate(); expect(controller.getState().status).toBe('ready'); expect(controller.getState().message).not.toContain('private');
    await controller.installUpdate(); expect(install).toHaveBeenCalledTimes(2);
  });
  it('disables native updates in a browser or unpackaged development launch', async () => {
    const controller = createUpdateController({ updater: null, currentVersion: '0.2.2' });
    await controller.check(); await controller.download(); await controller.installUpdate();
    expect(controller.getState()).toEqual({ currentVersion: '0.2.2', status: 'idle', enabled: false });
  });
});
