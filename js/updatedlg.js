'use strict';
App.UPD_I18N = {
  'zh-CN': {
    'upd.title': '检测到更新 🎆🎆',
    'upd.cancel': '取消',
    'upd.update': '更新',
    'upd.busy': '更新中 {v}%',
    'upd.devHint': '当前是开发模式，请手动更新',
    'upd.noAsset': '这个版本没有可下载的 exe，请手动更新',
    'upd.fail': '更新失败：{v}',
    'upd.done': '已下载，正在重启…',
    'upd.openRepo': '已自动打开 GitHub 仓库，可手动下载最新版',
    'upd.errReset': '网络连接被重置（直连 GitHub 常见）',
    'upd.errTimeout': '下载超时（网络不稳定）',
    'upd.errIncomplete': '下载不完整，已丢弃'
  },
  'zh-TW': {
    'upd.title': '偵測到更新 🎆🎆',
    'upd.cancel': '取消',
    'upd.update': '更新',
    'upd.busy': '更新中 {v}%',
    'upd.devHint': '目前是開發模式，請手動更新',
    'upd.noAsset': '這個版本沒有可下載的 exe，請手動更新',
    'upd.fail': '更新失敗：{v}',
    'upd.done': '已下載，正在重新啟動…',
    'upd.openRepo': '已自動開啟 GitHub 儲存庫，可手動下載最新版',
    'upd.errReset': '網路連線被重設（直連 GitHub 常見）',
    'upd.errTimeout': '下載逾時（網路不穩定）',
    'upd.errIncomplete': '下載不完整，已丟棄'
  },
  'en': {
    'upd.title': 'Update available 🎆🎆',
    'upd.cancel': 'Cancel',
    'upd.update': 'Update',
    'upd.busy': 'Updating {v}%',
    'upd.devHint': 'Running in dev mode — please update manually',
    'upd.noAsset': 'No exe asset for this release — please update manually',
    'upd.fail': 'Update failed: {v}',
    'upd.done': 'Downloaded, restarting…',
    'upd.openRepo': 'Opened the GitHub repository — you can download manually',
    'upd.errReset': 'connection reset (common when GitHub is blocked)',
    'upd.errTimeout': 'download timed out (unstable network)',
    'upd.errIncomplete': 'download incomplete, discarded'
  },
  'ja': {
    'upd.title': 'アップデートがあります 🎆🎆',
    'upd.cancel': 'キャンセル',
    'upd.update': '更新',
    'upd.busy': '更新中 {v}%',
    'upd.devHint': '開発モードのため手動で更新してください',
    'upd.noAsset': 'このリリースには exe がありません。手動で更新してください',
    'upd.fail': '更新に失敗しました：{v}',
    'upd.done': 'ダウンロード完了、再起動します…',
    'upd.openRepo': 'GitHub リポジトリを開きました。手動でダウンロードできます',
    'upd.errReset': '接続がリセットされました（GitHub 直結でよく発生）',
    'upd.errTimeout': 'ダウンロードがタイムアウトしました（不安定な回線）',
    'upd.errIncomplete': 'ダウンロードが不完全なため破棄しました'
  },
  'ko': {
    'upd.title': '업데이트가 있습니다 🎆🎆',
    'upd.cancel': '취소',
    'upd.update': '업데이트',
    'upd.busy': '업데이트 중 {v}%',
    'upd.devHint': '개발 모드이므로 직접 업데이트하세요',
    'upd.noAsset': '이 릴리스에는 exe가 없습니다. 직접 업데이트하세요',
    'upd.fail': '업데이트 실패: {v}',
    'upd.done': '다운로드 완료, 재시작합니다…',
    'upd.openRepo': 'GitHub 저장소를 열었습니다. 직접 다운로드할 수 있습니다',
    'upd.errReset': '연결이 재설정되었습니다 (GitHub 직접 연결 시 흔함)',
    'upd.errTimeout': '다운로드 시간 초과 (불안정한 네트워크)',
    'upd.errIncomplete': '다운로드가 불완전하여 폐기했습니다'
  }
};
Object.keys(App.UPD_I18N).forEach(function (lang) {
  if (App.i18n.dicts[lang]) Object.assign(App.i18n.dicts[lang], App.UPD_I18N[lang]);
});

