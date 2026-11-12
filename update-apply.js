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
    'move /y "%NEW%" "%TGT%" >nul 2>&1',
    'if not errorlevel 1 goto OK',
    'set /a N+=1',
    'if %N% GEQ %RETRY% goto FAIL',
    'ping -n 2 127.0.0.1 >nul 2>&1',
    'goto MV',
    ':OK',
    '>"%RES%" echo ok',
    'start "" "%TGT%"',
    'goto CLEAN',
    ':FAIL',
    '>"%RES%" echo fail',
    'del "%NEW%" >nul 2>&1',
    'start "" "%TGT%"',
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

module.exports = {
  scheduleExeReplace: scheduleExeReplace,
  readResult: readResult,
  readState: readState,
  writeState: writeState,
  clearState: clearState,
  isNewer: isNewer
};
