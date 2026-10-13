// The renderer can request actions, never choose a feed, installer or command.
function createUpdateController({ updater, currentVersion, onState = () => {}, beforeInstall, install }) {
  let state = { status: 'idle', enabled: !!updater, currentVersion };
  let checking, downloading, installing;
  let downloaded = false;
  const send = value => { state = { ...value, enabled: !!updater, currentVersion }; onState({ ...state }); };
  const error = failure => send({ status: 'error', latestVersion: state.latestVersion, message: failure?.code === 'ERR_CHECKSUM_MISMATCH' ? 'Файл обновления повреждён. Повторите скачивание.' : 'Не удалось получить обновление. Проверьте интернет и повторите попытку.' });
  if (updater) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    // Full downloads avoid dependence on expired blockmaps of previous releases.
    updater.disableDifferentialDownload = true;
    updater.disableWebInstaller = true;
    updater.logger = null;
    updater.on('update-available', info => send({ status: 'available', latestVersion: info.version }));
    updater.on('update-not-available', () => send({ status: 'current' }));
    updater.on('download-progress', progress => {
      const percent = Number.isFinite(progress.percent) ? Math.min(100, Math.max(0, Math.round(progress.percent))) : 0;
      send({ status: 'downloading', latestVersion: state.latestVersion, percent });
    });
    updater.on('update-downloaded', info => { downloaded = true; send({ status: 'ready', latestVersion: info.version, percent: 100 }); });
    updater.on('error', failure => {
      if (downloaded) send({ status: 'ready', latestVersion: state.latestVersion, message: 'Не удалось запустить установку. Повторите попытку.' });
      else error(failure);
    });
  }
  const getState = () => ({ ...state });
  function check() {
    if (!updater || downloading || installing || downloaded) return Promise.resolve(getState());
    if (checking) return checking;
    send({ status: 'checking' });
    checking = Promise.resolve().then(() => updater.checkForUpdates()).catch(error).then(getState).finally(() => { checking = null; });
    return checking;
  }
  function download() {
    if (downloading) return downloading;
    if (!updater || checking || installing || downloaded || !state.latestVersion || !['available', 'error'].includes(state.status)) return Promise.resolve(getState());
    send({ status: 'downloading', latestVersion: state.latestVersion, percent: 0 });
    downloading = Promise.resolve().then(() => updater.downloadUpdate()).catch(error).then(getState).finally(() => { downloading = null; });
    return downloading;
  }
  function installUpdate() {
    if (installing) return installing;
    if (!updater || !downloaded || state.status !== 'ready') return Promise.resolve(getState());
    send({ status: 'installing', latestVersion: state.latestVersion });
    installing = Promise.resolve().then(async () => {
      if (!await beforeInstall()) {
        send({ status: 'ready', latestVersion: state.latestVersion, message: 'Установка отложена: проект не удалось сохранить. Сохраните его и повторите.' });
        return;
      }
      install();
    }).catch(() => send({ status: 'ready', latestVersion: state.latestVersion, message: 'Не удалось подготовить установку. Повторите попытку.' })).then(getState).finally(() => { installing = null; });
    return installing;
  }
  return { getState, check, download, installUpdate };
}
module.exports = { createUpdateController };
