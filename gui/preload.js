'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ghostframe', {
  // app
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  openProfilesDir: () => ipcRenderer.invoke('shell:openProfilesDir'),

  // profiles
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  getProfile: (id) => ipcRenderer.invoke('profiles:get', id),
  deleteProfile: (id) => ipcRenderer.invoke('profiles:delete', id),
  launchProfile: (id) => ipcRenderer.invoke('profiles:launch', id),
  readFingerprint: (id) => ipcRenderer.invoke('profiles:fingerprint', id),
  createProfile: (data) => ipcRenderer.invoke('profiles:create', data),

  // events
  onFingerprintProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('fingerprint:progress', handler);
    return () => ipcRenderer.removeListener('fingerprint:progress', handler);
  },
});
