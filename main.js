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
const DLG = require('./dlg-i18n');   /* 原生对话框文案（主进程侧 i18n） */

/* 当前界面语言：读 userData/settings.json（渲染层改设置时由 settings-set 写入）。
   原生对话框由 OS 渲染，标题/按钮/过滤器名只能由主进程按此语言传入。 */
function uiLang() {
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return DLG.dicts[s && s.lang] ? s.lang : 'zh-CN';
  } catch (e) { return 'zh-CN'; }
}
function dt(key, params) { return DLG.get(uiLang(), key, params); }
/* 命名 / 标签词典（与渲染层共用同一份 js/name-i18n.js）。 */
const NAME_I18N = require('./js/name-i18n');
function nt(key, params) { return NAME_I18N.get(uiLang(), key, params); }

/* 数据根目录 = exe 所在目录（便携式：整个文件夹拷走数据跟着走）。
   ★ portable 单文件版的坑：exe 启动时先自解压到 %TEMP%\<随机目录> 再运行，
     app.getPath('exe') 拿到的是**那个临时目录**，不是用户双击的 exe。
     直接拿它当根 → SVGImages / WorkCopies 全建在临时目录里，退出即被清掉，
     用户看到的现象就是「exe 所在目录一干二净、刚存的东西下次打开全没了」。
     electron-builder 为 portable 提供了 PORTABLE_EXECUTABLE_DIR（= 用户双击的 exe 所在目录），
     优先用它；目录版（win-unpacked）没有这个变量，回退到 exe 自身目录，行为不变。
   目录只首次创建（不存在才建），路径缓存后直接复用——不重复创建。
   ★ 本函数必须定义在文件最前面：下面要用它给 Chromium 的 userData 重定向，
     而 userData 必须在 requestSingleInstanceLock / app ready 之前定下来。 */
const _dataDirs = {};
function appDataDir() {
  let base;
  if (!app.isPackaged) base = __dirname;
  else base = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe'));
  if (!_dataDirs.__base) {
    if (!fs.existsSync(base)) { try { fs.mkdirSync(base, { recursive: true }); } catch (e) { /* ignore */ } }
    _dataDirs.__base = base;
  }
  return _dataDirs.__base;
}

/* ---------- 自动更新用：下载到文件（走 Electron net，自动处理系统代理/证书） ----------
   带进度回调 onPct(pct, got, total)。失败一律删掉半截文件，绝不留一个坏的 exe 在数据目录里。
   2026-10-29 修的四个坑（都来自「更新卡在 0% / 软件自己没了」）：
     ① 写盘流的 error 没人接 ⇒ 未捕获异常，主进程直接崩（表现就是更新到一半软件自己关了）；
     ② 没有空闲超时 ⇒ 网络卡住时进度永远停在某个数字，窗口也没法给用户任何提示；
     ③ 不校验长度 ⇒ 半截 exe 也能"下载成功"，覆盖后软件就启动不了；
     ④ 写盘不控背压 ⇒ 92MB 全堆内存里。
   ★ 下载慢不是 bug：GitHub 的 release 附件在本机实测只有 100~220KB/s（92MB≈7~16 分钟），
     所以进度条必须**同时给百分比和「已下/总量」**，否则用户只会看到长期停在 0~1%。 */
