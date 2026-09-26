'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sveApi', Object.assign({
  /* 测试模式同步标志（多标签在测试模式保持单文档行为） */
  appTestMode: !!process.env.SVGBIANJI_TEST,
  openSvgDialog: () => ipcRenderer.invoke('open-svg-dialog'),
  openImageDialog: () => ipcRenderer.invoke('open-image-dialog'),
  saveSvgDialog: (defaultName, content) => ipcRenderer.invoke('save-svg-dialog', { defaultName, content }),
  /* 主页「导入」：选文件并复制进 SVGImages 目录 */
  homeImportDialog: () => ipcRenderer.invoke('home-import-dialog'),
  /* 工作副本 */
  workSave: (content, defaultName) => ipcRenderer.invoke('work-save', { content, defaultName }),
  workOpen: () => ipcRenderer.invoke('work-open'),
  /* 历史工作锚点 */
  histAnchorSave: (content) => ipcRenderer.invoke('hist-anchor-save', { content }),
  histAnchorList: () => ipcRenderer.invoke('hist-anchor-list'),
  histAnchorRead: (name) => ipcRenderer.invoke('hist-anchor-read', { name }),
  /* 关闭确认(标签页/软件共用同一原生窗):返回 {action:'save'|'dont'|'cancel'} */
  confirmCloseDoc: (name) => ipcRenderer.invoke('confirm-close-doc', { name }),
  /* 首页：自动目录（工作副本/SVG图像）与最近列表 */
  appFlags: () => ipcRenderer.invoke('app-flags'),
  fileAutoSave: (kind, content, fileName) => ipcRenderer.invoke('file-auto-save', { kind, content, fileName }),
  fileSaveWork: (content, source) => ipcRenderer.invoke('file-save-work', { content, source }),
  /* 用户设置（语言/主题）：落 userData/settings.json */
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
  /* 日志 */
  log: (level, msg, data) => ipcRenderer.send('sve-log', { level, msg, data }),
  logPath: () => ipcRenderer.invoke('sve-log-path'),
  logRead: (maxLen) => ipcRenderer.invoke('sve-log-read', { maxLen }),
  logSave: () => ipcRenderer.invoke('sve-log-save'),
  logOpen: () => ipcRenderer.invoke('sve-log-open'),
  /* 自绘标题栏（UI 改良 C 项）。只暴露三个**固定动作**，不转发任意 IPC 通道、
     不暴露 Node/Electron 对象；主进程侧还会用窗口白名单再校验一次。
     event 名固定 'window-state'，订阅函数返回**解除订阅**的闭包，
     避免反复建标签页/重载时累积监听。 */
  windowControl: (action) => ipcRenderer.invoke('window-control', String(action || '')),
  windowStateGet: () => ipcRenderer.invoke('window-state-get'),
  onWindowState: (cb) => {
    if (typeof cb !== 'function') return function () { };
    const h = (_e, st) => { try { cb(st); } catch (err) { /* 回调内异常不应打断 IPC */ } };
    ipcRenderer.on('window-state', h);
    return function () { try { ipcRenderer.removeListener('window-state', h); } catch (err) { /* ignore */ } };
  }
}, (process.env.SVGBIANJI_TEST && typeof window !== 'undefined' && window.__SVE_STUB__) || {}));
