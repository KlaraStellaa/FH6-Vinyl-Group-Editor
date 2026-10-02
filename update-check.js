'use strict';
const { app, dialog, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');

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

function fetchLatestRelease(owner, repo) {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = net.request({
        method: 'GET',
        url: API_ROOT + '/' + owner + '/' + repo + '/releases/latest',
        redirect: 'follow'
      });
    } catch (e) { reject(e); return; }
    try {
      req.setHeader('User-Agent', 'GroupFH6-UpdateCheck');
      req.setHeader('Accept', 'application/vnd.github+json');
    } catch (e) { }

    const timer = setTimeout(() => {
      try { req.abort(); } catch (e) { /* ignore */ }
      reject(new Error('request timeout'));
    }, TIMEOUT_MS);

    let body = '';
    req.on('response', res => {
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        resolve(null);
        return;
      }
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
      res.on('error', e => { clearTimeout(timer); reject(e); });
    });
    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.end();
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
  catch (e) { }
}

function check(opts) {
  const onLog = (opts && opts.onLog) || null;
  const t = (opts && opts.t) || function (k, prm) { return prm ? k : k; };
  const log = (level, msg, data) => {
    try { if (onLog) onLog(level, msg, data); } catch (e) { /* ignore */ }
  };

  setTimeout(async () => {
    const target = readRepo();
    if (!target) {
      log('info', '更新检查已跳过：package.json 未配置 repository');
      return;
    }
    let rel;
    try {
      rel = await fetchLatestRelease(target.owner, target.repo);
    } catch (e) {
      log('warn', '更新检查失败（已忽略）', { message: String(e && e.message || e).slice(0, 160) });
      return;
    }
    if (!rel || !rel.tag_name) {
      log('info', '更新检查：远端暂无 release', { repo: target.owner + '/' + target.repo });
      return;
    }

    const remote = String(rel.tag_name).replace(/^v/i, '');
    const local = app.getVersion();
    if (!isNewer(remote, local)) {
      log('info', '更新检查：已是最新版本', { local, remote });
      return;
    }
    if (readSkipped() === remote) {
      log('info', '更新检查：该版本已被用户跳过', { remote });
      return;
    }

    const notes = String(rel.name || '').trim();
    const detail = [
      t('dlg.updCurrent', { v: local }),
      t('dlg.updLatest', { v: remote }),
      notes ? '\n' + t('dlg.updNotes') + '\n' + notes.slice(0, 600) : ''
    ].filter(Boolean).join('\n');

    let choice = 1;
    try {
      const r = await dialog.showMessageBox({
        type: 'info',
        title: t('dlg.updTitle'),
        message: t('dlg.updMessage', { v: remote }),
        detail,
        buttons: [t('dlg.updDownload'), t('dlg.updLater'), t('dlg.updSkip')],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });
      choice = r.response;
    } catch (e) {
      log('warn', '更新提示弹窗失败', { message: String(e && e.message || e).slice(0, 160) });
      return;
    }

    if (choice === 0) {
      const url = String(rel.html_url || ('https://github.com/' + target.owner + '/' + target.repo + '/releases/latest'));
      try { await shell.openExternal(url); }
      catch (e) { log('warn', '打开下载页失败', { message: String(e && e.message || e).slice(0, 160) }); }
      log('info', '更新检查：用户前往下载', { remote, url });
    } else if (choice === 2) {
      writeSkipped(remote);
      log('info', '更新检查：用户选择跳过此版本', { remote });
    } else {
      log('info', '更新检查：用户选择以后再说', { remote });
    }
  }, CHECK_DELAY_MS);
}

module.exports = { check, isNewer, readRepo };
