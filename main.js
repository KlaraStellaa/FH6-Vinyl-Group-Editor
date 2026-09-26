'use strict';
const { app, BrowserWindow, protocol, net, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { pathToFileURL } = require('url');
const { resolveAutoSaveName } = require('./auto-name');
const { WorkcopyStore, atomicWrite } = require('./workcopy-store');
const workcopyStore = new WorkcopyStore();
const DLG = require('./dlg-i18n');

function uiLang() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
    return DLG.dicts[s && s.lang] ? s.lang : 'zh-CN';
  } catch (e) { return 'zh-CN'; }
}
function dt(key, params) { return DLG.get(uiLang(), key, params); }
const NAME_I18N = require('./js/name-i18n');
function nt(key, params) { return NAME_I18N.get(uiLang(), key, params); }

const ISOLATE = process.env.SVGBIANJI_ISOLATE === '1';
if (ISOLATE) {
  const isoDir = process.env.SVGBIANJI_ISOLATE_DIR || path.join(os.tmpdir(), 'groupfh6-cdp-' + process.pid);
  app.setPath('userData', isoDir);
} else {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    });
  }
}

app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-zero-copy');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

let forceClose = false;

let thumbRendererWin = null;
let thumbRendererReady = null;
let thumbRenderSeq = 0;
let thumbRenderTail = Promise.resolve();
const thumbRenderJobs = new Map();
const thumbFileInflight = new Map();
const thumbCachePublicUrl = key => 'app://thumb-cache/' + key + '.png';
let mainRendererPid = 0;
let thumbPriorityApplied = false;

function prioritizeThumbWork() {
  if (thumbPriorityApplied || !thumbRendererWin || thumbRendererWin.isDestroyed()) return;
  thumbPriorityApplied = true;
  try {
    if (mainRendererPid) os.setPriority(mainRendererPid, os.constants.priority.PRIORITY_ABOVE_NORMAL);
    os.setPriority(thumbRendererWin.webContents.getOSProcessId(), os.constants.priority.PRIORITY_LOW);
  } catch (err) {
    console.warn('[thumb-worker] 设置进程优先级失败', String(err && err.message || err).slice(0, 160));
  }
}

function rejectThumbRenderJobs(reason) {
  const err = reason instanceof Error ? reason : new Error(String(reason || '缩略图进程已关闭'));
  thumbRenderJobs.forEach(job => { clearTimeout(job.timer); job.reject(err); });
  thumbRenderJobs.clear();
}

function destroyThumbRenderer() {
  const win = thumbRendererWin;
  thumbRendererWin = null;
  thumbRendererReady = null;
  thumbPriorityApplied = false;
  rejectThumbRenderJobs(new Error('缩略图进程已关闭'));
  if (win && !win.isDestroyed()) win.destroy();
}

