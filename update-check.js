'use strict';

const { app, dialog, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const mirror = require('./update-mirror');

const CHECK_DELAY_MS = 8000;    
const TIMEOUT_MS = 10000;       
const API_ROOT = 'https://api.github.com/repos';


function readRepo() {
  try {
    const pkg = require('./package.json');
    const r = pkg.repository;
    const url = typeof r === 'string' ? r : (r && r.url) || '';
    
    const m = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url).trim());
    return m ? { owner: m[1], repo: m[2] } : null;
  } catch (e) {
    return null;
  }
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


function mirrorStatePath() {
  try { return path.join(app.getPath('userData'), 'update-mirrors.json'); }
  catch (e) { return ''; }
}


function fetchLatestRelease(owner, repo) {
  const url = API_ROOT + '/' + owner + '/' + repo + '/releases/latest';
  const sf = mirrorStatePath();
  const preferred = sf ? mirror.readPreferred(sf) : '';
  return mirror.fetchReleaseJson(url, { net: net, timeoutMs: TIMEOUT_MS, preferred: preferred })
    .then(r => {
      if (sf) {
        const prefix = mirror.PROXIES.find(p => r.url === p + url) || '';
        mirror.writePreferred(sf, prefix);
      }
      return { json: r.json, via: r.url };
    });
}


function skipFilePath() {
  try { return path.join(app.getPath('userData'), 'update-skip.json'); }
  catch (e) { return null; }
}
function readSkipped() {
  const f = skipFilePath();
  if (!f) return '';
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    return String((j && j.skipVersion) || '');
  } catch (e) { return ''; }
}
function writeSkipped(v) {
  const f = skipFilePath();
  if (!f) return;
  try { fs.writeFileSync(f, JSON.stringify({ skipVersion: String(v) }, null, 2), 'utf8'); }
  catch (e) {  }
}


function check(opts) {
  const onLog = (opts && opts.onLog) || null;
  const onAvailable = (opts && opts.onAvailable) || null;
  
  const t = (opts && opts.t) || function (k, prm) { return prm ? k : k; };
  const log = (level, msg, data) => {
    try { if (onLog) onLog(level, msg, data); } catch (e) {  }
  };

  setTimeout(async () => {
    const target = readRepo();
    if (!target) {
      log('info', '更新检查已跳过：package.json 未配置 repository');
      return;
    }
    let got;
    try {
      got = await fetchLatestRelease(target.owner, target.repo);
    } catch (e) {
      
      log('warn', '更新检查失败（已忽略）', { message: String(e && e.message || e).slice(0, 160) });
      return;
    }
    const rel = got && got.json;
    if (!rel || !rel.tag_name) {
      log('info', '更新检查：远端暂无 release', { repo: target.owner + '/' + target.repo });
      return;
    }
    log('info', '更新检查：命中通道', { via: String(got.via || '').slice(0, 160) });

    const remote = String(rel.tag_name).replace(/^v/i, '');
    const local = app.getVersion();
    if (!isNewer(remote, local)) {
      log('info', '更新检查：已是最新版本', { local, remote });
      return;
    }
    
    const notes = String(rel.body || rel.name || '').trim();
    const assets = Array.isArray(rel.assets) ? rel.assets : [];
    const exeAsset = assets.find(a => /\.exe$/i.test(String(a && a.name || ''))) || null;
    const info = {
      current: local,
      remote: remote,
      notes: notes.slice(0, 8000),
      htmlUrl: String(rel.html_url || ('https://github.com/' + target.owner + '/' + target.repo + '/releases/latest')),
      repoUrl: 'https://github.com/' + target.owner + '/' + target.repo,
      exeUrl: exeAsset ? String(exeAsset.browser_download_url || '') : '',
      exeName: exeAsset ? String(exeAsset.name || '') : '',
      exeSize: exeAsset ? Number(exeAsset.size || 0) : 0,
      isDev: !app.isPackaged
    };
    log('info', '更新检查：发现新版本，交给窗口展示', { local: local, remote: remote, hasExe: !!exeAsset });
    try { if (typeof onAvailable === 'function') onAvailable(info); }
    catch (e) { log('warn', '更新窗口通知失败', { message: String(e && e.message || e).slice(0, 160) }); }
  }, CHECK_DELAY_MS);
}

module.exports = { check, isNewer, readRepo };