const DL_IDLE_MS = 45000;      /* 连续 45s 没有任何数据 ⇒ 判定卡死 */
function downloadToFile(url, dest, onPct) {
  return new Promise((resolve, reject) => {
    let out;
    try { out = fs.createWriteStream(dest); } catch (e) { reject(e); return; }
    let req = null;
    let settled = false;
    let idleTimer = null;
    const report = (pct, got, total) => {
      try { if (typeof onPct === 'function') onPct(pct, got, total); } catch (e) { /* ignore */ }
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (idleTimer) { try { clearTimeout(idleTimer); } catch (e) { /* ignore */ } idleTimer = null; }
      try { out.destroy(); } catch (e) { /* ignore */ }
      try { fs.unlinkSync(dest); } catch (e) { /* ignore */ }
      reject(err);
    };
    /* ① 写盘出错必须显式接住（磁盘满 / 目录被占用 / 权限） */
    out.on('error', fail);
    try { req = net.request({ method: 'GET', url: String(url), redirect: 'follow' }); }
    catch (e) { fail(e); return; }
    try { req.setHeader('User-Agent', 'VinylFH6-Updater'); } catch (e) { /* ignore */ }
    /* ② 空闲看门狗：每次收到数据就重置；超时主动 abort 并报错，绝不无限挂着 */
    const armIdle = () => {
      if (idleTimer) { try { clearTimeout(idleTimer); } catch (e) { /* ignore */ } }
      idleTimer = setTimeout(() => {
        try { req.abort(); } catch (e) { /* ignore */ }
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
        /* ④ 背压：写不动就先停住响应流，等 drain 再继续 */
        if (ok === false) {
          try { res.pause(); } catch (e) { /* ignore */ }
          out.once('drain', () => { try { res.resume(); } catch (e) { /* ignore */ } });
        }
        if (total) report(Math.min(99, Math.round(got / total * 100)), got, total);
        else report(0, got, total);          /* 没给 content-length：至少把字节数报上去 */
      });
      res.on('end', () => {
        if (idleTimer) { try { clearTimeout(idleTimer); } catch (e) { /* ignore */ } idleTimer = null; }
        /* ③ 长度对不上 = 传输被截断，宁可失败也不能覆盖出一个坏 exe */
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

/* 单实例锁：重复启动时聚焦已有窗口，避免共享缓存冲突导致界面异常。
   SVGBIANJI_ISOLATE=1（CDP 自动化验证用）：跳过单实例锁并用独立 userData，
   可与用户已开的正式实例并存，避免缓存/锁冲突 */
const ISOLATE = process.env.SVGBIANJI_ISOLATE === '1';
if (ISOLATE) {
  /* SVGBIANJI_ISOLATE_DIR：可指定固定的隔离目录（自动化测试用）——
     默认按 pid 生成，每次都换；指定固定值后跨次保留，才能测「启动守卫」的连续失败计数。 */
  const isoDir = process.env.SVGBIANJI_ISOLATE_DIR || path.join(os.tmpdir(), 'svgbianji-cdp-' + process.pid);
  app.setPath('userData', isoDir);
} else {
  /* ★ C 盘零占用：Chromium 的 userData（Cache / GPUCache / Local Storage / Cookies /
     Preferences / svg-thumb-cache / IndexedDB）默认落在 %APPDATA%\<包名>，也就是 C 盘。
     这里把它整体挪到 exe 旁边的 _userdata\，做到「整个文件夹拷走，C 盘不留任何东西」。
     必须在 requestSingleInstanceLock 和 app ready 之前调用，
     否则单实例锁与 Chromium 会先按旧路径建好目录，改了也不生效。 */
  try { app.setPath('userData', path.join(appDataDir(), '_userdata')); } catch (e) { /* ignore */ }
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

/* GPU 渲染优化：显式启用 GPU 光栅化与合成（大量 SVG 图层/大分组时渲染更流畅），
   并忽略显卡黑名单（部分集显/驱动被 Chromium 默认列入软件渲染）。 */
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-zero-copy');
/* GPU 进程沙箱：部分 Windows 机器（安全软件 / 驱动限制）下 GPU 子进程根本起不来 ——
   Chromium 连试几次后报「GPU process isn't usable」→ 整个界面退回软件渲染（CPU 画一切），
   表现就是「不流畅」。关掉 GPU 进程沙箱后实测能拿到真显卡（ANGLE/D3D11）。
   （渲染进程沙箱不受影响，只影响 GPU 进程。） */
app.commandLine.appendSwitch('disable-gpu-sandbox');
/* 优先独显：把 DXGI 的「高性能」偏好交给 GPU 进程 —— 双显卡机器上选独显（NVIDIA / AMD），
   只有核显时自动用核显（Intel / AMD APU），无需按厂商分别处理。
   注：等于给本程序开 Windows 的「图形设置 → 高性能」，笔记本上会稍费电。 */
app.commandLine.appendSwitch('force-high-performance-gpu');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

/* 关闭确认：是否已决定退出（跳过二次确认） */
let forceClose = false;

/* 主页重型 SVG 缩略图在独立 renderer 中生成。复杂文件即使含数千图层，
   也不会再占住编辑器 renderer 的事件循环。 */
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
      /* 仅加载本地只读渲染页。不要与主窗口同时启动第二个 sandbox preload：
         Electron/Windows 偶发 startupData=null，会把主 renderer 一并销毁。 */
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
  /* v7：缩略图取景放宽到内容框（修「保存的 svg 卡片缩略图显示不完全」）——版本号必须升，
     否则旧版本号算出的磁盘缓存不会失效，用户看不到修复效果。
     v8：画稿只占画布一小部分时按内容盒重取景（修「极限竞速.1800.svg 缩略图很糊」）——
     同理必须再升一版，否则用户手里那份 v7 的糊图会一直被命中。
     v9：内容盒改用真实可见范围（α>8），不再拿 α>200 的实心核心当盒
     （修「缩略图显示溢出 / 半透明被显示成不透明」）——同理必须再升一版。 */
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
    /* 重型源文件和 PNG 都不经过主界面。隐藏 renderer 直接读 SVG、异步编码并
       写入缓存，主进程只传两个短路径，避免 base64 回传造成可见停顿。 */
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

/* ---------- 通用缩略图磁盘缓存 ----------
   主页 svg 卡片那条路（renderSvgThumbFile）自带一套缓存，key 由主进程从源文件
   stat 直接算出。工作进程卡（内容在内存里，源文件是 .svework 的 JSON）与
   「彩绘纹饰」面板（源是 48.9MB 素材里的内嵌 JPEG）没有"主进程可以 stat 的源路径"，
   所以这里给它们一套通用的：**由渲染层按「内容身份」算 key 传进来**，
   主进程只负责「按 key 查文件 / 写文件 / 删文件」，不关心 key 是怎么来的。

   ★ key 必须包含「内容版本」：工作进程用 name@mtime，素材用 素材文件 mtime。
     否则文件更新后仍旧命中旧图 —— 这正是本功能要解决的问题。 */
const GENERIC_THUMB_DIR = 'thumb-cache';       /* userData/thumb-cache/<ns>/<key>.png */
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
/* 缓存图 URL 约定与主页那条一致：app://thumb-cache/<ns>/<key>.png（同一个协议处理器） */
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
/* 缓存失效：删掉一个 key 的缓存图（文件不存在不算错） */
async function dropGenericThumb(ns, key) {
  const p = genericThumbPath(ns, key);
  if (!p) return false;
  try { await fs.promises.unlink(p); return true; }
  catch (err) { return !!(err && err.code === 'ENOENT'); }
}
/* 批量失效：删掉整个命名空间目录（素材文件换版本时用） */
async function dropGenericThumbNamespace(ns) {
  const dir = genericThumbDir(ns);
  if (!dir) return false;
  try { await fs.promises.rm(dir, { recursive: true, force: true }); return true; }
  catch (err) { return false; }
}

/* 工作进程卡 / 锚点卡的缩略图命名空间。
   ★ 必须与渲染层 js/fza.js 的 App.WORKCOPY_THUMB_NS 一致。
   渲染层把「名字\0mtime」当身份串，主进程按同一套 sha1 算 key。
   要删某个文件的历史缓存时，我们并不知道它曾被哪些 mtime 渲染过，
   所以这里换一种做法：**按名字扫目录下的 key 无法反查**（sha1 单向）→
   改为「记住名字→当前 key」，即渲染层渲染时回报、主进程落一份 name→key 索引。
   更简单的等价做法：**删除该命名空间下所有「属于这个名字」的缓存**由渲染层负责
   （它知道自己刚算过什么 key）；主进程这边只提供「按键删」与「整空间清」。 */
const WORKCOPY_THUMB_NS = 'workcopy-thumb-v2';

/* 渲染层回报：某个名字当前对应的缓存 key 列表（一次渲染可能产生多张，但同名同版本只有一张）。
   主进程维护一个轻量索引文件 name → [key]，用于「文件更新后立刻删掉旧图」。 */
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
  } catch (err) { /* 索引只是清理用，写失败不影响功能 */ }
}
function rememberWorkcopyThumbKey(name, key) {
  const n = String(name || '');
  if (!n || !/^[a-f0-9]{40}$/.test(String(key || ''))) return;
  const idx = readWorkcopyThumbIndex();
  const list = Array.isArray(idx[n]) ? idx[n] : [];
  if (list.indexOf(key) < 0) list.push(key);
  idx[n] = list.slice(-8);            /* 每个名字只留最近 8 个历史 key，够用 */
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

/* ---------- 日志（内存环形缓冲，最多 3000 条）：记录关键操作/错误/性能/鼠标点击事件。
   不点「保存日志」不写磁盘——开源给别人用时不会在电脑上越积越多 ---------- */
const LOG_MAX = 3000;
const logBuf = [];
let logSavedPath = null;
/* appDataDir() / _dataDirs 已在文件最前面定义（userData 重定向要用到，见文件开头）。 */
/* 设置文件（语言 / 主题 / WASD 与方向键速率 / 收藏 / 快捷键）也跟随 exe，
   与 SVGImages / WorkCopies 同一约定。
   以前放 app.getPath('userData') = %APPDATA%\<app.getName()>：包名一改
   （开发期在 svgbianji / vinylfh6 / fh6-vinyl-group-editor 之间换过好几次）
   目录就换一个，用户看到的现象是「语言、主题、速率、收藏全部回到默认」；
   而 js/settings.js 的 localStorage 兜底也在同一个 userData 里，所以兜不住。
   放 exe 旁边后，包名随便改、整个文件夹拷走，设置都跟着走。 */
function settingsPath() { return path.join(appDataDir(), 'settings.json'); }
/* 工作环境文件夹统一用英文名。旧中文名在首次访问时自动改名迁移（仅当新目录不存在、
   旧目录存在），既有文件不丢；改名失败则退回继续使用旧目录，绝不主动删用户数据。 */
const DATA_DIRS = {
  svg: 'SVGImages',
  workcopy: 'WorkCopies',
  history: 'WorkCopiesHistory',
  logs: 'sve-logs',
  /* 注入撤销备份（最近 3 次注入前被覆盖的分组原文件）。
     跟随 exe 的可见目录，用户能自己查看/备份/清理，与上面几个目录同一约定。 */
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
      } catch (e) { /* 改名失败（占用/权限）：下面退回旧目录，数据照常可见 */ }
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
  } catch (e) { /* 日志失败不影响主流程 */ }
}
/* 把内存缓冲写入日志文件（用户点「保存日志」时调用），返回文件路径 */
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

/* 软件名(对话框标题/文案用):优先 package.json(build.productName / productName;dev 下 app.getName() 会返回包名) */
function appName() {
  try {
    const pkg = require('./package.json');
    const n = (pkg && (pkg.productName || (pkg.build && pkg.build.productName))) || '';
    if (n) return n;
  } catch (e) { /* ignore */ }
  try { return app.getName() || 'FH6 Vinyl Group Editor'; } catch (e) { return 'FH6 Vinyl Group Editor'; }
}
/* 文件名上限(过长由后端截断加 …) */
function clipDocName(name, max) {
  const s = String(name == null || name === '' ? nt('name.untitled') : name);
  const m = max || 30;
  return s.length > m ? s.slice(0, m) + '…' : s;
}
/* 关闭确认窗:标题=软件名;正文=要在关闭之前存储对 <软件名> 文档"<文件名>"的更改吗？;按钮 是/否/取消
   是=保存工作进程到软件内(不弹文件对话框) / 否=不保存 / 取消=不关闭 */
async function askCloseDoc(win, docName) {
  /* 测试桩:SVGBIANJI_DIALOG_STUB=save|dont|cancel —— 打印对话框参数并直接返回(供自动化验证) */
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
/* 覆盖已有文件前的确认。测试桩与关闭确认窗同一套约定：
   SVGBIANJI_NO_CONFIRM=1 → 视为已确认；SVGBIANJI_DIALOG_STUB=save|dont|cancel → 按桩返回 */
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
/* 关闭软件:委托渲染层逐个标签确认(全部处理完才真正关闭) */
async function confirmClose(win) {
  if (process.env.SVGBIANJI_NO_CONFIRM === '1') { forceClose = true; win.close(); return; }
  let ok = true;
  try {
    ok = await win.webContents.executeJavaScript(
      '(async () => (typeof App !== "undefined" && App.Tabs && App.Tabs.closeAllTabsGuard) ? await App.Tabs.closeAllTabsGuard() : true)()'
    );
  } catch (err) {
    ok = true; /* 渲染进程不可用:直接关闭 */
  }
  if (ok === false) return; /* 用户取消:留在软件内 */
  await saveHistAnchorBeforeClose(win);
  forceClose = true;
  win.close();
}

/* 关闭前保存一次工作锚点：画布有内容才保存（空画布不产生无用锚点） */
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
  } catch (err) { /* 渲染进程不可用：忽略 */ }
}

/* ---------- 自绘标题栏的窗口控制（UI 改良 C 项） ----------
   安全口径：
   · 动作是**白名单**（minimize / toggle-maximize / close），不是任意 IPC 通道转发；
   · 目标窗口**只能来自发送方自身**（BrowserWindow.fromWebContents），
     渲染层无法指定别的窗口，也无法调用 Electron 任意 API；
   · 关闭**必须走 win.close()**，从而复用既有 close → confirmClose(win) 链，
     不提供 destroy()/app.quit() 之类绕过未保存确认的捷径；
   · 最大化/还原后回推真实状态，保证按钮图标与系统实际状态一致
     （首次加载、系统快捷键改窗口状态也都覆盖）。 */
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
  } catch (err) { /* 渲染进程已销毁：忽略 */ }
}

ipcMain.handle('window-control', (e, action) => {
  const win = windowCtlTarget(e);
  if (!win) return { ok: false, error: 'no-window' };
  const act = String(action || '');
  if (!WIN_CTL_ACTIONS[act]) return { ok: false, error: 'bad-action' };
  try {
    if (act === 'minimize') win.minimize();
    else if (act === 'toggle-maximize') { win.isMaximized() ? win.unmaximize() : win.maximize(); }
    else win.close();   /* ← 走既有关闭确认链，勿改成 destroy/quit */
    return { ok: true, maximized: win.isMaximized() };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
});

/* 首次加载时渲染层主动问一次当前状态（避免开窗即最大化/还原态图标不同步） */
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
    /* 自绘标题栏：frame:false 去掉 Windows 系统边框与原生标题栏，
       最小化 / 最大化-还原 / 关闭 三个动作改由页面内的 #titleBar 提供
       （js/titlebar.js + preload 的 windowControl / windowStateGet / onWindowState，
        IPC 白名单见本文件上面的 window-control / window-state-get）。
       窗口标题走 title（dt('app.title')，自绘栏的文字也从它读），图标走下面的 icon。
       frameless 下窗口仍可拖边缩放（Chromium 保留了 WS_THICKFRAME 的命中区）。 */
    frame: false,
    icon: path.join(__dirname, 'icons', 'app-icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      /* Electron 43/Windows 的 sandbox startupData 传输会偶发返回 null，导致整个
         renderer 在 preload 前崩溃。页面仍保持 contextIsolation + 无 Node 权限。 */
      sandbox: false,
      /* 测试模式下禁用后台节流：窗口被遮挡/最小化时 rAF 与定时器照常运行，
         否则闪动动画（rAF 驱动）可能整段冻结，冒烟测试偶发失败 */
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
    if (forceClose) return; // 已决定退出
    e.preventDefault();
    confirmClose(win);
  });
  win.on('closed', () => destroyThumbRenderer());
  /* 自绘标题栏：最大化/还原状态变化后回推给渲染层（含系统快捷键、双击标题栏、吸附拖动） */
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
  /* 启动后异步检查 GitHub 有没有新版本（内部延迟 8s + 全程静默失败，绝不打扰用户；
     package.json 没配 repository 就自动跳过）。见 update-check.js */
  try {
    require('./update-check').check({
      onLog: appendLog,
      t: dt,
      /* 发现新版本：交给渲染层的软件窗口展示（不再用系统原生弹窗）。
         窗口还没建好就等一小会儿重试，避免开机那一下把通知丢了。 */
      onAvailable: function (info) {
        const push = (tries) => {
          const w = BrowserWindow.getAllWindows().find(x => !x.isDestroyed());
          if (w && w.webContents && !w.webContents.isLoading()) {
            try { w.webContents.send('update-available', info); return; } catch (e) { /* ignore */ }
          }
          if (tries > 0) setTimeout(() => push(tries - 1), 1000);
        };
        push(20);
      }
    });
  }
  catch (e) { appendLog('warn', '更新检查模块加载失败（已忽略）', { message: String(e && e.message || e).slice(0, 160) }); }

  /* 便携式：启动时确保 exe 目录下所需文件夹存在（仅首次创建，之后直接复用） */
  try {
    /* 「已保存彩绘」目录无任何入口写入，不创建也不引用 */
[DATA_DIRS.history, DATA_DIRS.logs, DATA_DIRS.workcopy, DATA_DIRS.svg].forEach(n => ensureDataDir(n));
  } catch (e) { /* ignore */ }
  /* 上次自动更新把旧 exe 改名成 *.old.exe 留在原地：那时它还在运行，删不掉；
     现在新进程起来了，顺手清掉（删不掉也不影响使用）。 */
  try {
    const exePath = process.env.PORTABLE_EXECUTABLE_FILE || (app.isPackaged ? app.getPath('exe') : '');
    if (exePath) {
      const dir = path.dirname(exePath);
      fs.readdirSync(dir).forEach(n => {
        if (/\.old\.exe$/i.test(n)) { try { fs.unlinkSync(path.join(dir, n)); } catch (e) { /* ignore */ } }
      });
    }
  } catch (e) { /* ignore */ }
  protocol.handle('app', (request) => {
    const u = new URL(request.url);
    if (u.hostname === 'thumb-cache') {
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      /* 两条命名的缓存：
         ① 主页 svg 卡：`<sha1>.png`（源文件 stat 算出的，沿用旧路径，不动）；
         ② 通用缓存：`<命名空间>/<sha1>.png`（工作进程卡 / 彩绘纹饰面板，见 genericThumbPath）。
         两处都严格校验形状，防目录穿越。 */
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
    /* 用户导入的界面字体：存在数据目录（便携版 = exe 目录）的 fonts/ 下，
       不在 app 根里，所以单独一条路由（形状严格校验，防目录穿越）。 */
    if (u.hostname === 'fonts') {
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
      if (!/^[a-z0-9_-]{1,40}\.(ttf|otf|ttc|woff2?)$/i.test(rel)) return new Response('forbidden', { status: 403 });
      const fp = path.join(appDataDir(), 'fonts', rel);
      /* 字体是 CORS 受限资源（跨 host 的 @font-face 必须带 ACAO，否则加载被拒）。
         这里直接读字节返回，顺便给出正确的 Content-Type —— 用 net.fetch 转发拿不到这两个头。 */
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

  /* 工作副本：图案 + 背景图片（含变换）+ 历史颜色等的无损保存/读取 */
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


  /* 历史工作锚点：exe 目录下的「历史工作副本」文件夹（便携式，仅首次创建）。
     定时保存的间隔/启用由渲染层读用户设置控制；这里的上限也读同一份设置
     （默认 15 分钟 / 最多 15 个 = 需求指定默认）。 */
  function histAnchorDirPath() {
    return ensureDataDir(DATA_DIRS.history);
  }
  /* 锚点保留上限：读 settings.json 的 autoSave.limit。
     读不到 / 非法值 → 默认 15（与「设置」窗口里的默认一致）。
     范围 1-1000：坏值一律不采信，避免 0 或负数把清理循环变成「删掉全部」。 */
  function histAnchorLimit() {
    try {
      const s = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
      const n = Number(s && s.autoSave && s.autoSave.limit);
      if (isFinite(n) && n >= 1 && n <= 1000) return Math.round(n);
    } catch (err) { /* 未设置过 / 文件损坏：用默认 */ }
    return 15;
  }
  const pad2 = n => String(n).padStart(2, '0');
  function histAnchorName(d) {
    return '锚点-' + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '-' +
      pad2(d.getHours()) + '-' + pad2(d.getMinutes()) + '-' + pad2(d.getSeconds()) + '.svework';
  }
  /* 从锚点文件名解析系统显示时间（例：2026-08-21 18:30:05） */
  function histAnchorTime(name) {
    const m = /^锚点-(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})(?:-\d+)?\.svework$/.exec(name || '');
    if (!m) return name || '';
    const p = m[1].split('-'); // [年, 月, 日, 时, 分, 秒]
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
      /* 保留上限来自用户设置（默认 15）：超出删除最早的 */
      const files = fs.readdirSync(dir).filter(f => /^锚点-.*\.svework$/.test(f)).sort();
      const limit = histAnchorLimit();
      while (files.length > limit) {
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

  /* ---------- Forza 游戏存档整合（Inkscape2Forza 功能；写入前需经渲染层确认+风险提示） ---------- */
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
  /* 标签页关闭确认(同一原生窗):渲染层传入文件名 → 返回 save/dont/cancel */
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
  /* 写入/替换缩略图：渲染层生成 256x256 webp(游戏同款规则)，覆写组目录 thumb.webp。
     仅限文件名 thumb.webp，防止路径穿越。
     用**就地覆写**（openSync(p,'r+')，不换 inode）而不是「写临时文件 + rename 替换」：
     创建时间 / inode / ACL / 文件属性天然保留，写后恢复 atime/mtime，失败用内存原文回滚。
     另外**只覆写已存在的 thumb.webp**，不新建 —— 组目录原本没有它时不该凭空造一个。 */
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
      /* 必须在 readFileSync **之前**存时间戳：读文件会把 atime 刷成当前时间，
         晚一步取到就是被污染的值。 */
      const st0 = fs.statSync(p, { bigint: true });
      const tSaved = { atimeNs: st0.atimeNs, mtimeNs: st0.mtimeNs, birthtimeNs: st0.birthtimeNs };
      const prev = fs.readFileSync(p);
      try {
        fzaCgroup.writeFileInPlace(p, buf, tSaved);
      } catch (err) {
        try { fzaCgroup.writeFileInPlace(p, prev, tSaved); } catch (e2) { /* 尽力回滚 */ }
        return { ok: false, error: '写入失败已回滚：' + String(err && err.message || err) };
      }
      return { ok: true, bytes: buf.length };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  /* 注入：把画布模型写入指定占位组（就地覆写 + header 层数同步 + 属性/时间戳保留 + 失败回滚） */
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
  /* 导出：解码某占位组为模型（渲染层转 SVG 图层），附标题/作者 */
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
  /* 账户存档整包备份：先让用户选保存位置，再压缩 */
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

  /* ---------- 注入撤销备份（InjectUndo）----------
     每次注入**写盘之前**，把被覆盖分组的原模型 + 原缩略图存成一条记录；
     只保留最近 UNDO_KEEP 条，超出的最早一条**永久删除**。
     一次注入 = 一条记录（多选同时注入的 N 个分组合并成同一条）。
     目录结构（InjectUndo 下每条记录一个目录）：
       rec-<yyyyMMdd-HHmmss-SSS>/
         meta.json       记录元数据（时间/账户/各分组的目标路径与标题作者）
         <i>.model.json  第 i 个分组注入前的模型（还原用，不经 SVG 往返，保真）
         <i>.thumb.webp  第 i 个分组注入前的缩略图副本（还原时一并写回）
     不主动删用户数据：只删自己创建的 rec-* 目录。 */
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
  /* 裁剪：只保留最新 UNDO_KEEP 条，其余目录永久删除 */
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
        } catch (err) { /* 缩略图读失败不影响列表 */ }
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
  /* 恢复：逐个校验原位置 → 写回模型 → 还原缩略图。
     原位置已不存在（C_group 或 header 缺失）的跳过并上报，由渲染层询问是否导出为 SVG。 */
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
          /* 缩略图一并还原（否则内容恢复了、图还是注入后的样子）。
             与 forza-thumb-write 同一套规则：只覆写**已存在**的 thumb.webp，不新建。 */
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

  /* 日志：渲染器写入内存缓冲 / 查询保存路径 / 读取缓冲 / 保存到文件 / 打开文件夹 */
  ipcMain.handle('app-flags', async () => ({
    testMode: !!process.env.SVGBIANJI_TEST,
    exeDir: appDataDir()
  }));
  /* 用户设置（语言/主题）：userData/settings.json；自动命名前缀随界面语言 */
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
  /* ---------- 自动更新：下载新 exe 并覆盖自己 ----------
     关键事实：Windows **不允许覆盖正在运行的 exe，但允许给它改名**。
     所以流程是「下载到同目录 → 旧 exe 改名 .old.exe → 新 exe 落位 → relaunch」，
     全程只动这一个 exe 文件；用户数据（SVGImages / WorkCopies / WorkCopiesHistory /
     已保存彩绘 / fonts / settings.json）都在 exe 旁边，**一个字节都不碰**。
     开发模式（npm start）没有 exe 可覆盖 ⇒ 直接回 error:'dev'，由窗口提示手动更新。 */
  ipcMain.handle('update-install', async (e, payload) => {
    const url = payload && payload.exeUrl;
    if (!url) return { ok: false, error: 'no-asset' };
    if (!app.isPackaged) return { ok: false, error: 'dev' };
    const sender = e.sender;
    const sendPct = (pct, got, total) => {
      try { if (sender && !sender.isDestroyed()) sender.send('update-progress', { pct: pct, got: got || 0, total: total || 0 }); }
      catch (err) { /* ignore */ }
    };
    try {
      /* 便携版的真实 exe 路径在 PORTABLE_EXECUTABLE_FILE；app.getPath('exe') 是 %TEMP% 里的解压副本 */
      const exePath = process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe');
      const dir = path.dirname(exePath);
      const tmp = path.join(dir, 'update-' + Date.now() + '.exe');
      appendLog('info', '自动更新：开始下载', { url: String(url).slice(0, 120), to: tmp });
      /* 国内直连 GitHub 附件 CDN 经常在 ~20s 左右被 ERR_CONNECTION_RESET 打断：
         同一个 URL 重试往往就能过（reset 是间歇性的）。3 次，退避 1.5s / 3s。 */
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
          try { fs.unlinkSync(tmp); } catch (e2) { /* ignore */ }
          if (attempt < 3) await new Promise(r => setTimeout(r, 1500 * attempt));
        }
      }
      if (lastErr) throw lastErr;
      const oldPath = exePath.replace(/\.exe$/i, '') + '.old.exe';
      try { if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); } catch (err) { /* 旧残留删不掉就算了 */ }
      fs.renameSync(exePath, oldPath);          /* 运行中的 exe 允许改名 */
      try {
        fs.renameSync(tmp, exePath);            /* 新 exe 落位 */
      } catch (err) {
        try { fs.renameSync(oldPath, exePath); } catch (err2) { /* ignore */ }
        throw err;
      }
      appendLog('info', '自动更新：已替换，准备重启', { exe: exePath });
      /* ★ 重启不能再用 app.relaunch()：便携版里 process.execPath 是 %TEMP% 里的解压副本，
         而外层的 SFX 一旦发现子进程退出就会清掉那个临时目录 ⇒ 新进程起来就被删文件，
         表现就是「更新完软件自己没了」。改成延时拉起**用户真正双击的那个 exe**，
         2 秒足够让旧 SFX 收尾，再启动新文件。 */
      try {
        const bat = path.join(os.tmpdir(), 'sve-update-restart-' + Date.now() + '.bat');
        fs.writeFileSync(bat, '@echo off\r\ntimeout /t 2 /nobreak >nul\r\nstart "" "' + exePath + '"\r\ndel "%~f0"\r\n', 'utf8');
        const child = require('child_process').spawn('cmd.exe', ['/c', bat], { detached: true, stdio: 'ignore', windowsHide: true });
        child.unref();
      } catch (e) {
        appendLog('warn', '重启脚本失败，退回 relaunch', { message: String(e && e.message || e).slice(0, 160) });
        try { app.relaunch({ execPath: exePath }); } catch (e2) { app.relaunch(); }
      }
      setTimeout(() => { app.exit(0); }, 300);
      return { ok: true };
    } catch (err) {
      appendLog('warn', '自动更新失败', { message: String(err && err.message || err).slice(0, 200) });
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  /* ---------- 自动更新失败 → 自动打开 GitHub 仓库（2026-10-29 用户口径） ----------
     仓库地址只从 package.json 的 repository 解析（与更新检查同一个 readRepo），
     渲染层不硬编码 owner/repo，改仓库时不用改两处。 */
  ipcMain.handle('update-open-repo', async () => {
    let url = 'https://github.com';
    try {
      const t = require('./update-check').readRepo();
      if (t && t.owner && t.repo) url = 'https://github.com/' + t.owner + '/' + t.repo;
    } catch (e) { /* 解析不了就给 github 首页 */ }
    appendLog('info', '自动更新失败：打开仓库页', { url: url });
    try { await shell.openExternal(url); return { ok: true, url: url }; }
    catch (e) { return { ok: false, error: String(e && e.message || e), url: url }; }
  });

  /* ---------- 界面字体（设置 → 更改字体）----------
     导入 = 选文件 → 复制进 <数据目录>/fonts/ → 解析 name 表拿真实家族名（读不出退文件名）；
     删除 = 只删数据目录里的副本，绝不动用户原文件；
     下载 = 交给系统浏览器（本机没有内置浏览器视图）。 */
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
  /* 工作进程使用打开时签发的来源句柄回写；没有来源时才创建新文件。 */
  ipcMain.handle('file-save-work', async (e, payload) => {
    try {
      const r = workcopyStore.save(payload && payload.content, payload && payload.source,
        ensureDataDir(DATA_DIRS.workcopy), uiLang());
      /* 内容变了 ⇒ 该工作进程卡的缩略图必须重算。
         key 里带 mtime，所以「新图」天然落在新 key 上；旧 key 的图这就算孤儿，
         这里顺手删掉，避免缓存目录无限增长（见 genericThumbPath）。
         名字可能只有旧的那份（另存为新文件时），两边都清一遍。 */
      if (r && r.ok) {
        dropWorkcopyThumbs([r.name, (payload && payload.source && payload.source.name) || '']);
      }
      return r;
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  /* 首页自动目录：工作副本 / SVG图像（exe 同目录专门文件夹） */
  ipcMain.handle('file-auto-save', async (e, payload) => {
    try {
      const kind = String(payload && payload.kind || '');
      const dirName = kind === 'svg' ? DATA_DIRS.svg : DATA_DIRS.workcopy;
      const dir = ensureDataDir(dirName);

      /* 命名解析抽到 auto-name.js（纯函数，可被 node 直接 require）：显式 fileName 走官方名 <安全标题>.<层数>.svg；未传则维持既有默认（前缀随界面语言） */
      let uiLang = null;
      try { uiLang = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')).lang || null; } catch (err3) { /* 未设置过 */ }
      const name = resolveAutoSaveName(kind, payload && payload.fileName, n => fs.existsSync(path.join(dir, n)), undefined, uiLang);
      const fp = path.join(dir, name);
      /* 覆盖同名文件时，旧缩略图缓存按「写前 stat」定位并清掉；
         新内容的图会在下次主页/列表显示时按新 mtime 重新生成。 */
      let prevStat = null;
      if (kind === 'svg') { try { prevStat = fs.statSync(fp); } catch (err4) { prevStat = null; } }
      fs.writeFileSync(fp, String(payload && payload.content || ''), 'utf8');
      if (kind === 'svg' && prevStat) {
        try {
          const k = crypto.createHash('sha1').update('thumb-v9-480\0' + fp + '\0' + prevStat.size + '\0' + prevStat.mtimeMs).digest('hex');
          await fs.promises.unlink(path.join(app.getPath('userData'), 'svg-thumb-cache', k + '.png'));
        } catch (err5) { /* 没有旧缓存 */ }
      } else if (kind !== 'svg') {
        dropWorkcopyThumbs([name]);
      }
      return { ok: true, name, path: fp };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  /* 主页「导入」：选本地文件（可多选）→ 复制进 SVGImages 目录（重名自动加 -1/-2…），
     选完即可在主页列表看到；不打开文件、不改当前画布 */
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
          } catch (err3) { /* 忽略 */ }
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
      /* 带缓存身份时（工作进程卡/锚点卡传「name\0mtime」）：先查盘，命中直接回 URL，
         不经过隐藏渲染进程 —— 这是「每次启动不必重新计算」的关键。
         文件更新后 mtime 变 → 身份串变 → sha1 变 → 自然落不到旧缓存 → 重新渲染并覆盖写盘。 */
      const ns = String(payload && payload.cacheNs || '');
      const identity = payload && payload.cacheIdentity;
      const key = (ns && identity != null)
        ? crypto.createHash('sha1').update(String(identity)).digest('hex') : '';
      const cachePath = key ? genericThumbPath(ns, key) : null;
      /* 名字（身份串里 \0 之前那段）→ 记进索引，供「文件更新后立刻删旧图」使用 */
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
  /* 通用缩略图磁盘缓存：直接读一个 key 的缓存图（彩绘纹饰面板启动时批量预取用）。
     命中回 URL；未命中回 ok:false，由渲染层生成后再调 svg-thumb-cache-put 落盘。 */
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
  /* 缓存失效：删除某命名空间的若干 key（保存/重命名/删除文件后调用）。
     不传 keys 时整目录清空（素材文件换版本时用）。 */
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
  /* 素材版本：给「彩绘纹饰」缩略图缓存当失效依据（素材一改整批重算）。
     直接 stat 素材文件 —— 比读 fetch 响应头可靠（本机 net.fetch(file://) 不保证带 ETag）。 */
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
      /* 记录写入前的 stat —— 清理旧缩略图缓存需要它（写完再 stat 就变成新值了）。
         ★ 必须在 writeFileSync 之前取；fs.statSync 不会像 readFileSync 那样刷 atime 影响 mtime。 */
      let prevStat = null;
      if (exists) { try { prevStat = fs.statSync(p); } catch (err2) { prevStat = null; } }
      /* 覆写「本文件自己的源文件」是既定行为(不打扰)；只有要盖掉【另一份】已有文件时才确认。 */
      if (exists && name !== String(payload && payload.sourceName || '')) {
        if (!(await askOverwrite(name))) return { ok: false, canceled: true };
      }
      if (exists && (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== previous))
        return { ok: false, error: dt('dlg.fileChanged') };
      atomicWrite(p, content, exists);
      /* 文件内容变了 ⇒ 主页卡片的缩略图必须重算。
         svg 卡那条路的缓存 key 是 sha1(版本+路径+size+mtime)（见 renderSvgThumbFile），
         这次写入后 mtime/size 必然变 ⇒ 新图落新 key，旧图不会再被命中；
         这里把**旧 key** 的图删掉，避免缓存目录无限增长。
         旧 key 需要「写入之前」的 stat —— 所以取 stat 必须在写盘之前。 */
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
  /* 首页重命名:仅限自动目录内的 svg / svework 文件(安全文件名,防目录穿越) */
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
        /* 改名后旧名字的缓存图孤儿了；新名字首次显示会重新渲染 */
        dropWorkcopyThumbs([oldName]);
      }
      return { ok: true, path: newP, oldPath: oldP, name: newName };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  /* 首页删除：仅限自动目录内的 svg / svework 文件（安全文件名，防目录穿越） */
  ipcMain.handle('file-delete', async (e, payload) => {
    try {
      const kind = String(payload && payload.kind || '');
      const dir = ensureDataDir(kind === 'svg' ? DATA_DIRS.svg : DATA_DIRS.workcopy);
      const name = String(payload && payload.name || '').replace(/[\\/:*?"<>|]/g, '_');
      const extOk = kind === 'svg' ? /\.svg$/i.test(name) : /\.svework$/i.test(name);
      if (!extOk) return { ok: false, error: '不支持的文件类型' };
      const fp = path.join(dir, name);
      if (!fs.existsSync(fp)) return { ok: false, error: '文件不存在' };
      /* 删除前取 stat —— 用它定位主页 svg 卡那条路的缓存 key（sha1 里含 size+mtime） */
      let st = null;
      if (kind === 'svg') { try { st = fs.statSync(fp); } catch (err2) { st = null; } }
      fs.unlinkSync(fp);
      /* 老版本覆盖保存会留一份同名 .bak（上一版）；备份机制已移除，这里只清理历史遗留，避免残留悬空备份 */
      try { fs.unlinkSync(fp + '.bak'); } catch (e) { /* 没有遗留备份 */ }
      /* 顺带清掉这个文件留下的缩略图缓存（文件都没了，图留着没意义） */
      if (kind === 'svg' && st) {
        try {
          const k = crypto.createHash('sha1').update('thumb-v9-480\0' + fp + '\0' + st.size + '\0' + st.mtimeMs).digest('hex');
          fs.unlinkSync(path.join(app.getPath('userData'), 'svg-thumb-cache', k + '.png'));
        } catch (e) { /* 没有缓存 */ }
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
