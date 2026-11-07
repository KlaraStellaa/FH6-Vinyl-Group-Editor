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
  
  forzaAccounts: () => ipcRenderer.invoke('forza-accounts'),
  forzaGroups: (containersRoot) => ipcRenderer.invoke('forza-groups', { containersRoot }),
  forzaThumb: (path) => ipcRenderer.invoke('forza-thumb', { path }),
  forzaThumbWrite: (path, dataUrl) => ipcRenderer.invoke('forza-thumb-write', { path, dataUrl }),
  
  confirmCloseDoc: (name) => ipcRenderer.invoke('confirm-close-doc', { name }),
  forzaInject: (cgroup, header, model) => ipcRenderer.invoke('forza-inject', { cgroup, header, model }),
  forzaExport: (cgroup, header) => ipcRenderer.invoke('forza-export', { cgroup, header }),
  forzaBackup: (uDir) => ipcRenderer.invoke('forza-backup', { uDir }),
  
  undoSave: (payload) => ipcRenderer.invoke('undo-save', payload),
  undoList: () => ipcRenderer.invoke('undo-list'),
  undoRead: (id) => ipcRenderer.invoke('undo-read', { id }),
  undoReadModel: (id, index) => ipcRenderer.invoke('undo-read-model', { id, index }),
  undoRestore: (id) => ipcRenderer.invoke('undo-restore', { id }),
  
  appFlags: () => ipcRenderer.invoke('app-flags'),
  fileAutoSave: (kind, content, fileName) => ipcRenderer.invoke('file-auto-save', { kind, content, fileName }),
  fileSaveWork: (content, source) => ipcRenderer.invoke('file-save-work', { content, source }),
  
  settingsGet: () => ipcRenderer.invoke('settings-get'),
  settingsSet: (s) => ipcRenderer.invoke('settings-set', s),
  
  updateInstall: (payload) => ipcRenderer.invoke('update-install', payload || {}),
  
  updatePickExe: (arg) => ipcRenderer.invoke('update-pick-exe', arg || {}),   
  
  homeOpenFolder: () => ipcRenderer.invoke('home-open-folder'),
  
  updateOpenRepo: () => ipcRenderer.invoke('update-open-repo'),
  onUpdateAvailable: (cb) => {
    if (typeof cb !== 'function') return function () { };
    const h = (_e, info) => { try { cb(info); } catch (err) {  } };
    ipcRenderer.on('update-available', h);
    return function () { try { ipcRenderer.removeListener('update-available', h); } catch (err) {  } };
  },
  onUpdateProgress: (cb) => {
    if (typeof cb !== 'function') return function () { };
    const h = (_e, pr) => { try { cb(pr); } catch (err) {  } };
    ipcRenderer.on('update-progress', h);
    return function () { try { ipcRenderer.removeListener('update-progress', h); } catch (err) {  } };
  },
  
  fontImport: () => ipcRenderer.invoke('font-import'),
  fontDelete: (file) => ipcRenderer.invoke('font-delete', { file }),
  fontOpenDownload: () => ipcRenderer.invoke('font-open-download'),
  fileRecent: () => ipcRenderer.invoke('file-recent'),
  fileRead: (kind, name) => ipcRenderer.invoke('file-read', { kind, name }),
  svgThumbWarm: () => ipcRenderer.invoke('svg-thumb-warm'),
  svgThumbRender: text => ipcRenderer.invoke('svg-thumb-render', { text }),
  
  svgThumbRenderCached: (text, cacheNs, cacheIdentity) =>
    ipcRenderer.invoke('svg-thumb-render', { text, cacheNs, cacheIdentity }),
  svgThumbFile: name => ipcRenderer.invoke('svg-thumb-file', { name }),
  
  libAssetVer: () => ipcRenderer.invoke('lib-asset-ver'),
  
  thumbCacheGet: (ns, keys) => ipcRenderer.invoke('svg-thumb-cache-get', { ns, keys }),
  thumbCachePut: (ns, key, dataUrl) => ipcRenderer.invoke('svg-thumb-cache-put', { ns, key, dataUrl }),
  thumbCacheDrop: (ns, keys) => ipcRenderer.invoke('svg-thumb-cache-drop', { ns, keys }),
  fileSaveSvg: (name, content, sourceName) => ipcRenderer.invoke('file-save-svg', { name, content, sourceName }),
  fileRename: (kind, oldName, newName) => ipcRenderer.invoke('file-rename', { kind, oldName, newName }),
  fileDelete: (kind, name) => ipcRenderer.invoke('file-delete', { kind, name }),
  
  log: (level, msg, data) => ipcRenderer.send('sve-log', { level, msg, data }),
  logPath: () => ipcRenderer.invoke('sve-log-path'),
  
  logRead: (arg) => ipcRenderer.invoke('sve-log-read',
    (arg && typeof arg === 'object') ? arg : { maxLen: arg }),
  logFlush: () => ipcRenderer.invoke('sve-log-flush'),
  logSave: () => ipcRenderer.invoke('sve-log-save'),
  logOpen: () => ipcRenderer.invoke('sve-log-open'),
  
  windowControl: (action) => ipcRenderer.invoke('window-control', String(action || '')),
  windowStateGet: () => ipcRenderer.invoke('window-state-get'),
  onWindowState: (cb) => {
    if (typeof cb !== 'function') return function () { };
    const h = (_e, st) => { try { cb(st); } catch (err) {  } };
    ipcRenderer.on('window-state', h);
    return function () { try { ipcRenderer.removeListener('window-state', h); } catch (err) {  } };
  }
}, (process.env.SVGBIANJI_TEST && typeof window !== 'undefined' && window.__SVE_STUB__) || {}));
