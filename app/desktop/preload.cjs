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
});