App.updateDlg = {
  el: null,
  info: null,
  busy: false,

  plainNotes(md) {
    let t = String(md || '');
    if (!t.trim()) return '';
    t = t.replace(/\r\n/g, '\n');
    t = t.replace(/```[\s\S]*?```/g, m => m.replace(/```[a-z]*\n?/gi, '').replace(/```/g, ''));   
    t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');                     
    t = t.replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1（$2）');           
    t = t.replace(/^\s{0,3}#{1,6}\s*/gm, '');                        
    t = t.replace(/^\s{0,3}>\s?/gm, '');                             
    t = t.replace(/^\s{0,3}[-*+]\s+/gm, '· ');                       
    t = t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1');
    t = t.replace(/`([^`]+)`/g, '$1');
    t = t.replace(/\n{3,}/g, '\n\n');
    return t.trim();
  },

  show(info) {
    if (!info || this.busy) return;
    this.info = info;
    Array.from(document.querySelectorAll('#updateOv')).forEach(el => el.remove());
    this.el = null;
    const ov = document.createElement('div');
    ov.className = 'confirm-overlay upd-ov';
    ov.id = 'updateOv';
    ov.innerHTML =
      '<div class="confirm-box upd-box">' +
        '<div class="anchor-title upd-title"></div>' +
        '<div class="upd-notes"></div>' +
        '<div class="upd-hint hidden"></div>' +
        '<div class="anchor-btns">' +
          '<button id="updCancel"></button>' +
          '<button id="updGo"></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    this.el = ov;
    ov.querySelector('.upd-title').textContent = App.i18n.t('upd.title');
    ov.querySelector('.upd-notes').textContent = this.plainNotes(info.notes);
    const cancel = ov.querySelector('#updCancel');
    const go = ov.querySelector('#updGo');
    cancel.textContent = App.i18n.t('upd.cancel');
    go.textContent = App.i18n.t('upd.update');
    const hint = ov.querySelector('.upd-hint');

    const blocked = !!(info.isDev || !info.exeUrl);
    if (blocked) {
      hint.textContent = App.i18n.t(info.isDev ? 'upd.devHint' : 'upd.noAsset');
      hint.classList.remove('hidden');
      go.disabled = true;
      go.classList.add('disabled');
    }

    cancel.addEventListener('click', () => this.close());
    go.addEventListener('click', () => this.start());
    ov.addEventListener('click', e => { if (e.target === ov && !this.busy) this.close(); });
    if (App.showOverlay) App.showOverlay(ov); else ov.classList.remove('hidden');
  },

  close() {
    const el = this.el || document.getElementById('updateOv');
    this.el = null;
    if (el && el.parentNode) el.parentNode.removeChild(el);
  },

  fmtMB(n) {
    const mb = Number(n || 0) / 1048576;
    if (!mb) return '0 MB';
    return (mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)) + ' MB';
  },

  applyProgress(pr) {
    if (!this.el || !pr) return false;
    const go = this.el.querySelector('#updGo');
    const hint = this.el.querySelector('.upd-hint');
    if (go && typeof pr.pct === 'number') go.textContent = App.i18n.t('upd.busy').replace('{v}', String(pr.pct));
    if (hint && pr.total) {
      hint.textContent = this.fmtMB(pr.got) + ' / ' + this.fmtMB(pr.total);
      hint.classList.remove('hidden');
    }
    return true;
  },

  friendlyError(raw) {
    const s = String(raw || '');
    if (/ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_CONNECTION_ABORTED|ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED/i.test(s)) {
      return App.i18n.t('upd.errReset');
    }
    if (/timeout/i.test(s)) return App.i18n.t('upd.errTimeout');
    if (/incomplete/i.test(s)) return App.i18n.t('upd.errIncomplete');
    return s.slice(0, 80);
  },

  _opener: null,
  _installer: null,

  openRepoArg() {
    const run = this._opener || function () {
      return (window.sveApi && window.sveApi.updateOpenRepo) ? window.sveApi.updateOpenRepo() : null;
    };
    return run();
  },

  openRepo() {
    const hint = this.el && this.el.querySelector('.upd-hint');
    if (hint) {
      hint.textContent = App.i18n.t('upd.openRepo');
      hint.classList.remove('hidden');
    }
    try {
      const p = this.openRepoArg();
      if (p && typeof p.catch === 'function') p.catch(function () {   });
    } catch (e) {   }
    return true;
  },

  async start() {
    if (this.busy || !this.info) return;
    if (!this.info.exeUrl) return;
    this.busy = true;
    const go = this.el && this.el.querySelector('#updGo');
    const cancel = this.el && this.el.querySelector('#updCancel');
    if (cancel) cancel.disabled = true;
    if (go) { go.disabled = true; go.textContent = App.i18n.t('upd.busy').replace('{v}', '0'); }
    const off = (window.sveApi && window.sveApi.onUpdateProgress)
      ? window.sveApi.onUpdateProgress(pr => this.applyProgress(pr))
      : function () { };
    try {
      const install = this._installer || function (payload) { return window.sveApi.updateInstall(payload); };
      const r = await install({ exeUrl: this.info.exeUrl, version: this.info.remote });
      if (r && r.ok) {
        if (go) go.textContent = App.i18n.t('upd.done');
        return;    
      }
      throw new Error((r && r.error) || 'unknown');
    } catch (e) {
      this.busy = false;
      if (off) off();
      if (cancel) cancel.disabled = false;
      if (go) {
        go.disabled = false;
        go.textContent = App.i18n.t('upd.update');
      }
      const msg = App.i18n.t('upd.fail').replace('{v}', this.friendlyError(e && e.message || e));
      if (typeof showToast === 'function') showToast(msg, 4200);
      else console.warn('[update]', msg);
      this.openRepo();
    }
  },

  init() {
    if (!window.sveApi || !window.sveApi.onUpdateAvailable) return;
    window.sveApi.onUpdateAvailable(info => this.show(info));
  }
};
App.updateDlg.init();
