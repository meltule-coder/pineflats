const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vps', {
  list: () => ipcRenderer.invoke('ssh:list'),
  get: (id) => ipcRenderer.invoke('ssh:get', id),
  save: (data) => ipcRenderer.invoke('ssh:save', data),
  delete: (id) => ipcRenderer.invoke('ssh:delete', id),
  test: (id) => ipcRenderer.invoke('ssh:test', id),
  command: (id) => ipcRenderer.invoke('ssh:command', id),
  copy: (text) => ipcRenderer.invoke('ssh:copy', text),
  copyPassword: (id) => ipcRenderer.invoke('ssh:copy-password', id),
  connect: (id) => ipcRenderer.invoke('ssh:connect', id),
  deploy: (id) => ipcRenderer.invoke('ssh:deploy', id),
  installGrok: (id) => ipcRenderer.invoke('ssh:install-grok', id),
  onDeployLog: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('ssh:deploy-log', listener);
    return () => ipcRenderer.removeListener('ssh:deploy-log', listener);
  },
  dataPath: () => ipcRenderer.invoke('ssh:data-path'),
  openDataFolder: () => ipcRenderer.invoke('ssh:open-data-folder'),
});

