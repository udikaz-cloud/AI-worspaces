const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeCode', {
  getFolder: () => ipcRenderer.invoke('claude-code:get-folder'),
  pickFolder: () => ipcRenderer.invoke('claude-code:pick-folder'),
  start: (options) => ipcRenderer.invoke('claude-code:start', options),
  write: (id, data) => ipcRenderer.send('claude-code:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('claude-code:resize', id, cols, rows),
  stop: (id) => ipcRenderer.send('claude-code:stop', id),
  onData: (callback) => ipcRenderer.on('claude-code:data', (_event, id, data) => callback(id, data)),
  onExit: (callback) => ipcRenderer.on('claude-code:exit', (_event, id, exitCode) => callback(id, exitCode))
});

contextBridge.exposeInMainWorld('localSession', {
  start: (folder) => ipcRenderer.invoke('local-session:start', folder),
  stop: () => ipcRenderer.invoke('local-session:stop'),
  onStatus: (callback) => ipcRenderer.on('local-session:status', (_event, status) => callback(status))
});