function ensureThumbRenderer() {
  if (thumbRendererWin && !thumbRendererWin.isDestroyed() && thumbRendererReady) return thumbRendererReady;
  const win = new BrowserWindow({
    width: 320, height: 320, show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'js', 'thumb-renderer-preload.js'),
      partition: 'sve-thumb-renderer',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  win.__sveThumbRenderer = true;
  thumbRendererWin = win;
  thumbRendererReady = new Promise((resolve, reject) => {
    win.webContents.once('did-finish-load', () => {
      try { os.setPriority(win.webContents.getOSProcessId(), os.constants.priority.PRIORITY_LOW); }
      catch (err) { console.warn('[thumb-worker] 设置低优先级失败', String(err && err.message || err).slice(0, 160)); }
      resolve(win);
    });
    win.webContents.once('did-fail-load', (_event, code, desc) => reject(new Error('缩略图页面加载失败 ' + code + ': ' + desc)));
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    if (thumbRendererWin === win) {
      thumbRendererWin = null; thumbRendererReady = null;
      thumbPriorityApplied = false;
      rejectThumbRenderJobs(new Error('缩略图进程异常退出: ' + String(details && details.reason || 'unknown')));
    }
  });
  win.on('closed', () => {
    if (thumbRendererWin === win) {
      thumbRendererWin = null; thumbRendererReady = null;
      thumbPriorityApplied = false;
      rejectThumbRenderJobs(new Error('缩略图进程已关闭'));
    }
  });
  win.loadFile(path.join(__dirname, 'js', 'thumb-renderer.html'));
  return thumbRendererReady;
}

function runThumbRender(payload) {
  return ensureThumbRenderer().then(win => new Promise((resolve, reject) => {
    const id = ++thumbRenderSeq;
    const timer = setTimeout(() => {
      thumbRenderJobs.delete(id);
      reject(new Error('缩略图生成超时'));
      destroyThumbRenderer();
    }, 60000);
    thumbRenderJobs.set(id, { resolve, reject, timer, sender: win.webContents });
    win.webContents.send('sve-thumb-job', Object.assign({ id }, payload || {}));
  }));
}

function enqueueThumbRender(payload) {
  const task = thumbRenderTail.catch(() => {}).then(() => runThumbRender(payload));
  thumbRenderTail = task.catch(() => {});
  return task;
}

async function renderSvgThumbFile(name) {
  const safeName = String(name || '').replace(/[\\/:*?"<>|]/g, '_');
  if (!/\.svg$/i.test(safeName)) throw new Error('缩略图文件名无效');
  const sourcePath = path.join(ensureDataDir(DATA_DIRS.svg), safeName);
  const stat = await fs.promises.stat(sourcePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > 80 * 1024 * 1024) throw new Error('SVG 文件无效或过大');
  const cacheKey = crypto.createHash('sha1').update('thumb-v6-480\0' + sourcePath + '\0' + stat.size + '\0' + stat.mtimeMs).digest('hex');
  const cacheDir = path.join(app.getPath('userData'), 'svg-thumb-cache');
  const cachePath = path.join(cacheDir, cacheKey + '.png');
  try {
    const cached = await fs.promises.readFile(cachePath);
    if (cached.length > 8 && cached[0] === 0x89 && cached[1] === 0x50 && cached[2] === 0x4e && cached[3] === 0x47) {
      return { url: thumbCachePublicUrl(cacheKey), cached: true };
    }
  } catch (err) {
    if (err && err.code !== 'ENOENT') appendLog('warn', '缩略图磁盘缓存读取失败', { message: String(err.message || err).slice(0, 200) });
  }
  if (thumbFileInflight.has(cacheKey)) return thumbFileInflight.get(cacheKey);
  const task = (async () => {
    const rendered = await enqueueThumbRender({ sourcePath, cachePath });
    if (rendered && rendered.saved) return { url: thumbCachePublicUrl(cacheKey), cached: false };
    const url = String(rendered && rendered.url || '');
    const m = /^data:image\/png;base64,(.+)$/s.exec(url || '');
    let saved = false;
    if (m) {
      try {
        await fs.promises.mkdir(cacheDir, { recursive: true });
        await fs.promises.writeFile(cachePath, Buffer.from(m[1], 'base64'));
        saved = true;
      } catch (err) {
        appendLog('warn', '缩略图磁盘缓存写入失败', { message: String(err && err.message || err).slice(0, 200) });
      }
    }
    return { url: saved ? thumbCachePublicUrl(cacheKey) : url, cached: false };
  })().finally(() => thumbFileInflight.delete(cacheKey));
  thumbFileInflight.set(cacheKey, task);
  return task;
}

ipcMain.on('sve-thumb-result', (event, result) => {
  const job = thumbRenderJobs.get(result && result.id);
  if (!job || event.sender !== job.sender) return;
  thumbRenderJobs.delete(result.id);
  clearTimeout(job.timer);
  if (result.ok && (result.url || result.saved)) job.resolve(result);
  else job.reject(new Error(String(result.error || '缩略图生成失败')));
});

const LOG_MAX = 3000;
const logBuf = [];
let logSavedPath = null;
const _dataDirs = {};
function appDataDir() {
  const base = app.isPackaged ? path.dirname(app.getPath('exe')) : __dirname;
  if (!_dataDirs.__base) {
    if (!fs.existsSync(base)) { try { fs.mkdirSync(base, { recursive: true }); } catch (e) { /* ignore */ } }
    _dataDirs.__base = base;
  }
  return _dataDirs.__base;
}
const DATA_DIRS = {
  svg: 'SVGImages',
  workcopy: 'WorkCopies',
  history: 'WorkCopiesHistory',
  logs: 'sve-logs',
  injectundo: 'InjectUndo'
};
const DATA_DIR_LEGACY = {
  SVGImages: 'SVG图像',
  WorkCopies: '工作副本',
  WorkCopiesHistory: '历史工作副本'
};
function ensureDataDir(name) {
  if (_dataDirs[name]) return _dataDirs[name];
  let dir = path.join(appDataDir(), name);
  const legacy = DATA_DIR_LEGACY[name];
  if (legacy) {
    const old = path.join(appDataDir(), legacy);
    if (!fs.existsSync(dir) && fs.existsSync(old)) {
      try {
        fs.renameSync(old, dir);
        appendLog('info', '数据目录改用英文名', { from: legacy, to: name });
      } catch (e) { }
    }
    if (!fs.existsSync(dir) && fs.existsSync(old)) dir = old;
  }
  if (!fs.existsSync(dir)) { try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ } }
  _dataDirs[name] = dir;
  return dir;
}
function logDirPath() {
  return ensureDataDir(DATA_DIRS.logs);
}
function fmtLogTime(d) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
    p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}
function appendLog(level, msg, data) {
  try {
    const line = '[' + fmtLogTime(new Date()) + '] [' + level + '] ' + msg + (data !== undefined ? ' | ' + JSON.stringify(data) : '');
    logBuf.push(line);
    if (logBuf.length > LOG_MAX) logBuf.splice(0, logBuf.length - LOG_MAX);
  } catch (e) { }
}
function saveLogFile() {
  try {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const fp = path.join(logDirPath(),
      'sve-debug-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' +
      p(d.getHours()) + '-' + p(d.getMinutes()) + '-' + p(d.getSeconds()) + '.log');
    fs.writeFileSync(fp, logBuf.join('\n') + '\n', 'utf8');
    logSavedPath = fp;
    return { ok: true, path: fp, lines: logBuf.length };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
process.on('uncaughtException', err => {
  try { appendLog('error', '主进程未捕获异常', { message: String(err && err.message), stack: String(err && err.stack).slice(0, 500) }); } catch (e) { /* ignore */ }
});

function appName() {
  try {
    const pkg = require('./package.json');
    const n = (pkg && (pkg.productName || (pkg.build && pkg.build.productName))) || '';
    if (n) return n;
  } catch (e) { /* ignore */ }
  try { return app.getName() || 'FH6 Vinyl Group Editor'; } catch (e) { return 'FH6 Vinyl Group Editor'; }
}
function clipDocName(name, max) {
  const s = String(name == null || name === '' ? nt('name.untitled') : name);
  const m = max || 30;
  return s.length > m ? s.slice(0, m) + '…' : s;
}
async function askCloseDoc(win, docName) {
  const stub = process.env.SVGBIANJI_DIALOG_STUB;
  if (stub) {
    try {
      console.log('[dialog-stub] ' + JSON.stringify({
        title: appName(),
        message: dt('dlg.closeMsg', { app: appName(), name: clipDocName(docName) }),
        buttons: [dt('dlg.yes'), dt('dlg.no'), dt('dlg.cancel')],
        docName: clipDocName(docName)
      }));
    } catch (e) { /* ignore */ }
    return stub === 'save' ? 'save' : (stub === 'dont' ? 'dont' : 'cancel');
  }
  const r = await dialog.showMessageBox(win, {
    type: 'question',
    title: appName(),
    message: dt('dlg.closeMsg', { app: appName(), name: clipDocName(docName) }),
    buttons: [dt('dlg.yes'), dt('dlg.no'), dt('dlg.cancel')],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  });
  return r.response === 0 ? 'save' : (r.response === 1 ? 'dont' : 'cancel');
}
async function askOverwrite(name) {
  const stub = process.env.SVGBIANJI_DIALOG_STUB;
  if (stub) {
    try {
      console.log('[dialog-stub] ' + JSON.stringify({
        title: dt('dlg.overwriteTitle'),
        message: dt('dlg.overwriteMsg', { name: clipDocName(name) }),
        buttons: [dt('dlg.yes'), dt('dlg.cancel')],
        docName: clipDocName(name)
      }));
    } catch (e) { /* ignore */ }
    return stub === 'save' || stub === 'yes';
  }
  if (process.env.SVGBIANJI_NO_CONFIRM === '1') return true;
  const opts = {
    type: 'warning',
    title: dt('dlg.overwriteTitle'),
    message: dt('dlg.overwriteMsg', { name: clipDocName(name) }),
    buttons: [dt('dlg.yes'), dt('dlg.cancel')],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  };
  const win = BrowserWindow.getAllWindows()[0];
  const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  return r.response === 0;
}
async function confirmClose(win) {
  if (process.env.SVGBIANJI_NO_CONFIRM === '1') { forceClose = true; win.close(); return; }
  let ok = true;
  try {
    ok = await win.webContents.executeJavaScript(
      '(async () => (typeof App !== "undefined" && App.Tabs && App.Tabs.closeAllTabsGuard) ? await App.Tabs.closeAllTabsGuard() : true)()'
    );
  } catch (err) {
    ok = true;
  }
  if (ok === false) return;
  await saveHistAnchorBeforeClose(win);
  forceClose = true;
  win.close();
}

async function saveHistAnchorBeforeClose(win) {
  try {
    await win.webContents.executeJavaScript(
      `(async () => {
        if (typeof App === 'undefined' || !App.state ||
            (!App.state.layers.length && !(App.state.bg && App.state.bg.image))) return false;
        if (!App.saveHistAnchor) return false;
        try { return !!(await App.saveHistAnchor()); }
        catch (e) { return false; }
      })()`
    );
  } catch (err) { }
}

const WIN_CTL_ACTIONS = { 'minimize': 1, 'toggle-maximize': 1, 'close': 1 };

function windowCtlTarget(e) {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isDestroyed()) return null;
  return win;
}

function sendWinState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send('window-state', { maximized: win.isMaximized(), focused: win.isFocused() });
  } catch (err) { }
}

