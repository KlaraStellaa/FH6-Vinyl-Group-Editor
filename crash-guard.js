'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { makeZip } = require('./render-report');

const MARK_NAME = 'session-guard.json';
const LAST_NAME = 'last-crash.json';
const STALE_MS = 14 * 24 * 60 * 60 * 1000;    
const MAX_LOG_FILES = 4;
const MAX_LOG_BYTES = 12 * 1024 * 1024;
const MAX_DETAIL = 400;

function pad2(n) { return String(n).padStart(2, '0'); }
function fmtTime(ts) {
  const n = Number(ts);
  if (!n || !isFinite(n)) return '—';
  const d = new Date(n);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}
function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
}

function pidAlive(pid) {
  const n = parseInt(pid, 10);
  if (!(n > 0)) return false;
  if (n === process.pid) return true;
  try { process.kill(n, 0); return true; }
  catch (e) { return !!(e && e.code === 'EPERM'); }
}

function readJson(fp) {
  try {
    const o = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return (o && typeof o === 'object' && !Array.isArray(o)) ? o : null;
  } catch (e) { return null; }
}

function writeJsonAtomic(fp, obj) {
  const tmp = fp + '.tmp';
  const text = JSON.stringify(obj, null, 1);
  try {
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { try { fs.closeSync(fd); } catch (e) {   } }
    fs.renameSync(tmp, fp);
    return true;
  } catch (e) {
    try { fs.writeFileSync(fp, text, 'utf8'); } catch (e2) {
      try { fs.unlinkSync(tmp); } catch (e3) {   }
      return false;
    }
    try { fs.unlinkSync(tmp); } catch (e4) {   }
    return true;
  }
}

