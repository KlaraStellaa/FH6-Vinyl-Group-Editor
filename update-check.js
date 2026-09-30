'use strict';
/* 启动时检查 GitHub 上有没有新版本。
 *
 * 设计原则：**绝不打扰用户**
 *   - 没配 repository       → 静默跳过
 *   - 网络不通 / 超时 / 404 → 静默跳过（只写日志）
 *   - 已是最新              → 静默跳过
 *   - 用户选过「跳过此版本」→ 静默跳过
 *   只有「确实有新版本」才弹一次窗。
 *
 * 检测方式：GET https://api.github.com/repos/<owner>/<repo>/releases/latest
 *   - 未认证调用有速率限制（每小时 60 次/IP）。一天启动几次完全够用，
 *     不需要 token；真到需要时再加。
 *   - 版本号比较用「语义化版本」：本地 app.getVersion()（取自 package.json 的 version）
 *     对比远端 release 的 tag_name（允许带 v 前缀，如 v1.2.0）。
 *
 * 配置：把仓库地址写进 package.json 的 repository 字段即可，例如
 *   "repository": "https://github.com/<你的账号>/<仓库名>"
 *   或 "repository": { "type": "git", "url": "https://github.com/<账号>/<仓库名>.git" }
 *   没配就自动跳过，不会报错。
 */
const { app, dialog, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const CHECK_DELAY_MS = 8000;    /* 启动后延迟，别和首屏渲染抢资源 */
const TIMEOUT_MS = 10000;       /* 单次请求超时 */
const API_ROOT = 'https://api.github.com/repos';

/* 从 package.json 的 repository 字段解析出 owner/repo；没配或格式不对返回 null */
function readRepo() {
  try {
    const pkg = require('./package.json');
    const r = pkg.repository;
    const url = typeof r === 'string' ? r : (r && r.url) || '';
    /* 兼容三种写法：https://github.com/a/b、https://github.com/a/b.git、git@github.com:a/b.git */
    const m = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url).trim());
    return m ? { owner: m[1], repo: m[2] } : null;
  } catch (e) {
    return null;
  }
}

/* 语义化版本比较：a 是否比 b 新。非数字段按 0 处理，不做预发布版语义（够用即可） */
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

/* 用 Electron 的 net（走 Chromium 网络栈，自动处理系统代理/证书）取最新 release */
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
    } catch (e) { /* 某些版本不允许改 header，忽略 */ }

    const timer = setTimeout(() => {
      try { req.abort(); } catch (e) { /* ignore */ }
      reject(new Error('request timeout'));
    }, TIMEOUT_MS);

    let body = '';
    req.on('response', res => {
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        resolve(null);   /* 404（没有 release）等一律当作"无更新" */
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

/* 「跳过此版本」的记录（放用户数据目录，不污染安装目录） */
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
  catch (e) { /* 写不了就算了，下次还会提示 */ }
}

/* 入口。onLog 可选：传 appendLog 就能把过程记进软件日志 */
function check(opts) {
  const onLog = (opts && opts.onLog) || null;
  /* 弹窗文案由 main.js 传入的主进程翻译函数 dt() 提供（主进程没有渲染层的 App.i18n）。 */
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
      /* 网络问题不该打扰用户，只记日志 */
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