ipcMain.handle('window-control', (e, action) => {
  const win = windowCtlTarget(e);
  if (!win) return { ok: false, error: 'no-window' };
  const act = String(action || '');
  if (!WIN_CTL_ACTIONS[act]) return { ok: false, error: 'bad-action' };
  try {
    if (act === 'minimize') win.minimize();
    else if (act === 'toggle-maximize') { win.isMaximized() ? win.unmaximize() : win.maximize(); }
    else win.close();
    return { ok: true, maximized: win.isMaximized() };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

ipcMain.handle('window-state-get', (e) => {
  const win = windowCtlTarget(e);
  if (!win) return { ok: false };
  return { ok: true, maximized: win.isMaximized(), focused: win.isFocused() };
});

function createWindow() {
  const testMode = !!process.env.SVGBIANJI_TEST;
  const win = new BrowserWindow({
    width: 1680,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#1e1f22',
    title: dt('app.title'),
    show: false,
    frame: true,
    icon: path.join(__dirname, 'icons', 'app-icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: !testMode
    }
  });
  win.setMenuBarVisibility(false);
  win.webContents.once('did-finish-load', () => {
    mainRendererPid = win.webContents.getOSProcessId();
    try { os.setPriority(mainRendererPid, os.constants.priority.PRIORITY_ABOVE_NORMAL); }
    catch (err) { console.warn('[main] 设置编辑器进程优先级失败', String(err && err.message || err).slice(0, 160)); }
  });
  win.once('ready-to-show', () => {
    win.show();
  });
  win.on('close', e => {
    if (forceClose) return;
    e.preventDefault();
    confirmClose(win);
  });
  win.on('closed', () => destroyThumbRenderer());
  win.on('maximize', () => sendWinState(win));
  win.on('unmaximize', () => sendWinState(win));
  win.on('focus', () => sendWinState(win));
  win.on('blur', () => sendWinState(win));
  win.loadURL('app://local/index.html');
  win.webContents.on('console-message', (...args) => {
    try {
      const first = args[0] || {};
      const msg = (first && typeof first === 'object' && 'message' in first) ? first.message : (args[2] != null ? args[2] : JSON.stringify(first));
      console.log('[renderer]', msg);
    } catch (e) { /* ignore */ }
  });
}

app.whenReady().then(() => {
  try { require('./update-check').check({ onLog: appendLog, t: dt }); }
  catch (e) { appendLog('warn', '更新检查模块加载失败（已忽略）', { message: String(e && e.message || e).slice(0, 160) }); }

  try {
[DATA_DIRS.history, DATA_DIRS.logs, DATA_DIRS.workcopy, DATA_DIRS.svg].forEach(n => ensureDataDir(n));
  } catch (e) { /* ignore */ }
  protocol.handle('app', (request) => {
    const u = new URL(request.url);
    if (u.hostname === 'thumb-cache') {
      const name = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      if (!/^[a-f0-9]{40}\.png$/i.test(name)) return new Response('forbidden', { status: 403 });
      const fp = path.join(app.getPath('userData'), 'svg-thumb-cache', name);
      return net.fetch(pathToFileURL(fp).toString()).catch(err => {
        appendLog('warn', '缩略图缓存文件读取失败', { name, message: String(err && err.message || err).slice(0, 200) });
        return new Response('not found', { status: 404 });
      });
    }
    let p = decodeURIComponent(u.pathname);
    if (!p || p === '/') p = '/index.html';
    const root = path.normalize(__dirname + path.sep);
    const fp = path.normalize(path.join(__dirname, p.replace(/^\//, '')));
    if (!fp.startsWith(root)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(fp).toString()).catch(err => {
      console.log('[protocol-miss]', request.url.slice(0, 120), '->', fp, '|', err && err.message);
      return new Response('not found: ' + p, { status: 404 });
    });
  });

  ipcMain.handle('open-svg-dialog', async () => {
    const r = await dialog.showOpenDialog({
      title: dt('dlg.openSvg'),
      filters: [{ name: dt('dlg.filterSvg'), extensions: ['svg'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths.length) return { canceled: true };
    const p = r.filePaths[0];
    try {
      const st = fs.statSync(p);
      if (st.size > 300 * 1024 * 1024) return { canceled: true, error: '文件过大' };
      const content = fs.readFileSync(p, 'utf8');
      return { canceled: false, path: p, name: path.basename(p), content };
    } catch (err) {
      return { canceled: true, error: String(err) };
    }
  });

  ipcMain.handle('save-svg-dialog', async (e, payload) => {
    const r = await dialog.showSaveDialog({
      title: dt('dlg.exportSvg'),
      defaultPath: payload.defaultName || (nt('name.untitled') + '.svg'),
      filters: [{ name: dt('dlg.filterSvg'), extensions: ['svg'] }]
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    try {
      fs.writeFileSync(r.filePath, payload.content, 'utf8');
      return { canceled: false, path: r.filePath };
    } catch (err) {
      return { canceled: true, error: String(err) };
    }
  });

  ipcMain.handle('work-save', async (e, payload) => {
    const r = await dialog.showSaveDialog({
      title: dt('dlg.saveWork'),
      defaultPath: payload.defaultName || (nt('name.workcopy') + '.svework'),
      filters: [{ name: dt('dlg.filterWork'), extensions: ['svework'] }, { name: dt('dlg.filterAll'), extensions: ['*'] }]
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    try {
      fs.writeFileSync(r.filePath, payload.content, 'utf8');
      return { canceled: false, path: r.filePath };
    } catch (err) {
      return { canceled: true, error: String(err) };
    }
  });
  ipcMain.handle('work-open', async () => {
    const r = await dialog.showOpenDialog({
      title: dt('dlg.openWork'),
      filters: [{ name: dt('dlg.filterWork'), extensions: ['svework', 'json'] }, { name: dt('dlg.filterAll'), extensions: ['*'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths.length) return { canceled: true };
    try {
      const p = r.filePaths[0];
      const st = fs.statSync(p);
      if (st.size > 200 * 1024 * 1024) return { canceled: true, error: '文件过大' };
      const content = fs.readFileSync(p, 'utf8');
      workcopyStore.validate(content);
      return { canceled: false, path: p, name: path.basename(p), content, source: workcopyStore.source(p, content) };
    } catch (err) {
      return { canceled: true, error: String(err) };
    }
  });

  function histAnchorDirPath() {
    return ensureDataDir(DATA_DIRS.history);
  }
  const pad2 = n => String(n).padStart(2, '0');
  function histAnchorName(d) {
    return '锚点-' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '-' +
      pad2(d.getHours()) + '-' + pad2(d.getMinutes()) + '-' + pad2(d.getSeconds()) + '.svework';
  }
  function histAnchorTime(name) {
    const m = /^锚点-(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})(?:-\d+)?\.svework$/.exec(name || '');
    if (!m) return name || '';
    const p = m[1].split('-');
    return p[0] + '-' + p[1] + '-' + p[2] + ' ' + p[3] + ':' + p[4] + ':' + p[5];
  }
  ipcMain.handle('hist-anchor-save', async (e, payload) => {
    try {
      const dir = histAnchorDirPath();
      const d = new Date();
      let name = histAnchorName(d);
      let i = 1;
      while (fs.existsSync(path.join(dir, name))) name = histAnchorName(d) + '-' + (++i) + '.svework';
      fs.writeFileSync(path.join(dir, name), payload.content, 'utf8');
      const files = fs.readdirSync(dir).filter(f => /^锚点-.*\.svework$/.test(f)).sort();
      while (files.length > 20) {
        const oldest = files.shift();
        try { fs.unlinkSync(path.join(dir, oldest)); } catch (e2) { /* ignore */ }
      }
      return { ok: true, name };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
  ipcMain.handle('hist-anchor-list', async () => {
    try {
      const dir = histAnchorDirPath();
      const files = fs.readdirSync(dir).filter(f => /^锚点-.*\.svework$/.test(f)).sort();
      return { ok: true, files: files.map(f => ({ name: f, time: histAnchorTime(f) })) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
  ipcMain.handle('hist-anchor-read', async (e, payload) => {
    try {
      const name = String(payload.name || '').replace(/[\\/:*?"<>|]/g, '_');
      const p = path.join(histAnchorDirPath(), name);
      if (!fs.existsSync(p)) return { ok: false, error: '锚点不存在' };
      const content = fs.readFileSync(p, 'utf8');
      return { ok: true, content, name };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('confirm-close-doc', async (e, payload) => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (!win) return { action: 'dont' };
      if (process.env.SVGBIANJI_NO_CONFIRM === '1') return { action: 'dont' };
      const action = await askCloseDoc(win, payload && payload.name);
      return { action };
    } catch (err) {
      return { action: 'dont', error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('app-flags', async () => ({
    testMode: !!process.env.SVGBIANJI_TEST,
    exeDir: appDataDir()
  }));
  ipcMain.handle('settings-get', async () => {
    try {
      const p = path.join(app.getPath('userData'), 'settings.json');
      return { ok: true, settings: JSON.parse(fs.readFileSync(p, 'utf8')) };
    } catch (err) {
      return { ok: true, settings: {} };
    }
  });
  ipcMain.handle('settings-set', async (e, s) => {
    try {
      const p = path.join(app.getPath('userData'), 'settings.json');
      fs.writeFileSync(p, JSON.stringify(s || {}, null, 2), 'utf8');
      return { ok: true, settings: s || {} };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('file-save-work', async (e, payload) => {
    try {
      return workcopyStore.save(payload && payload.content, payload && payload.source,
        ensureDataDir(DATA_DIRS.workcopy), uiLang());
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('file-auto-save', async (e, payload) => {
    try {
      const kind = String(payload && payload.kind || '');
      const dirName = kind === 'svg' ? DATA_DIRS.svg : DATA_DIRS.workcopy;
      const dir = ensureDataDir(dirName);

      let uiLang = null;
      try { uiLang = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')).lang || null; } catch (err3) { }
      const name = resolveAutoSaveName(kind, payload && payload.fileName, n => fs.existsSync(path.join(dir, n)), undefined, uiLang);
      const fp = path.join(dir, name);
      fs.writeFileSync(fp, String(payload && payload.content || ''), 'utf8');
      return { ok: true, name, path: fp };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('home-import-dialog', async () => {
    try {
      const r = await dialog.showOpenDialog({
        title: dt('dlg.importFile'),
        filters: [{ name: dt('dlg.filterSvg'), extensions: ['svg'] }],
        properties: ['openFile', 'multiSelections']
      });
      if (r.canceled || !r.filePaths.length) return { ok: true, canceled: true, imported: [] };
      const dir = ensureDataDir(DATA_DIRS.svg);
      const imported = [];
      for (const src of r.filePaths) {
        const base = path.basename(src);
        const ext = path.extname(base) || '.svg';
        const stem = base.slice(0, base.length - ext.length);
        let name = base;
        let i = 1;
        while (fs.existsSync(path.join(dir, name))) name = stem + '-' + (++i) + ext;
        fs.copyFileSync(src, path.join(dir, name));
        imported.push(name);
      }
      return { ok: true, canceled: false, imported: imported, dir: dir };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('file-recent', async () => {
    try {
      const out = [];
      for (const kind of [DATA_DIRS.workcopy, DATA_DIRS.svg]) {
        const dir = ensureDataDir(kind);
        let names;
        try { names = fs.readdirSync(dir); } catch (err2) { continue; }
        names.forEach(name => {
          const ext = kind === DATA_DIRS.svg ? '.svg' : '.svework';
          if (!name.toLowerCase().endsWith(ext)) return;
          try {
            const st = fs.statSync(path.join(dir, name));
            out.push({ type: kind === DATA_DIRS.svg ? 'svg' : 'workcopy', name, path: path.join(dir, name), mtime: st.mtimeMs, size: st.size });
          } catch (err3) { }
        });
      }
      out.sort((a, b) => b.mtime - a.mtime);
      return { ok: true, items: out };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('file-read', async (e, payload) => {
    try {
      const kind = String(payload && payload.kind || '');
      const dir = ensureDataDir(kind === 'svg' ? DATA_DIRS.svg : DATA_DIRS.workcopy);
      const name = String(payload && payload.name || '').replace(/[\\/:*?"<>|]/g, '_');
      const fp = path.join(dir, name);
      if (!fs.existsSync(fp)) return { ok: false, error: '文件不存在' };
      if (kind === 'workcopy') return workcopyStore.read(fp);
      const content = fs.readFileSync(fp, 'utf8');
      return { ok: true, content, name };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('svg-thumb-render', async (e, payload) => {
    try {
      const text = String(payload && payload.text || '');
      if (!text || text.length > 80 * 1024 * 1024) return { ok: false, error: 'SVG 内容无效或过大' };
      const rendered = await enqueueThumbRender({ text });
      const url = String(rendered && rendered.url || '');
      if (!url) throw new Error('缩略图生成结果为空');
      return { ok: true, url };
    } catch (err) {
      appendLog('warn', '独立缩略图生成失败', { message: String(err && err.message || err).slice(0, 300) });
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('svg-thumb-warm', async () => {
    try {
      await ensureThumbRenderer();
      prioritizeThumbWork();
      return { ok: true };
    } catch (err) {
      appendLog('warn', '缩略图进程预热失败', { message: String(err && err.message || err).slice(0, 200) });
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('svg-thumb-file', async (e, payload) => {
    try {
      const result = await renderSvgThumbFile(payload && payload.name);
      return { ok: true, url: result.url, cached: result.cached };
    } catch (err) {
      appendLog('warn', '主页 SVG 缩略图生成失败', { name: String(payload && payload.name || '').slice(0, 160), message: String(err && err.message || err).slice(0, 300) });
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('file-save-svg', async (e, payload) => {
    try {
      const name = String(payload && payload.name || '');
      const content = String(payload && payload.content || '');
      if (!/\.svg$/i.test(name) || name.indexOf('/') >= 0 || name.indexOf('\\') >= 0 || name.indexOf('..') >= 0) {
        return { ok: false, error: 'invalid name' };
      }
      const dir = ensureDataDir(DATA_DIRS.svg);
      const p = path.join(dir, name);
      const exists = fs.existsSync(p);
      const previous = exists ? fs.readFileSync(p, 'utf8') : null;
      if (exists && name !== String(payload && payload.sourceName || '')) {
        if (!(await askOverwrite(name))) return { ok: false, canceled: true };
      }
      if (exists && (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== previous))
        return { ok: false, error: dt('dlg.fileChanged') };
      if (exists) atomicWrite(p + '.bak', previous, true);
      atomicWrite(p, content, exists);
      return { ok: true, path: p, name, exists };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('file-rename', async (e, payload) => {
    try {
      const kind = String(payload && payload.kind || '');
      const oldName = String(payload && payload.oldName || '');
      const newName = String(payload && payload.newName || '');
      const svgOk = kind === 'svg' && /\.svg$/i.test(oldName) && /\.svg$/i.test(newName);
      const wkOk = kind === 'workcopy' && /\.svework$/i.test(oldName) && /\.svework$/i.test(newName);
      if (!svgOk && !wkOk) return { ok: false, error: 'invalid kind/name' };
      if (/[\/\\]/.test(oldName) || /[\/\\]/.test(newName) || oldName.indexOf('..') >= 0 || newName.indexOf('..') >= 0) {
        return { ok: false, error: 'invalid name' };
      }
      const dir = ensureDataDir(kind === 'svg' ? DATA_DIRS.svg : DATA_DIRS.workcopy);
      const oldP = path.join(dir, oldName), newP = path.join(dir, newName);
      if (!fs.existsSync(oldP)) return { ok: false, error: 'source missing' };
      if (fs.existsSync(newP)) return { ok: false, error: 'target exists' };
      fs.renameSync(oldP, newP);
      if (kind === 'workcopy') workcopyStore.renamed(oldP, newP);
      return { ok: true, path: newP, oldPath: oldP, name: newName };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('file-delete', async (e, payload) => {
    try {
      const kind = String(payload && payload.kind || '');
      const dir = ensureDataDir(kind === 'svg' ? DATA_DIRS.svg : DATA_DIRS.workcopy);
      const name = String(payload && payload.name || '').replace(/[\\/:*?"<>|]/g, '_');
      const extOk = kind === 'svg' ? /\.svg$/i.test(name) : /\.svework$/i.test(name);
      if (!extOk) return { ok: false, error: '不支持的文件类型' };
      const fp = path.join(dir, name);
      if (!fs.existsSync(fp)) return { ok: false, error: '文件不存在' };
      fs.unlinkSync(fp);
      try { fs.unlinkSync(fp + '.bak'); } catch (e) { }
      return { ok: true, name };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.on('sve-log', (e, entry) => {
    const lv = String(entry && entry.level || 'info').slice(0, 12);
    const msg = String(entry && entry.msg || '').slice(0, 400);
    const data = (entry && entry.data !== undefined) ? entry.data : undefined;
    appendLog(lv, msg, data);
  });
  ipcMain.handle('sve-log-path', async () => ({ path: logSavedPath, buffered: logBuf.length }));
  ipcMain.handle('sve-log-read', async (e, payload) => {
    try {
      const maxLen = Math.min(parseInt(payload && payload.maxLen, 10) || 200000, 500000);
      const content = logBuf.join('\n');
      return { ok: true, content: content.length > maxLen ? content.slice(-maxLen) : content };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
  ipcMain.handle('sve-log-save', async () => saveLogFile());
  ipcMain.handle('sve-log-open', async () => {
    try {
      const fp = logSavedPath;
      if (!fp || !fs.existsSync(fp)) return { ok: false, error: '日志还没保存到文件：请先点「保存日志」' };
      const { shell } = require('electron');
      shell.showItemInFolder(fp);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('open-image-dialog', async () => {
    const r = await dialog.showOpenDialog({
      title: dt('dlg.openImage'),
      filters: [{ name: dt('dlg.filterImage'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'jfif', 'ico', 'tif', 'tiff'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths.length) return { canceled: true };
    const p = r.filePaths[0];
    try {
      const st = fs.statSync(p);
      if (st.size > 100 * 1024 * 1024) return { canceled: true, error: '图片过大' };
      const buf = fs.readFileSync(p);
      const ext = (path.extname(p) || '.png').toLowerCase();
      const mimeMap = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
        '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif', '.jfif': 'image/jpeg',
        '.ico': 'image/x-icon', '.tif': 'image/tiff', '.tiff': 'image/tiff'
      };
      const mime = mimeMap[ext] || 'image/png';
      return { canceled: false, name: path.basename(p), dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64') };
    } catch (err) {
      return { canceled: true, error: String(err) };
    }
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
