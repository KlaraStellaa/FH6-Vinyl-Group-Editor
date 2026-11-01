'use strict';
const { app, BrowserWindow, protocol, net, ipcMain, dialog, shell } = require('electron');
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
    const s = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return DLG.dicts[s && s.lang] ? s.lang : 'zh-CN';
  } catch (e) { return 'zh-CN'; }
}
function dt(key, params) { return DLG.get(uiLang(), key, params); }

const NAME_I18N = require('./js/name-i18n');
function nt(key, params) { return NAME_I18N.get(uiLang(), key, params); }


const _dataDirs = {};
function appDataDir() {
  let base;
  if (!app.isPackaged) base = __dirname;
  else base = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
  if (!_dataDirs.__base) {
    if (!fs.existsSync(base)) { try { fs.mkdirSync(base, { recursive: true }); } catch (e) {  } }
    _dataDirs.__base = base;
  }
  return _dataDirs.__base;
}


const DL_IDLE_MS = 45000;      
function downloadToFile(url, dest, onPct) {
  return new Promise((resolve, reject) => {
    let out;
    try { out = fs.createWriteStream(dest); } catch (e) { reject(e); return; }
    let req = null;
    let settled = false;
    let idleTimer = null;
    const report = (pct, got, total) => {
      try { if (typeof onPct === 'function') onPct(pct, got, total); } catch (e) {  }
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (idleTimer) { try { clearTimeout(idleTimer); } catch (e) {  } idleTimer = null; }
      try { out.destroy(); } catch (e) {  }
      try { fs.unlinkSync(dest); } catch (e) {  }
      reject(err);
    };
    
    out.on('error', fail);
    try { req = net.request({ method: 'GET', url: String(url), redirect: 'follow' }); }
    catch (e) { fail(e); return; }
    try { req.setHeader('User-Agent', 'VinylFH6-Updater'); } catch (e) {  }
    
    const armIdle = () => {
      if (idleTimer) { try { clearTimeout(idleTimer); } catch (e) {  } }
      idleTimer = setTimeout(() => {
        try { req.abort(); } catch (e) {  }
        fail(new Error('timeout'));
      }, DL_IDLE_MS);
    };
    armIdle();
    req.on('response', res => {
      if (res.statusCode !== 200) { fail(new Error('HTTP ' + res.statusCode)); return; }
      const total = Number((res.headers && res.headers['content-length']) || 0);
      let got = 0;
      report(0, 0, total);
      res.on('data', chunk => {
        armIdle();
        got += chunk.length;
        let ok = true;
        try { ok = out.write(chunk); } catch (e) { fail(e); return; }
        
        if (ok === false) {
          try { res.pause(); } catch (e) {  }
          out.once('drain', () => { try { res.resume(); } catch (e) {  } });
        }
        if (total) report(Math.min(99, Math.round(got / total * 100)), got, total);
        
        else report(-1, got, total);
      });
      res.on('end', () => {
        if (idleTimer) { try { clearTimeout(idleTimer); } catch (e) {  } idleTimer = null; }
        
        if (total && got !== total) { fail(new Error('incomplete ' + got + '/' + total)); return; }
        out.end(() => {
          if (settled) return;
          settled = true;
          report(100, got, total);
          resolve(dest);
        });
      });
      res.on('error', fail);
      res.on('aborted', () => fail(new Error('aborted')));
    });
    req.on('error', fail);
    req.end();
  });
}




function portableExePath() {
  const p = process.env.PORTABLE_EXECUTABLE_FILE || (app.isPackaged ? app.getPath('exe') : '');
  return p || '';
}


const EXE_MIN_BYTES = 20 * 1024 * 1024;


function checkExePackage(file) {
  let st;
  try { st = fs.statSync(file); } catch (e) { return { ok: false, error: 'not-found' }; }
  if (!st.isFile()) return { ok: false, error: 'not-exe' };
  if (st.size < EXE_MIN_BYTES) return { ok: false, error: 'too-small', size: st.size };
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(2);
    fs.readSync(fd, head, 0, 2, 0);
    if (head[0] !== 0x4d || head[1] !== 0x5a) return { ok: false, error: 'not-exe' };  
    
    const needle = Buffer.from('FH6 Vinyl Group Editor', 'utf16le');
    const chunk = Buffer.alloc(1 << 20);
    const tail = Buffer.alloc(needle.length - 1);
    let pos = 0, found = false;
    while (!found && pos < st.size) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, pos);
      if (n <= 0) break;
      const hay = pos === 0 ? chunk.subarray(0, n) : Buffer.concat([tail, chunk.subarray(0, n)]);
      if (hay.indexOf(needle) >= 0) found = true;
      hay.copy(tail, 0, Math.max(0, hay.length - tail.length));
      pos += n;
    }
    const nameOk = found || /(fh6|vinyl).*(editor|group)/i.test(path.basename(file));
    if (!nameOk) return { ok: false, error: 'wrong-app' };
    return { ok: true, size: st.size, name: path.basename(file), byContent: found };
  } catch (e) {
    return { ok: false, error: 'unreadable', message: String(e && e.message || e).slice(0, 120) };
  } finally {
    try { if (fd !== null) fs.closeSync(fd); } catch (e) {  }
  }
}


function moveIntoPlace(src, dst) {
  try {
    fs.renameSync(src, dst);
    return 'rename';
  } catch (e) {
    if (!e || e.code !== 'EXDEV') throw e;
    fs.copyFileSync(src, dst);
    try { fs.unlinkSync(src); }
    catch (e2) { appendLog('warn', '手动安装：源文件删不掉（已复制，安装继续）', { file: path.basename(src), message: String(e2 && e2.message || e2).slice(0, 120) }); }
    return 'copy+unlink';
  }
}


