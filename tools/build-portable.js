'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = String(argOf('--version', pkg.version || '0.0.0'));   
const VERSION4 = VERSION.split('.').concat(['0', '0', '0']).slice(0, 4).join('.');
const APP_EXE = 'FH6 Vinyl Group Editor.exe';

function argOf(name, dflt) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const UNPACKED = path.resolve(argOf('--unpacked', path.join(ROOT, 'release', 'win-unpacked')));
const OUT = path.resolve(argOf('--out', path.join(ROOT, 'release', 'FH6-Vinyl-Group-Editor.exe')));

function fail(msg) { console.error('FAIL | ' + msg); process.exit(1); }
function globOne(dir, re) {
  if (!fs.existsSync(dir)) return '';
  const hit = fs.readdirSync(dir).find(n => re.test(n));
  return hit ? path.join(dir, hit) : '';
}


if (!fs.existsSync(path.join(UNPACKED, APP_EXE))) fail('没有找到 ' + path.join(UNPACKED, APP_EXE) + '（先跑 electron-builder --win --dir）');
if (!fs.existsSync(path.join(UNPACKED, 'resources', 'app.asar'))) fail('win-unpacked 不完整（缺 resources/app.asar）');


const EB_CACHE = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache');
const sevenZip = globOne(path.join(EB_CACHE, '7zip@1.0.0'), /^7zip-win-x64-/)
  ? path.join(globOne(path.join(EB_CACHE, '7zip@1.0.0'), /^7zip-win-x64-/), 'bin', '7za.exe')
  : (fs.existsSync(path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'))
    ? path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe') : '');
if (!sevenZip || !fs.existsSync(sevenZip)) fail('找不到 7za.exe（electron-builder 缓存 / 7zip-bin）');

const nsisRoot = globOne(path.join(EB_CACHE, 'nsis-3.0.4.1'), /^nsis-3\.0\.4\.1-/);
const makensis = nsisRoot ? path.join(nsisRoot, 'Bin', 'makensis.exe') : '';
if (!makensis || !fs.existsSync(makensis)) fail('找不到 makensis.exe（electron-builder 缓存）');

const resRoot = globOne(path.join(EB_CACHE, 'nsis-resources-3.4.1'), /^nsis-resources-3\.4\.1-/);
const nsisPlugins = resRoot ? path.join(resRoot, 'plugins', 'x86-unicode') : '';
if (!nsisPlugins || !fs.existsSync(path.join(nsisPlugins, 'nsis7z.dll'))) fail('找不到 nsis7z.dll（nsis-resources 缓存）');

const icon = path.join(ROOT, 'icons', 'app-icon.ico');
if (!fs.existsSync(icon)) fail('缺图标 ' + icon);


const tmpDir = path.join(ROOT, 'release', '.portable-tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const reused7z = argOf('--7z', '');
const sevenFile = reused7z ? path.resolve(reused7z) : path.join(tmpDir, 'app-64.7z');
if (reused7z) {
  if (!fs.existsSync(sevenFile)) fail('--7z 指定的文件不存在: ' + sevenFile);
  console.log('  复用 app-64.7z = ' + sevenFile);
} else {
  try { fs.unlinkSync(sevenFile); } catch (e) {  }
  console.log('  压缩 win-unpacked → app-64.7z …');
  const a = spawnSync(sevenZip, [
    'a', '-t7z', '-mx=9', '-bd', sevenFile, '*', '-r',
    
    '-xr!_userdata', '-xr!sve-logs', '-xr!SVGImages', '-xr!WorkCopies',
    '-xr!WorkCopiesHistory', '-xr!settings.json', '-xr!update-*.exe'
  ], {
    cwd: UNPACKED, stdio: 'inherit', windowsHide: true
  });
  if (a.status !== 0) fail('7za 压缩失败，exit=' + a.status);
}
const packMB = (fs.statSync(sevenFile).size / 1048576).toFixed(1);
console.log('  app-64.7z = ' + packMB + ' MB');


console.log('  编译 NSIS 启动器 …');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
try { fs.unlinkSync(OUT); } catch (e) {  }
const b = spawnSync(makensis, [
  '/NOCD',
  '/DAPP_VERSION=' + VERSION,
  '/DAPP_VERSION4=' + VERSION4,
  '/DAPP_7Z=' + sevenFile,
  '/DOUT_FILE=' + OUT,
  '/DICON=' + icon,
  '/DNSIS_PLUGINS=' + nsisPlugins,
  path.join(__dirname, 'portable-launcher.nsi')
], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
if (b.status !== 0) fail('makensis 编译失败，exit=' + b.status);

if (!process.argv.includes('--keep7z')) {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {  }
}

const st = fs.statSync(OUT);
console.log('PASS | 便携版 = ' + OUT + '  (' + (st.size / 1048576).toFixed(1) + ' MB, v' + VERSION + ')');
