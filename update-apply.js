'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_DELAY_PINGS = 4;
const DEFAULT_RETRY = 300;

function scheduleExeReplace(opts) {
  const o = opts || {};
  const targetExe = String(o.targetExe || '');
  const newExe = String(o.newExe || '');
  if (!targetExe || !newExe) throw new Error('bad-args');
  const resultFile = String(o.resultFile || path.join(os.tmpdir(), 'sve-update-result.txt'));
  const delayPings = Number(o.delayPings || DEFAULT_DELAY_PINGS);
  const retry = Number(o.retry || DEFAULT_RETRY);
  const dir = String(o.batDir || os.tmpdir());
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {   }
  const bat = path.join(dir, 'sve-replace-' + Date.now() + '-' + process.pid + '.cmd');

  const script = [
    '@echo off',
    'setlocal',
    'set "TGT=%~1"',
    'set "NEW=%~2"',
    'set "RES=%~3"',
    'set "DELAY=%~4"',
    'set "RETRY=%~5"',
    'if "%DELAY%"=="" set "DELAY=4"',
    'if "%RETRY%"=="" set "RETRY=300"',
    'ping -n %DELAY% 127.0.0.1 >nul 2>&1',
    'set /a N=0',
    ':MV',
    'if not exist "%TGT%" goto PLACE',
    'if exist "%TGT%.old.exe" del /f /q "%TGT%.old.exe" >nul 2>&1',
    'ren "%TGT%" "%~nx1.old.exe" >nul 2>&1',
    'if errorlevel 1 goto WAIT',
    ':PLACE',
    'move /y "%NEW%" "%TGT%" >nul 2>&1',
    'if errorlevel 1 goto RESTORE',
    'if not exist "%TGT%" goto RESTORE',
    'if exist "%TGT%.old.exe" del /f /q "%TGT%.old.exe" >nul 2>&1',
    'goto OK',
    ':RESTORE',
    'if exist "%TGT%.old.exe" if not exist "%TGT%" ren "%TGT%.old.exe" "%~nx1" >nul 2>&1',
    ':WAIT',
    'set /a N+=1',
    'if %N% GEQ %RETRY% goto FAIL',
    'ping -n 2 127.0.0.1 >nul 2>&1',
    'goto MV',
    ':OK',
    '>"%RES%" echo ok',
    'if not "%SVE_NO_LAUNCH%"=="1" start "" "%TGT%"',
    'goto CLEAN',
    ':FAIL',
    '>"%RES%" echo fail',
    'if exist "%TGT%.old.exe" if not exist "%TGT%" ren "%TGT%.old.exe" "%~nx1" >nul 2>&1',
    'if not "%SVE_NO_LAUNCH%"=="1" if exist "%TGT%" start "" "%TGT%"',
    'goto CLEAN',
    ':CLEAN',
    'del "%~f0" >nul 2>&1',
    'exit /b'
  ].join('\r\n');
  fs.writeFileSync(bat, script, 'ascii');

  const child = spawn('cmd.exe', ['/c', bat, targetExe, newExe, resultFile, String(delayPings), String(retry)], {
    detached: false,
    stdio: 'ignore',
    windowsHide: true
  });
  child.on('error', function () {   });
  child.unref();
  return { bat: bat, resultFile: resultFile, delayPings: delayPings, retry: retry };
}

function readResult(file) {
  try {
    const s = fs.readFileSync(file, 'utf8').trim().toLowerCase();
    return s === 'ok' ? 'ok' : (s === 'fail' ? 'fail' : '');
  } catch (e) { return ''; }
}

function writeState(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj || {}, null, 2), 'utf8');
    return true;
  } catch (e) { return false; }
}

function readState(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return j && typeof j === 'object' ? j : null;
  } catch (e) { return null; }
}

function clearState(file) {
  try { fs.unlinkSync(file); } catch (e) {   }
}

function isNewer(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.');
  const pb = String(b).replace(/^v/i, '').split('.');
  for (let i = 0; i < 3; i++) {
    const x = parseInt(pa[i], 10) || 0;
    const y = parseInt(pb[i], 10) || 0;
    if (x !== y) return x > y;
  }
  return false;
}

const EXE_MIN_BYTES = 20 * 1024 * 1024;

function hasEmbedded7z(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(1 << 20);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    if (n <= 0) return false;
    return buf.subarray(0, n).indexOf(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) >= 0;
  } catch (e) {
    return false;
  } finally {
    try { if (fd !== null) fs.closeSync(fd); } catch (e) {   }
  }
}

function checkExePackage(file, opts) {
  const o = opts || {};
  const minBytes = Number(o.minBytes || EXE_MIN_BYTES);
  let st;
  try { st = fs.statSync(file); } catch (e) { return { ok: false, error: 'not-found' }; }
  if (!st.isFile()) return { ok: false, error: 'not-exe' };
  if (st.size < minBytes) return { ok: false, error: 'too-small', size: st.size };
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
    if (!hasEmbedded7z(file)) return { ok: false, error: 'not-portable-shell', size: st.size };
    return { ok: true, size: st.size, name: path.basename(file), byContent: found };
  } catch (e) {
    return { ok: false, error: 'unreadable', message: String(e && e.message || e).slice(0, 120) };
  } finally {
    try { if (fd !== null) fs.closeSync(fd); } catch (e) {   }
  }
}

function recoverTarget(target, pkg, opts) {
  const o = opts || {};
  const tgt = String(target || '');
  if (!tgt) return { action: 'none', error: 'no-target' };
  const bak = tgt + '.old.exe';
  const exists = f => { try { return fs.existsSync(f); } catch (e) { return false; } };
  try {
    if (exists(tgt)) {
      if (exists(bak)) { try { fs.unlinkSync(bak); } catch (e) {   } }
      return { action: 'none', target: tgt };
    }
    if (exists(bak)) {
      try {
        fs.renameSync(bak, tgt);
        return { action: 'restored-backup', target: tgt };
      } catch (e) {   }
    }
    if (pkg && exists(pkg)) {
      const chk = typeof o.check === 'function' ? o.check(pkg) : checkExePackage(pkg);
      if (chk && chk.ok) {
        fs.copyFileSync(pkg, tgt);
        return { action: 'copied-pkg', target: tgt, size: chk.size };
      }
      return { action: 'missing', target: tgt, error: 'pkg-invalid' };
    }
    return { action: 'missing', target: tgt, error: 'no-pkg' };
  } catch (e) {
    return { action: 'missing', target: tgt, error: String(e && e.message || e).slice(0, 120) };
  }
}

module.exports = {
  scheduleExeReplace: scheduleExeReplace,
  readResult: readResult,
  readState: readState,
  writeState: writeState,
  clearState: clearState,
  isNewer: isNewer,
  hasEmbedded7z: hasEmbedded7z,
  checkExePackage: checkExePackage,
  recoverTarget: recoverTarget,
  EXE_MIN_BYTES: EXE_MIN_BYTES
};