function makeScrubber(privatePaths) {
  const esc = function (s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
  const toRe = function (p) {
    return String(p).split(/[\\/]+/).filter(Boolean).map(esc).join('[\\\\/]{1,2}');
  };
  const home = (function () { try { return String(os.homedir() || ''); } catch (e) { return ''; } })();
  const rules = [];
  (privatePaths || []).forEach(function (p2) {
    if (p2 && String(p2).length > 3) rules.push({ re: toRe(p2), tag: '%APPDIR%' });
  });
  if (home.length > 3) rules.push({ re: toRe(home), tag: '%USERPROFILE%' });
  rules.sort(function (a, b) { return b.re.length - a.re.length; });    
  return function (text) {
    let s = String(text == null ? '' : text);
    rules.forEach(function (rule) {
      try { s = s.replace(new RegExp(rule.re, 'gi'), rule.tag); } catch (e) {   }
    });
    s = s.replace(/([A-Za-z]:\\{1,2}Users\\{1,2})[^\\\s"']+/g, '$1%USER%');
    return s;
  };
}

function newSessionId() {
  const d = new Date();
  return 'S' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' +
    pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()) + '-' + process.pid;
}

function create(opts) {
  const o = opts || {};
  const dir = o.dir ? String(o.dir) : '';
  const log = typeof o.log === 'function' ? o.log : function () { };
  const versionOf = typeof o.version === 'function' ? o.version : function () { return ''; };
  const scrub = makeScrubber(o.privatePaths);
  let session = null;

  function fp(name) { return path.join(dir, name); }
  function ensure() { try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {   } }

  function begin() {
    if (!dir) return { crashed: false };
    ensure();
    const mark = readJson(fp(MARK_NAME));
    let crashed = false, prev = null, crash = null;

    if (mark && mark.startedAt) {
      const age = Date.now() - Number(mark.startedAt);
      const wasClean = mark.cleanExit === true;
      const samePid = Number(mark.pid) === process.pid;
      if (!wasClean && !samePid && pidAlive(mark.pid)) {
        log('info', '崩溃守卫：另一实例仍在运行，跳过判定', { pid: mark.pid });
        return { crashed: false, skipped: true };
      }
      if (!wasClean && (samePid || !pidAlive(mark.pid)) && Math.abs(age) < STALE_MS) {
        crashed = true;
        prev = {
          startedAt: Number(mark.startedAt) || 0,
          endedAt: Number(mark.endedAt) || 0,
          pid: Number(mark.pid) || 0,
          version: String(mark.version || ''),
          stage: String(mark.stage || '')
        };
        const last = readJson(fp(LAST_NAME));
        if (last && Number(last.at) >= prev.startedAt - 2000) {
          crash = {
            kind: String(last.kind || 'unknown').slice(0, 40),
            at: Number(last.at) || 0,
            detail: scrub(last.detail || '').slice(0, MAX_DETAIL)
          };
        }
      }
    }
    try { fs.unlinkSync(fp(LAST_NAME)); } catch (e) {   }

    session = {
      schema: 1,
      id: newSessionId(),
      pid: process.pid,
      version: String(versionOf() || ''),
      startedAt: Date.now(),
      stage: 'start',
      cleanExit: false
    };
    writeJsonAtomic(fp(MARK_NAME), session);
    return { crashed: crashed, prev: prev, crash: crash, session: session };
  }

  function setStage(stage) {
    if (!session || !dir) return;
    const s = String(stage || '').slice(0, 40);
    if (!s || s === session.stage) return;
    session.stage = s;
    writeJsonAtomic(fp(MARK_NAME), session);
  }

  function noteFatal(kind, why) {
    if (!dir) return;
    ensure();
    const rec = {
      schema: 1,
      kind: String(kind || 'unknown').slice(0, 40),
      at: Date.now(),
      version: String(versionOf() || ''),
      pid: process.pid,
      session: session ? session.id : '',
      detail: scrub(typeof why === 'string' ? why : JSON.stringify(why || {})).slice(0, MAX_DETAIL)
    };
    writeJsonAtomic(fp(LAST_NAME), rec);
    try { log('error', '记录异常现场：' + rec.kind, { detail: rec.detail }); } catch (e) {   }
  }

  function markClean(reason) {
    if (!session || !dir) return false;
    session.cleanExit = true;
    session.endedAt = Date.now();
    session.endWhy = String(reason || '').slice(0, 24);
    writeJsonAtomic(fp(MARK_NAME), session);
    try { fs.unlinkSync(fp(MARK_NAME)); } catch (e) {   }
    return true;
  }

  return { begin: begin, setStage: setStage, noteFatal: noteFatal, markClean: markClean, dir: dir };
}

function pickLogs(logDir, excludePrefix) {
  let names = [];
  try { names = fs.readdirSync(logDir); } catch (e) { return []; }
  const items = [];
  names.forEach(function (n) {
    if (!/^session-.*\.log$/i.test(n)) return;
    if (excludePrefix && n.indexOf(excludePrefix) === 0) return;    
    const p = path.join(logDir, n);
    let st;
    try { st = fs.statSync(p); } catch (e) { return; }
    if (!st.isFile() || st.size <= 0) return;
    items.push({ name: n, path: p, bytes: st.size, mtime: st.mtimeMs });
  });
  items.sort(function (a, b) { return b.mtime - a.mtime; });
  const out = [];
  let total = 0;
  for (let i = 0; i < items.length && out.length < MAX_LOG_FILES; i++) {
    if (out.length && total + items[i].bytes > MAX_LOG_BYTES) continue;
    out.push(items[i]);
    total += items[i].bytes;
  }
  return out;
}

function writeCrashPackage(cfg) {
  const c = cfg || {};
  const scrub = makeScrubber(c.privatePaths);
  const when = new Date();
  const appInfo = c.app || {};
  const envInfo = c.env || {};
  const entries = [];
  const logMeta = [];

  pickLogs(c.logDir, c.excludePrefix).forEach(function (l) {
    let text;
    try { text = scrub(fs.readFileSync(l.path, 'utf8')); } catch (e) { return; }
    let lines = 0;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
    const buf = Buffer.from(text, 'utf8');
    entries.push({ name: 'logs/' + l.name, data: buf });
    logMeta.push({ name: l.name, bytes: buf.length, lines: lines, modified: fmtTime(l.mtime) });
  });

  const prev = c.prev || null;
  const crash = c.crash || null;
  const manifest = {
    schema: 1,
    kind: 'crash-report',
    generatedAt: when.toISOString(),
    app: {
      product: String(appInfo.product || 'FH6 Vinyl Group Editor').slice(0, 48),
      version: String(appInfo.version || '').slice(0, 24),
      packaged: !!appInfo.packaged,
      portable: !!appInfo.portable,
      locale: String(appInfo.locale || '').slice(0, 16)
    },
    env: {
      platform: String(envInfo.platform || process.platform).slice(0, 16),
      arch: String(envInfo.arch || process.arch).slice(0, 16),
      osRelease: String(envInfo.osRelease || os.release()).slice(0, 32),
      electron: String(envInfo.electron || process.versions.electron || '').slice(0, 16),
      chrome: String(envInfo.chrome || process.versions.chrome || '').slice(0, 16),
      node: String(envInfo.node || process.versions.node || '').slice(0, 16),
      totalMemMB: Number(envInfo.totalMemMB) || Math.round(os.totalmem() / 1048576)
    },
    lastRun: prev ? {
      startedAt: fmtTime(prev.startedAt),
      durationMs: prev.startedAt ? Math.max(0, Date.now() - prev.startedAt) : 0,
      version: String(prev.version || '').slice(0, 24),
      stage: String(prev.stage || '').slice(0, 40),
      pid: Number(prev.pid) || 0
    } : null,
    crash: crash ? { kind: crash.kind, at: fmtTime(crash.at), detail: crash.detail } : null,
    gpu: c.gpu || null,
    logs: logMeta,
    flags: { autoLog: c.autoLog !== false, userExport: true }
  };

  const summary = [
    'FH6 Vinyl Group Editor 崩溃报告 / Crash report',
    '',
    '生成时间：' + fmtTime(when.getTime()),
    '程序版本：' + manifest.app.version + (manifest.app.packaged ? '' : '（开发版）'),
    '运行环境：' + manifest.env.platform + ' ' + manifest.env.osRelease + ' / ' + manifest.env.arch +
      ' / Electron ' + manifest.env.electron,
    '判定原因：' + (crash ? (crash.kind + '：' + crash.detail) : '没有执行正常退出流程（崩溃、被强制结束或断电）'),
    prev ? ('上次会话：' + fmtTime(prev.startedAt) + ' 启动，停在阶段 ' + (prev.stage || '未知')) : '上次会话：无记录',
    manifest.flags.autoLog ? '' : '注意：用户关闭了自动日志，包内没有运行日志，只有环境信息。',
    '',
    '日志（' + logMeta.length + ' 个）：',
    logMeta.length ? logMeta.map(function (l) {
      return '  · ' + l.name + '（' + fmtSize(l.bytes) + '，' + l.lines + ' 行）';
    }).join('\n') : '  （无）',
    '',
    '说明：日志里的用户目录与程序目录已替换为 %USERPROFILE% / %APPDIR%；',
    '     包内不含作品内容、SVG、位图与剪贴板。'
  ].filter(function (x) { return x !== ''; }).join('\n');

  entries.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 1), 'utf8') });
  entries.push({ name: 'summary.txt', data: Buffer.from(summary + '\n', 'utf8') });

  let zip;
  try { zip = makeZip(entries, when); }
  catch (e) { return { ok: false, error: '打包失败', detail: String(e && e.message || e).slice(0, 160) }; }

  let outDir = c.logDir;
  if (!outDir) return { ok: false, error: '没有日志目录' };
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) {   }
  const stamp = when.getFullYear() + pad2(when.getMonth() + 1) + pad2(when.getDate()) + '-' +
    pad2(when.getHours()) + pad2(when.getMinutes()) + pad2(when.getSeconds());
  const file = path.join(outDir, 'sve-crash-' + stamp + '.zip');
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, zip);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) {   }
    return { ok: false, error: '写入失败（磁盘空间 / 权限）', detail: String(e && e.message || e).slice(0, 160) };
  }
  return {
    ok: true, path: file, bytes: zip.length, logs: logMeta.length,
    entries: entries.map(function (e) { return { name: e.name, bytes: e.data.length }; })
  };
}

module.exports = { create: create, writeCrashPackage: writeCrashPackage, pickLogs: pickLogs, pidAlive: pidAlive, fmtTime: fmtTime, fmtSize: fmtSize };