function scheduleExeReplace(newExe, targetExe) {
  const bat = path.join(os.tmpdir(), 'sve-replace-' + Date.now() + '.bat');
  const script = [
    '@echo off',
    'setlocal',
    'set "TGT=%~1"',
    'set "NEW=%~2"',
    'set "OPID=%~3"',
    'set /a N=0',
    ':WAIT',
    'tasklist /FI "PID eq %OPID%" /NH 2>nul | find "%OPID%" >nul',
    'if errorlevel 1 goto REPLACE',
    'set /a N+=1',
    'if %N% GTR 120 goto REPLACE',
    'ping -n 2 127.0.0.1 >nul',
    'goto WAIT',
    ':REPLACE',
    'set /a N=0',
    ':MV',
    'move /y "%NEW%" "%TGT%" >nul 2>&1',
    'if not errorlevel 1 goto STARTIT',
    'set /a N+=1',
    'if %N% GTR 60 goto FAILED',
    'ping -n 1 127.0.0.1 >nul',
    'goto MV',
    ':STARTIT',
    'start "" "%TGT%"',
    'goto CLEAN',
    ':FAILED',
    
    'del "%NEW%" >nul 2>&1',
    'start "" "%TGT%"',
    ':CLEAN',
    'del "%~f0"',
    'exit /b'
  ].join('\r\n');
  fs.writeFileSync(bat, script, 'ascii');
  const child = require('child_process').spawn(
    'cmd.exe',
    ['/c', bat, targetExe, newExe, String(process.pid)],
    { detached: true, stdio: 'ignore', windowsHide: true }
  );
  child.unref();
  return bat;
}


const STALE_TMP_MS = 10 * 60 * 1000;
function looksLikeOurExtraction(dir) {
  try {
    if (fs.existsSync(path.join(dir, 'app-64.7z'))) return true;
    
    if (!fs.existsSync(path.join(dir, 'FH6 Vinyl Group Editor.exe'))) return false;
    return fs.statSync(path.join(dir, 'resources')).isDirectory();
  } catch (e) { return false; }
}
function cleanStalePortableTemp() {
  let self = '', selfParent = '';
  try { self = path.dirname(process.execPath); selfParent = path.dirname(self); } catch (e) {  }
  const tmp = os.tmpdir();
  let names = [];
  try { names = fs.readdirSync(tmp); } catch (e) { return 0; }
  let killed = 0;
  for (const n of names) {
    const dir = path.join(tmp, n);
    if (dir === self || dir === selfParent) continue;
    let st;
    try { st = fs.statSync(dir); } catch (e) { continue; }
    if (!st.isDirectory()) continue;
    if (Date.now() - st.mtimeMs < STALE_TMP_MS) continue;
    if (!looksLikeOurExtraction(dir)) continue;
    try { fs.rmSync(dir, { recursive: true, force: true }); killed++; }
    catch (e) {  }
  }
  if (killed) appendLog('info', '已清理异常退出留下的临时解压目录', { dirs: killed, tmp: tmp });
  return killed;
}


const ISOLATE = process.env.SVGBIANJI_ISOLATE === '1';
if (ISOLATE) {
  
  const isoDir = process.env.SVGBIANJI_ISOLATE_DIR || path.join(os.tmpdir(), 'svgbianji-cdp-' + process.pid);
  app.setPath('userData', isoDir);
} else {
  
  try { app.setPath('userData', path.join(appDataDir(), '_userdata')); } catch (e) {  }
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

app.commandLine.appendSwitch('disable-gpu-sandbox');

app.commandLine.appendSwitch('force-high-performance-gpu');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
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
  
  const cacheKey = crypto.createHash('sha1').update('thumb-v9-480\0' + sourcePath + '\0' + stat.size + '\0' + stat.mtimeMs).digest('hex');
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


const GENERIC_THUMB_DIR = 'thumb-cache';       
function genericThumbDir(ns) {
  const safeNs = String(ns || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 24);
  if (!safeNs) return null;
  return path.join(app.getPath('userData'), GENERIC_THUMB_DIR, safeNs);
}
function genericThumbPath(ns, key) {
  const dir = genericThumbDir(ns);
  const safeKey = String(key || '').toLowerCase();
  if (!dir || !/^[a-f0-9]{40}$/.test(safeKey)) return null;
  return path.join(dir, safeKey + '.png');
}

function genericThumbUrl(ns, key) {
  return 'app://thumb-cache/' + encodeURIComponent(String(ns)) + '/' + String(key) + '.png';
}
async function readGenericThumb(p) {
  if (!p) return false;
  try {
    const buf = await fs.promises.readFile(p);
    return buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  } catch (err) {
    if (err && err.code !== 'ENOENT') appendLog('warn', '缩略图缓存读取失败', { message: String(err.message || err).slice(0, 200) });
    return false;
  }
}
async function writeGenericThumb(p, dataUrlOrBuffer) {
  if (!p) return false;
  try {
    let buf;
    if (dataUrlOrBuffer instanceof Buffer) buf = dataUrlOrBuffer;
    else {
      const m = /^data:image\/png;base64,(.+)$/s.exec(String(dataUrlOrBuffer || ''));
      if (!m) return false;
      buf = Buffer.from(m[1], 'base64');
    }
    if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return false;
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    await fs.promises.writeFile(p, buf);
    return true;
  } catch (err) {
    appendLog('warn', '缩略图缓存写入失败', { message: String(err && err.message || err).slice(0, 200) });
    return false;
  }
}

async function dropGenericThumb(ns, key) {
  const p = genericThumbPath(ns, key);
  if (!p) return false;
  try { await fs.promises.unlink(p); return true; }
  catch (err) { return !!(err && err.code === 'ENOENT'); }
}

async function dropGenericThumbNamespace(ns) {
  const dir = genericThumbDir(ns);
  if (!dir) return false;
  try { await fs.promises.rm(dir, { recursive: true, force: true }); return true; }
  catch (err) { return false; }
}


const WORKCOPY_THUMB_NS = 'workcopy-thumb-v2';


function workcopyThumbIndexPath() {
  const dir = genericThumbDir(WORKCOPY_THUMB_NS);
  return dir ? path.join(dir, '_index.json') : null;
}
function readWorkcopyThumbIndex() {
  const p = workcopyThumbIndexPath();
  if (!p) return {};
  try { const o = JSON.parse(fs.readFileSync(p, 'utf8')); return (o && typeof o === 'object') ? o : {}; }
  catch (err) { return {}; }
}
function writeWorkcopyThumbIndex(idx) {
  const p = workcopyThumbIndexPath();
  if (!p) return;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(idx), 'utf8');
  } catch (err) {  }
}
function rememberWorkcopyThumbKey(name, key) {
  const n = String(name || '');
  if (!n || !/^[a-f0-9]{40}$/.test(String(key || ''))) return;
  const idx = readWorkcopyThumbIndex();
  const list = Array.isArray(idx[n]) ? idx[n] : [];
  if (list.indexOf(key) < 0) list.push(key);
  idx[n] = list.slice(-8);            
  writeWorkcopyThumbIndex(idx);
}
function dropWorkcopyThumbs(names) {
  const idx = readWorkcopyThumbIndex();
  const touched = [];
  (names || []).forEach(raw => {
    const n = String(raw || '');
    if (!n) return;
    (idx[n] || []).forEach(k => {
      const p = genericThumbPath(WORKCOPY_THUMB_NS, k);
      if (p) { try { fs.unlinkSync(p); } catch (err) { if (!err || err.code !== 'ENOENT') touched.push(k); } }
    });
    delete idx[n];
  });
  writeWorkcopyThumbIndex(idx);
  return touched.length;
}


