'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sveApi', Object.assign({
  appTestMode: !!process.env.SVGBIANJI_TEST,
  openSvgDialog: () => ipcRenderer.invoke('open-svg-dialog'),
  openImageDialog: () => ipcRenderer.invoke('open-image-dialog'),
  saveSvgDialog: (defaultName, content) => ipcRenderer.invoke('save-svg-dialog', { defaultName, content }),
  homeImportDialog: () => ipcRenderer.invoke('home-import-dialog'),
  workSave: (content, defaultName) => ipcRenderer.invoke('work-save', { content, defaultName }),
  workOpen: () => ipcRenderer.invoke('work-open'),
  histAnchorSave: (content) => ipcRenderer.invoke('hist-anchor-save', { content }),
  histAnchorList: () => ipcRenderer.invoke('hist-anchor-list'),
  histAnchorRead: (name) => ipcRenderer.invoke('hist-anchor-read', { name }),
  confirmCloseDoc: (name) => ipcRenderer.invoke('confirm-close-doc', { name }),
  appFlags: () => ipcRenderer.invoke('app-flags'),
  fileAutoSave: (kind, content, fileName) => ipcRenderer.invoke('file-auto-save', { kind, content, fileName }),
  fileSaveWork: (content, source) => ipcRenderer.invoke('file-save-work', { content, source }),
  settingsGet: () => ipcRenderer.invoke('settings-get'),
  settingsSet: (s) => ipcRenderer.invoke('settings-set', s),
  fileRecent: () => ipcRenderer.invoke('file-recent'),
  fileRead: (kind, name) => ipcRenderer.invoke('file-read', { kind, name }),
  svgThumbWarm: () => ipcRenderer.invoke('svg-thumb-warm'),
  svgThumbRender: text => ipcRenderer.invoke('svg-thumb-render', { text }),
  svgThumbFile: name => ipcRenderer.invoke('svg-thumb-file', { name }),
  fileSaveSvg: (name, content, sourceName) => ipcRenderer.invoke('file-save-svg', { name, content, sourceName }),
  fileRename: (kind, oldName, newName) => ipcRenderer.invoke('file-rename', { kind, oldName, newName }),
  fileDelete: (kind, name) => ipcRenderer.invoke('file-delete', { kind, name }),
  log: (level, msg, data) => ipcRenderer.send('sve-log', { level, msg, data }),
  logPath: () => ipcRenderer.invoke('sve-log-path'),
  logRead: (maxLen) => ipcRenderer.invoke('sve-log-read', { maxLen }),
  logSave: () => ipcRenderer.invoke('sve-log-save'),
  logOpen: () => ipcRenderer.invoke('sve-log-open'),
  windowControl: (action) => ipcRenderer.invoke('window-control', String(action || '')),
  windowStateGet: () => ipcRenderer.invoke('window-state-get'),
  onWindowState: (cb) => {
    if (typeof cb !== 'function') return function () { };
    const h = (_e, st) => { try { cb(st); } catch (err) { } };
    ipcRenderer.on('window-state', h);
    return function () { try { ipcRenderer.removeListener('window-state', h); } catch (err) { /* ignore */ } };
  }
}, (process.env.SVGBIANJI_TEST && typeof window !== 'undefined' && window.__SVE_STUB__) || {}));
