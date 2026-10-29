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
  /* Forza 游戏存档（Inkscape2Forza 整合） */
  forzaAccounts: () => ipcRenderer.invoke('forza-accounts'),
  forzaGroups: (containersRoot) => ipcRenderer.invoke('forza-groups', { containersRoot }),
  forzaThumb: (path) => ipcRenderer.invoke('forza-thumb', { path }),
  forzaThumbWrite: (path, dataUrl) => ipcRenderer.invoke('forza-thumb-write', { path, dataUrl }),
  /* 关闭确认(标签页/软件共用同一原生窗):返回 {action:'save'|'dont'|'cancel'} */
  confirmCloseDoc: (name) => ipcRenderer.invoke('confirm-close-doc', { name }),
  forzaInject: (cgroup, header, model) => ipcRenderer.invoke('forza-inject', { cgroup, header, model }),
  forzaExport: (cgroup, header) => ipcRenderer.invoke('forza-export', { cgroup, header }),
  forzaBackup: (uDir) => ipcRenderer.invoke('forza-backup', { uDir }),
  /* 注入撤销备份（最近 3 次注入前被覆盖的分组原文件，落在 InjectUndo 目录） */
  undoSave: (payload) => ipcRenderer.invoke('undo-save', payload),
  undoList: () => ipcRenderer.invoke('undo-list'),
  undoRead: (id) => ipcRenderer.invoke('undo-read', { id }),
  undoReadModel: (id, index) => ipcRenderer.invoke('undo-read-model', { id, index }),
  undoRestore: (id) => ipcRenderer.invoke('undo-restore', { id }),
  /* 首页：自动目录（工作副本/SVG图像）与最近列表 */
  appFlags: () => ipcRenderer.invoke('app-flags'),
  fileAutoSave: (kind, content, fileName) => ipcRenderer.invoke('file-auto-save', { kind, content, fileName }),
  fileSaveWork: (content, source) => ipcRenderer.invoke('file-save-work', { content, source }),
  /* 用户设置（语言/主题/速率/收藏）：落 exe 旁的 settings.json（见 main.js settingsPath） */
  settingsGet: () => ipcRenderer.invoke('settings-get'),
  settingsSet: (s) => ipcRenderer.invoke('settings-set', s),
  /* 自动更新：窗口里点「更新」→ 主进程下载 exe 覆盖自己并重启 */
  updateInstall: (payload) => ipcRenderer.invoke('update-install', payload || {}),
  /* 更新失败时自动打开 GitHub 仓库（地址由主进程从 package.json 的 repository 解析） */
  updateOpenRepo: () => ipcRenderer.invoke('update-open-repo'),
  onUpdateAvailable: (cb) => {
    if (typeof cb !== 'function') return function () { };
    const h = (_e, info) => { try { cb(info); } catch (err) { /* ignore */ } };
    ipcRenderer.on('update-available', h);
    return function () { try { ipcRenderer.removeListener('update-available', h); } catch (err) { /* ignore */ } };
  },
  onUpdateProgress: (cb) => {
    if (typeof cb !== 'function') return function () { };
    const h = (_e, pr) => { try { cb(pr); } catch (err) { /* ignore */ } };
    ipcRenderer.on('update-progress', h);
    return function () { try { ipcRenderer.removeListener('update-progress', h); } catch (err) { /* ignore */ } };
  },
  /* 界面字体：导入（选文件→复制进数据目录）/ 删除副本 / 打开下载站点 */
  fontImport: () => ipcRenderer.invoke('font-import'),
  fontDelete: (file) => ipcRenderer.invoke('font-delete', { file }),
  fontOpenDownload: () => ipcRenderer.invoke('font-open-download'),
  fileRecent: () => ipcRenderer.invoke('file-recent'),
  fileRead: (kind, name) => ipcRenderer.invoke('file-read', { kind, name }),
  svgThumbWarm: () => ipcRenderer.invoke('svg-thumb-warm'),
  svgThumbRender: text => ipcRenderer.invoke('svg-thumb-render', { text }),
  /* 工作进程卡/锚点卡：内容在内存里，源文件身份用「name\0mtime」表达；
     主进程按身份串算 sha1 当缓存 key，命中直接回图，不必每次启动重新光栅化。 */
  svgThumbRenderCached: (text, cacheNs, cacheIdentity) =>
    ipcRenderer.invoke('svg-thumb-render', { text, cacheNs, cacheIdentity }),
  svgThumbFile: name => ipcRenderer.invoke('svg-thumb-file', { name }),
  /* 素材文件版本（彩绘纹饰缩略图缓存的失效依据） */
  libAssetVer: () => ipcRenderer.invoke('lib-asset-ver'),
  /* 通用缩略图磁盘缓存（彩绘纹饰面板） */
  thumbCacheGet: (ns, keys) => ipcRenderer.invoke('svg-thumb-cache-get', { ns, keys }),
  thumbCachePut: (ns, key, dataUrl) => ipcRenderer.invoke('svg-thumb-cache-put', { ns, key, dataUrl }),
  thumbCacheDrop: (ns, keys) => ipcRenderer.invoke('svg-thumb-cache-drop', { ns, keys }),
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
