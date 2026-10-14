const { contextBridge, ipcRenderer } = require('electron');
const closeHandlers = new Set();
ipcRenderer.on('trust:prepare-close', async (_event, requestId) => {
  let saved = true;
  try { await Promise.all([...closeHandlers].map(handler => handler())); } catch { saved = false; }
  ipcRenderer.send('trust:close-ready', { requestId, saved });
});
contextBridge.exposeInMainWorld('trustDesktop', {
  savePdf: name => ipcRenderer.invoke('trust:save-pdf', name),
  onBeforeClose: handler => { closeHandlers.add(handler); return () => closeHandlers.delete(handler); },
  getUpdateState: () => ipcRenderer.invoke('trust:updates-state'),
  checkUpdates: () => ipcRenderer.invoke('trust:updates-check'),
  downloadUpdate: () => ipcRenderer.invoke('trust:updates-download'),
  installUpdate: () => ipcRenderer.invoke('trust:updates-install'),
  onUpdateState: handler => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('trust:updates-state', listener);
    return () => ipcRenderer.removeListener('trust:updates-state', listener);
  },
  onUpdatePanel: handler => {
    const listener = () => handler();
    ipcRenderer.on('trust:updates-open', listener);
    return () => ipcRenderer.removeListener('trust:updates-open', listener);
  },
});