const LOG_MAX = 3000;
const logBuf = [];
let logSavedPath = null;


function settingsPath() { return path.join(appDataDir(), 'settings.json'); }

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
      } catch (e) {  }
    }
    if (!fs.existsSync(dir) && fs.existsSync(old)) dir = old;
  }
  if (!fs.existsSync(dir)) { try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {  } }
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
  } catch (e) {  }
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
  try { appendLog('error', '主进程未捕获异常', { message: String(err && err.message), stack: String(err && err.stack).slice(0, 500) }); } catch (e) {  }
});


function appName() {
  try {
    const pkg = require('./package.json');
    const n = (pkg && (pkg.productName || (pkg.build && pkg.build.productName))) || '';
    if (n) return n;
  } catch (e) {  }
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
    } catch (e) {  }
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
    } catch (e) {  }
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
  } catch (err) {  }
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
  } catch (err) {  }
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
    
    frame: false,
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
    } catch (e) {  }
  });
}

app.whenReady().then(() => {
  
  try {
    require('./update-check').check({
      onLog: appendLog,
      t: dt,
      
      onAvailable: function (info) {
        const push = (tries) => {
          const w = BrowserWindow.getAllWindows().find(x => !x.isDestroyed());
          if (w && w.webContents && !w.webContents.isLoading()) {
            try { w.webContents.send('update-available', info); return; } catch (e) {  }
          }
          if (tries > 0) setTimeout(() => push(tries - 1), 1000);
        };
        push(20);
      }
    });
  }
  catch (e) { appendLog('warn', '更新检查模块加载失败（已忽略）', { message: String(e && e.message || e).slice(0, 160) }); }

  
  try {
    
[DATA_DIRS.history, DATA_DIRS.logs, DATA_DIRS.workcopy, DATA_DIRS.svg].forEach(n => ensureDataDir(n));
  } catch (e) {  }
  
  try {
    const exePath = process.env.PORTABLE_EXECUTABLE_FILE || (app.isPackaged ? app.getPath('exe') : '');
    if (exePath) {
      const dir = path.dirname(exePath);
      fs.readdirSync(dir).forEach(n => {
        if (/\.old\.exe$/i.test(n) || /^update-(manual-)?\d+\.exe$/i.test(n)) {
          try { fs.unlinkSync(path.join(dir, n)); } catch (e) {  }
        }
      });
    }
  } catch (e) {  }
  try {
    const tmpDir = os.tmpdir();
    fs.readdirSync(tmpDir).forEach(n => {
      if (/^sve-(replace|update-restart)-\d+\.bat$/i.test(n)) {
        try { fs.unlinkSync(path.join(tmpDir, n)); } catch (e) {  }
      }
    });
  } catch (e) {  }
  
  if (app.isPackaged) setTimeout(() => cleanStalePortableTemp(), 5000);
  protocol.handle('app', (request) => {
    const u = new URL(request.url);
    if (u.hostname === 'thumb-cache') {
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      
      const single = /^[a-f0-9]{40}\.png$/i.test(rel);
      const namespaced = /^[a-z0-9_-]{1,24}\/[a-f0-9]{40}\.png$/i.test(rel);
      if (!single && !namespaced) return new Response('forbidden', { status: 403 });
      const fp = namespaced
        ? path.join(app.getPath('userData'), GENERIC_THUMB_DIR, rel)
        : path.join(app.getPath('userData'), 'svg-thumb-cache', rel);
      return net.fetch(pathToFileURL(fp).toString()).catch(err => {
        appendLog('warn', '缩略图缓存文件读取失败', { name: rel, message: String(err && err.message || err).slice(0, 200) });
        return new Response('not found', { status: 404 });
      });
    }
    
    if (u.hostname === 'fonts') {
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      if (!/^[a-z0-9_-]{1,40}\.(ttf|otf|ttc|woff2?)$/i.test(rel)) return new Response('forbidden', { status: 403 });
      const fp = path.join(appDataDir(), 'fonts', rel);
      
      const types = { '.ttf': 'font/ttf', '.otf': 'font/otf', '.ttc': 'font/collection', '.woff': 'font/woff', '.woff2': 'font/woff2' };
      try {
        const buf = fs.readFileSync(fp);
        return new Response(buf, {
          status: 200,
          headers: {
            'Content-Type': types[path.extname(rel).toLowerCase()] || 'application/octet-stream',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache'
          }
        });
      } catch (err) {
        return new Response('not found', { status: 404 });
      }
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
  
  function histAnchorLimit() {
    try {
      const s = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
      const n = Number(s && s.autoSave && s.autoSave.limit);
      if (isFinite(n) && n >= 1 && n <= 1000) return Math.round(n);
    } catch (err) {  }
    return 15;
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
      const limit = histAnchorLimit();
      while (files.length > limit) {
        const oldest = files.shift();
        try { fs.unlinkSync(path.join(dir, oldest)); } catch (e2) {  }
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
      return { ok: true, content, name, mtimeMs: fs.statSync(p).mtimeMs };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  
  const fzaSave = require('./forza-save');
  const fzaCgroup = require('./forza-cgroup');
  const FZA_SYMBOLS = path.join(__dirname, 'assets', 'FH6_Vinyl_Symbols.svg');
  ipcMain.handle('forza-accounts', async () => {
    try {
      const accounts = fzaSave.listAccounts(fzaSave.DEFAULT_GAMESAVE_DIR);
      const labels = fzaSave.accountLabels(accounts);
      return { ok: true, accounts: labels, defaultDir: fzaSave.DEFAULT_GAMESAVE_DIR };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('forza-groups', async (e, payload) => {
    try {
      const groups = fzaSave.listLayerGroups(String(payload && payload.containersRoot || ''));
      return { ok: true, groups };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('forza-thumb', async (e, payload) => {
    try {
      const p = String(payload && payload.path || '');
      if (!fs.existsSync(p)) return { ok: false };
      const buf = fs.readFileSync(p);
      if (buf.length > 400 * 1024) return { ok: false, error: 'too large' };
      return { ok: true, dataUrl: 'data:image/webp;base64,' + buf.toString('base64') };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
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
  
  ipcMain.handle('forza-thumb-write', async (e, payload) => {
    try {
      const p = String(payload && payload.path || '');
      const dataUrl = String(payload && payload.dataUrl || '');
      if (!/\bthumb\.webp$/i.test(p)) return { ok: false, error: 'not a thumb.webp path' };
      const m = /^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
      if (!m) return { ok: false, error: 'bad dataUrl' };
      const buf = Buffer.from(m[1], 'base64');
      if (!buf.length || buf.length > 400 * 1024) return { ok: false, error: 'bad size' };
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) return { ok: false, error: 'group dir missing' };
      if (!fs.existsSync(p)) return { ok: false, error: 'thumb.webp 不存在（只覆写既有文件，不新建）' };
      
      const st0 = fs.statSync(p, { bigint: true });
      const tSaved = { atimeNs: st0.atimeNs, mtimeNs: st0.mtimeNs, birthtimeNs: st0.birthtimeNs };
      const prev = fs.readFileSync(p);
      try {
        fzaCgroup.writeFileInPlace(p, buf, tSaved);
      } catch (err) {
        try { fzaCgroup.writeFileInPlace(p, prev, tSaved); } catch (e2) {  }
        return { ok: false, error: '写入失败已回滚：' + String(err && err.message || err) };
      }
      return { ok: true, bytes: buf.length };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  
  ipcMain.handle('forza-inject', async (e, payload) => {
    try {
      const cgroup = String(payload && payload.cgroup || '');
      const header = String(payload && payload.header || cgroup.replace(/C_group$/, 'header'));
      if (!fs.existsSync(cgroup) || !fs.existsSync(header)) return { ok: false, error: '占位组文件不存在' };
      const model = payload && payload.model;
      if (!model || model.kind !== 'group') return { ok: false, error: '模型无效' };
      const r = fzaCgroup.writeCgroupFile(cgroup, model, fzaCgroup.loadShapeHalfExtents(FZA_SYMBOLS));
      appendLog('info', 'Forza 注入完成', { layers: r.layers, cgroup });
      return { ok: true, layers: r.layers };
    } catch (err) {
      appendLog('error', 'Forza 注入失败', { message: String(err && err.message || err) });
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  
  ipcMain.handle('forza-export', async (e, payload) => {
    try {
      const cgroup = String(payload && payload.cgroup || '');
      const header = String(payload && payload.header || cgroup.replace(/C_group$/, 'header'));
      if (!fs.existsSync(cgroup)) return { ok: false, error: '文件不存在' };
      const model = fzaCgroup.decodeCgroupPayload(fzaCgroup.unwrapCgroupFile(cgroup));
      let title = '', author = '';
      if (fs.existsSync(header)) {
        const h = fzaCgroup.parseHeader(header);
        title = h.title; author = h.author;
      }
      return { ok: true, model, title, author };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  
  ipcMain.handle('forza-backup', async (e, payload) => {
    try {
      const uDir = String(payload && payload.uDir || '');
      if (!fs.existsSync(uDir)) return { ok: false, error: '账户目录不存在' };
      const xuid = /^u_(\d+)_16D460$/.exec(path.basename(uDir));
      const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
      const dlg = await dialog.showSaveDialog({
        title: dt('dlg.backupSave'),
        defaultPath: 'backup_' + (xuid ? xuid[1] : 'account') + '_' + ts + '.zip',
        filters: [{ name: dt('dlg.filterZip'), extensions: ['zip'] }]
      });
      if (dlg.canceled || !dlg.filePath) return { canceled: true };
      const out = fzaSave.backupAccount(uDir, dlg.filePath);
      return { ok: true, path: out };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  
  const UNDO_KEEP = 3;
  const undoRoot = () => ensureDataDir(DATA_DIRS.injectundo);
  const undoPad = (n, w) => String(n).padStart(w || 2, '0');
  function undoStamp(d) {
    return d.getFullYear() + undoPad(d.getMonth() + 1) + undoPad(d.getDate()) + '-' +
      undoPad(d.getHours()) + undoPad(d.getMinutes()) + undoPad(d.getSeconds()) + '-' + undoPad(d.getMilliseconds(), 3);
  }
  function undoFmtTime(d) {
    return d.getFullYear() + '-' + undoPad(d.getMonth() + 1) + '-' + undoPad(d.getDate()) + ' ' +
      undoPad(d.getHours()) + ':' + undoPad(d.getMinutes()) + ':' + undoPad(d.getSeconds());
  }
  const UNDO_ID_RE = /^rec-\d{8}-\d{6}-\d{3}(-[a-z0-9]{4})?$/;
  function undoListDirs() {
    const root = undoRoot();
    let names = [];
    try { names = fs.readdirSync(root); } catch (e) { return []; }
    return names.filter(n => UNDO_ID_RE.test(n))
      .map(n => {
        let meta = null;
        try { meta = JSON.parse(fs.readFileSync(path.join(root, n, 'meta.json'), 'utf8')); } catch (e) { meta = null; }
        return { id: n, meta };
      })
      .filter(r => r.meta && typeof r.meta.ts === 'number')
      .sort((a, b) => b.meta.ts - a.meta.ts);
  }
  
  function undoPrune() {
    for (const r of undoListDirs().slice(UNDO_KEEP)) {
      try {
        fs.rmSync(path.join(undoRoot(), r.id), { recursive: true, force: true });
        appendLog('info', '注入撤销备份已裁剪（超出保留条数，永久删除）', { id: r.id });
      } catch (e) { appendLog('warn', '注入撤销备份裁剪失败', { id: r.id, message: String(e && e.message || e) }); }
    }
  }
  ipcMain.handle('undo-save', async (e, payload) => {
    try {
      const groups = Array.isArray(payload && payload.groups) ? payload.groups : [];
      if (!groups.length) return { ok: false, error: 'no groups' };
      const now = new Date();
      let id = 'rec-' + undoStamp(now);
      const root = undoRoot();
      if (fs.existsSync(path.join(root, id))) id += '-' + Math.random().toString(36).slice(2, 6);
      const dir = path.join(root, id);
      fs.mkdirSync(dir, { recursive: true });
      const metas = [];
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i] || {};
        if (!g.model) throw new Error('模型缺失：' + (g.title || g.cgroup || ('#' + i)));
        fs.writeFileSync(path.join(dir, i + '.model.json'), JSON.stringify(g.model), 'utf8');
        let hasThumb = false;
        const src = String(g.thumbPath || '');
        if (src && fs.existsSync(src)) {
          try { fs.copyFileSync(src, path.join(dir, i + '.thumb.webp')); hasThumb = true; }
          catch (err) { appendLog('warn', '注入撤销：缩略图备份失败', { file: src, message: String(err && err.message || err) }); }
        }
        metas.push({
          cgroup: String(g.cgroup || ''), header: String(g.header || ''), folder: String(g.folder || ''),
          title: String(g.title || ''), author: String(g.author || ''), thumbPath: src, hasThumb
        });
      }
      const meta = {
        id, ts: now.getTime(), time: undoFmtTime(now),
        account: payload && payload.account ? payload.account : null,
        groups: metas
      };
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
      undoPrune();
      appendLog('info', '注入撤销备份已保存', { id, groups: metas.length });
      return { ok: true, id, count: metas.length };
    } catch (err) {
      appendLog('error', '注入撤销备份失败', { message: String(err && err.message || err) });
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('undo-list', async () => {
    try {
      return {
        ok: true,
        records: undoListDirs().map(r => ({
          id: r.id, ts: r.meta.ts, time: r.meta.time,
          account: r.meta.account || null,
          count: (r.meta.groups || []).length,
          titles: (r.meta.groups || []).map(g => g.title || g.folder || '')
        }))
      };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
  ipcMain.handle('undo-read', async (e, payload) => {
    try {
      const id = String(payload && payload.id || '');
      if (!UNDO_ID_RE.test(id)) return { ok: false, error: 'bad id' };
      const dir = path.join(undoRoot(), id);
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
      const groups = (meta.groups || []).map((g, i) => {
        const out = Object.assign({}, g, {
          index: i,
          targetExists: !!(g.cgroup && fs.existsSync(g.cgroup) && g.header && fs.existsSync(g.header))
        });
        out.thumbDataUrl = '';
        try {
          const tp = path.join(dir, i + '.thumb.webp');
          if (fs.existsSync(tp)) {
            const buf = fs.readFileSync(tp);
            if (buf.length && buf.length <= 400 * 1024) out.thumbDataUrl = 'data:image/webp;base64,' + buf.toString('base64');
          }
        } catch (err) {  }
        return out;
      });
      return { ok: true, meta: { id: meta.id, ts: meta.ts, time: meta.time, account: meta.account || null }, groups };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
  ipcMain.handle('undo-read-model', async (e, payload) => {
    try {
      const id = String(payload && payload.id || '');
      const i = Number(payload && payload.index);
      if (!UNDO_ID_RE.test(id) || !(i >= 0)) return { ok: false, error: 'bad args' };
      const p = path.join(undoRoot(), id, i + '.model.json');
      return { ok: true, model: JSON.parse(fs.readFileSync(p, 'utf8')) };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
  
  ipcMain.handle('undo-restore', async (e, payload) => {
    const id = String(payload && payload.id || '');
    const results = [];
    try {
      if (!UNDO_ID_RE.test(id)) return { ok: false, error: 'bad id' };
      const dir = path.join(undoRoot(), id);
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
      const halfExtents = fzaCgroup.loadShapeHalfExtents(FZA_SYMBOLS);
      (meta.groups || []).forEach((g, i) => {
        const rec = { index: i, title: g.title || '', folder: g.folder || '' };
        try {
          if (!g.cgroup || !fs.existsSync(g.cgroup) || !g.header || !fs.existsSync(g.header)) {
            results.push(Object.assign(rec, { ok: false, missing: true, error: '原位置已不存在' }));
            return;
          }
          const model = JSON.parse(fs.readFileSync(path.join(dir, i + '.model.json'), 'utf8'));
          const r = fzaCgroup.writeCgroupFile(g.cgroup, model, halfExtents);
          
          const tp = path.join(dir, i + '.thumb.webp');
          let thumbOk = false;
          const dst = String(g.thumbPath || path.join(path.dirname(g.cgroup), 'thumb.webp'));
          if (fs.existsSync(tp) && dst && fs.existsSync(dst)) {
            try {
              const t0 = fs.statSync(dst, { bigint: true });
              fzaCgroup.writeFileInPlace(dst, fs.readFileSync(tp), { atimeNs: t0.atimeNs, mtimeNs: t0.mtimeNs, birthtimeNs: t0.birthtimeNs });
              thumbOk = true;
            } catch (err) { appendLog('warn', '注入撤销：缩略图还原失败', { file: dst, message: String(err && err.message || err) }); }
          }
          results.push(Object.assign(rec, { ok: true, layers: r.layers, thumbOk }));
        } catch (err) {
          results.push(Object.assign(rec, { ok: false, error: String(err && err.message || err) }));
        }
      });
      const restored = results.filter(r => r.ok).length;
      const missing = results.filter(r => r.missing).map(r => r.index);
      appendLog('info', '注入撤销执行完成', { id, restored, missing });
      return { ok: true, results, restored, missing };
    } catch (err) {
      appendLog('error', '注入撤销失败', { id, message: String(err && err.message || err) });
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  
  ipcMain.handle('app-flags', async () => ({
    testMode: !!process.env.SVGBIANJI_TEST,
    exeDir: appDataDir()
  }));
  
  ipcMain.handle('settings-get', async () => {
    try {
      const p = settingsPath();
      return { ok: true, settings: JSON.parse(fs.readFileSync(p, 'utf8')) };
    } catch (err) {
      return { ok: true, settings: {} };
    }
  });
  ipcMain.handle('settings-set', async (e, s) => {
    try {
      const p = settingsPath();
      fs.writeFileSync(p, JSON.stringify(s || {}, null, 2), 'utf8');
      return { ok: true, settings: s || {} };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  
  ipcMain.handle('update-install', async (e, payload) => {
    const url = payload && payload.exeUrl;
    if (!url) return { ok: false, error: 'no-asset' };
    if (!app.isPackaged) return { ok: false, error: 'dev' };
    const sender = e.sender;
    const sendPct = (pct, got, total) => {
      try { if (sender && !sender.isDestroyed()) sender.send('update-progress', { pct: pct, got: got || 0, total: total || 0 }); }
      catch (err) {  }
    };
    const exePath = portableExePath();
    if (!exePath) return { ok: false, error: 'no-exe-path' };
    const tmp = path.join(path.dirname(exePath), 'update-' + Date.now() + '.exe');
    try {
      appendLog('info', '自动更新：开始下载', { url: String(url).slice(0, 120), to: tmp });
      
      let lastErr = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await downloadToFile(url, tmp, sendPct);
          lastErr = null;
          if (attempt > 1) appendLog('info', '自动更新：重试成功', { attempt: attempt });
          break;
        } catch (err) {
          lastErr = err;
          appendLog('warn', '自动更新：下载失败', { attempt: attempt, message: String(err && err.message || err).slice(0, 140) });
          try { fs.unlinkSync(tmp); } catch (e2) {  }
          if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
        }
      }
      if (lastErr) throw lastErr;
      
      const chk = checkExePackage(tmp);
      if (!chk.ok) {
        try { fs.unlinkSync(tmp); } catch (e2) {  }
        appendLog('warn', '自动更新：安装包校验未通过', chk);
        return { ok: false, error: 'bad-package', detail: chk.error };
      }
      appendLog('info', '自动更新：安装包校验通过，安排退出后替换', { size: chk.size, byContent: chk.byContent });
      scheduleExeReplace(tmp, exePath);
      setTimeout(() => { try { app.exit(0); } catch (e2) {  } }, 400);
      return { ok: true, size: chk.size };
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch (e2) {  }
      appendLog('warn', '自动更新失败', { message: String(err && err.message || err).slice(0, 200) });
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  
  ipcMain.handle('update-pick-exe', async (e, payload) => {
    if (!app.isPackaged) return { ok: false, error: 'dev' };
    const exePath = portableExePath();
    if (!exePath) return { ok: false, error: 'no-exe-path' };
    let src = '';
    
    const forced = (process.env.SVGBIANJI_TEST && payload && payload.file) ? String(payload.file) : '';
    if (forced) {
      src = forced;
    } else {
      const win = BrowserWindow.fromWebContents(e.sender);
      let r;
      try {
        r = await dialog.showOpenDialog(win, {
          title: dt('dlg.pickExe'),
          filters: [{ name: dt('dlg.filterExe'), extensions: ['exe'] }],
          properties: ['openFile']
        });
      } catch (err) {
        return { ok: false, error: String(err && err.message || err).slice(0, 160) };
      }
      if (!r || r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
      src = r.filePaths[0];
    }
    if (path.resolve(src).toLowerCase() === path.resolve(exePath).toLowerCase()) {
      return { ok: false, error: 'same-file' };
    }
    const chk = checkExePackage(src);
    if (!chk.ok) {
      appendLog('warn', '手动安装：所选文件校验未通过', { file: path.basename(src), error: chk.error });
      return { ok: false, error: chk.error };
    }
    const tmp = path.join(path.dirname(exePath), 'update-manual-' + Date.now() + '.exe');
    try {
      
      moveIntoPlace(src, tmp);
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch (e2) {  }
      appendLog('warn', '手动安装：搬移安装包失败', { message: String(err && err.message || err).slice(0, 160) });
      return { ok: false, error: String(err && err.message || err).slice(0, 160) };
    }
    appendLog('info', '手动安装：已搬入本地安装包（源文件已移除），安排退出后替换',
      { file: path.basename(src), size: chk.size });
    try {
      scheduleExeReplace(tmp, exePath);
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch (e2) {  }
      return { ok: false, error: String(err && err.message || err).slice(0, 160) };
    }
    setTimeout(() => { try { app.exit(0); } catch (e2) {  } }, 400);
    return { ok: true, size: chk.size };
  });

  
  ipcMain.handle('update-open-repo', async () => {
    let url = 'https://github.com';
    try {
      const t = require('./update-check').readRepo();
      if (t && t.owner && t.repo) url = 'https://github.com/' + t.owner + '/' + t.repo;
    } catch (e) {  }
    appendLog('info', '自动更新失败：打开仓库页', { url: url });
    try { await shell.openExternal(url); return { ok: true, url: url }; }
    catch (e) { return { ok: false, error: String(e && e.message || e), url: url }; }
  });

  
  const FONT_RE = /^[a-z0-9_-]{1,40}\.(ttf|otf|ttc|woff2?)$/i;
  ipcMain.handle('font-import', async (e) => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender);
      const r = await dialog.showOpenDialog(win, {
        title: '导入字体包',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'ttc', 'woff', 'woff2'] }]
      });
      if (!r || r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
      const dir = path.join(appDataDir(), 'fonts');
      fs.mkdirSync(dir, { recursive: true });
      const items = [];
      for (const src of r.filePaths) {
        const ext = path.extname(src).toLowerCase();
        if (!/^\.(ttf|otf|ttc|woff2?)$/.test(ext)) continue;
        const id = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const file = id + ext;
        try { fs.copyFileSync(src, path.join(dir, file)); }
        catch (err) { appendLog('warn', '字体导入复制失败', { name: path.basename(src), message: String(err && err.message || err).slice(0, 160) }); continue; }
        let family = null;
        try { family = require('./font-name').readFamilyName(fs.readFileSync(src)); } catch (err) { family = null; }
        items.push({ id: id, file: file, family: family || path.basename(src, ext), srcName: path.basename(src) });
      }
      return { ok: items.length > 0, items: items };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('font-delete', async (e, payload) => {
    const file = payload && payload.file;
    if (!file || !FONT_RE.test(file)) return { ok: false, error: 'bad-name' };
    try {
      fs.unlinkSync(path.join(appDataDir(), 'fonts', file));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('font-open-download', async () => {
    try { await shell.openExternal('https://www.100font.com/'); return { ok: true }; }
    catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
  
  ipcMain.handle('file-save-work', async (e, payload) => {
    try {
      const r = workcopyStore.save(payload && payload.content, payload && payload.source,
        ensureDataDir(DATA_DIRS.workcopy), uiLang());
      
      if (r && r.ok) {
        dropWorkcopyThumbs([r.name, (payload && payload.source && payload.source.name) || '']);
      }
      return r;
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
      try { uiLang = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')).lang || null; } catch (err3) {  }
      const name = resolveAutoSaveName(kind, payload && payload.fileName, n => fs.existsSync(path.join(dir, n)), undefined, uiLang);
      const fp = path.join(dir, name);
      
      let prevStat = null;
      if (kind === 'svg') { try { prevStat = fs.statSync(fp); } catch (err4) { prevStat = null; } }
      fs.writeFileSync(fp, String(payload && payload.content || ''), 'utf8');
      if (kind === 'svg' && prevStat) {
        try {
          const k = crypto.createHash('sha1').update('thumb-v9-480\0' + fp + '\0' + prevStat.size + '\0' + prevStat.mtimeMs).digest('hex');
          await fs.promises.unlink(path.join(app.getPath('userData'), 'svg-thumb-cache', k + '.png'));
        } catch (err5) {  }
      } else if (kind !== 'svg') {
        dropWorkcopyThumbs([name]);
      }
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
  
  ipcMain.handle('home-open-folder', async () => {
    const dir = ensureDataDir(DATA_DIRS.svg);
    try {
      const err = await shell.openPath(dir);
      if (err) {
        
        try { shell.showItemInFolder(dir); } catch (e2) {  }
        appendLog('warn', '打开 SVGImages 目录失败', { dir: dir, error: String(err).slice(0, 160) });
        return { ok: false, error: String(err), dir: dir };
      }
      return { ok: true, dir: dir };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err), dir: dir };
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
          } catch (err3) {  }
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
      
      const ns = String(payload && payload.cacheNs || '');
      const identity = payload && payload.cacheIdentity;
      const key = (ns && identity != null)
        ? crypto.createHash('sha1').update(String(identity)).digest('hex') : '';
      const cachePath = key ? genericThumbPath(ns, key) : null;
      
      if (key && ns === WORKCOPY_THUMB_NS && identity != null) {
        rememberWorkcopyThumbKey(String(identity).split('\u0000')[0], key);
      }
      if (cachePath && await readGenericThumb(cachePath)) {
        return { ok: true, url: genericThumbUrl(ns, key), cached: true };
      }
      const rendered = await enqueueThumbRender(cachePath ? { text, cachePath } : { text });
      if (cachePath && rendered && rendered.saved) return { ok: true, url: genericThumbUrl(ns, key), cached: false };
      const url = String(rendered && rendered.url || '');
      if (!url) throw new Error('缩略图生成结果为空');
      if (cachePath && await writeGenericThumb(cachePath, url)) {
        return { ok: true, url: genericThumbUrl(ns, key), cached: false };
      }
      return { ok: true, url };
    } catch (err) {
      appendLog('warn', '独立缩略图生成失败', { message: String(err && err.message || err).slice(0, 300) });
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  
  ipcMain.handle('svg-thumb-cache-get', async (e, payload) => {
    try {
      const ns = String(payload && payload.ns || '');
      const rows = Array.isArray(payload && payload.keys) ? payload.keys : [payload && payload.key];
      const hits = [];
      for (const k of rows) {
        const key = String(k || '').toLowerCase();
        if (!/^[a-f0-9]{40}$/.test(key)) continue;
        const p = genericThumbPath(ns, key);
        if (p && await readGenericThumb(p)) hits.push(key);
      }
      return { ok: true, hits, urls: hits.map(k => genericThumbUrl(ns, k)) };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('svg-thumb-cache-put', async (e, payload) => {
    try {
      const ns = String(payload && payload.ns || '');
      const key = String(payload && payload.key || '').toLowerCase();
      if (!/^[a-f0-9]{40}$/.test(key)) return { ok: false, error: '缓存 key 无效' };
      const saved = await writeGenericThumb(genericThumbPath(ns, key), payload && payload.dataUrl);
      return { ok: saved, url: saved ? genericThumbUrl(ns, key) : '' };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  
  ipcMain.handle('svg-thumb-cache-drop', async (e, payload) => {
    try {
      const ns = String(payload && payload.ns || '');
      const keys = Array.isArray(payload && payload.keys) ? payload.keys : [];
      if (!keys.length) return { ok: await dropGenericThumbNamespace(ns) };
      let n = 0;
      for (const k of keys) { if (await dropGenericThumb(ns, String(k || ''))) n++; }
      return { ok: true, dropped: n };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  
  ipcMain.handle('lib-asset-ver', async () => {
    try {
      const parts = [];
      for (const rel of ['assets/FH6_Vinyl_Symbols.svg', 'assets/FH6_Vinyl_Patterns.svg']) {
        const st = await fs.promises.stat(path.join(__dirname, rel));
        parts.push(Math.round(st.mtimeMs) + ':' + st.size);
      }
      return { ok: true, ver: parts.join('|') };
    } catch (err) {
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
      
      let prevStat = null;
      if (exists) { try { prevStat = fs.statSync(p); } catch (err2) { prevStat = null; } }
      
      if (exists && name !== String(payload && payload.sourceName || '')) {
        if (!(await askOverwrite(name))) return { ok: false, canceled: true };
      }
      if (exists && (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== previous))
        return { ok: false, error: dt('dlg.fileChanged') };
      atomicWrite(p, content, exists);
      
      if (exists && prevStat) {
        try {
          const oldKey = crypto.createHash('sha1')
            .update('thumb-v9-480\0' + p + '\0' + prevStat.size + '\0' + prevStat.mtimeMs).digest('hex');
          await fs.promises.unlink(path.join(app.getPath('userData'), 'svg-thumb-cache', oldKey + '.png'));
        } catch (err) { if (!err || err.code !== 'ENOENT') appendLog('warn', '旧缩略图缓存清理失败', { message: String(err && err.message || err).slice(0, 160) }); }
      }
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
      if (kind === 'workcopy') {
        workcopyStore.renamed(oldP, newP);
        
        dropWorkcopyThumbs([oldName]);
      }
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
      
      let st = null;
      if (kind === 'svg') { try { st = fs.statSync(fp); } catch (err2) { st = null; } }
      fs.unlinkSync(fp);
      
      try { fs.unlinkSync(fp + '.bak'); } catch (e) {  }
      
      if (kind === 'svg' && st) {
        try {
          const k = crypto.createHash('sha1').update('thumb-v9-480\0' + fp + '\0' + st.size + '\0' + st.mtimeMs).digest('hex');
          fs.unlinkSync(path.join(app.getPath('userData'), 'svg-thumb-cache', k + '.png'));
        } catch (e) {  }
      } else if (kind === 'workcopy') {
        dropWorkcopyThumbs([name]);
      }
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
