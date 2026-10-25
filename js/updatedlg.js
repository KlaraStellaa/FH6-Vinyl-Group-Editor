'use strict';
/* ================= 检测到更新（软件自己的窗口） =================
   用户口径（2026-10-26）：
     · 左上角标题：**检测到更新 🎆🎆**
     · 中间：最新版本的更新说明（Release 的 body，不是标题）
     · 右下角两个按键：左「取消」、右「更新」
     · 点「更新」→ 立刻自动下载 exe → 覆盖原软件 → 自动重启；
       已保存的 SVG / 工作进程 / 字体包 / 快捷键 / 速率等设置**一个都不能变**
     · 取消 = 本次关窗，下次启动还提示（不记「跳过此版本」）
     · 开发模式（start.bat）没有 exe 可覆盖 ⇒ 只提示不动

   数据为什么不丢：便携版的数据目录 = exe 所在目录（`appDataDir()`），
   覆盖只动那一个 exe 文件，其余目录与 settings.json 原地不动。 */
App.UPD_I18N = {
  'zh-CN': {
    'upd.title': '检测到更新 🎆🎆',
    'upd.cancel': '取消',
    'upd.update': '更新',
    'upd.busy': '更新中 {v}%',
    'upd.devHint': '当前是开发模式，请手动更新',
    'upd.noAsset': '这个版本没有可下载的 exe，请手动更新',
    'upd.fail': '更新失败：{v}',
    'upd.done': '已下载，正在重启…'
  },
  'zh-TW': {
    'upd.title': '偵測到更新 🎆🎆',
    'upd.cancel': '取消',
    'upd.update': '更新',
    'upd.busy': '更新中 {v}%',
    'upd.devHint': '目前是開發模式，請手動更新',
    'upd.noAsset': '這個版本沒有可下載的 exe，請手動更新',
    'upd.fail': '更新失敗：{v}',
    'upd.done': '已下載，正在重新啟動…'
  },
  'en': {
    'upd.title': 'Update available 🎆🎆',
    'upd.cancel': 'Cancel',
    'upd.update': 'Update',
    'upd.busy': 'Updating {v}%',
    'upd.devHint': 'Running in dev mode — please update manually',
    'upd.noAsset': 'No exe asset for this release — please update manually',
    'upd.fail': 'Update failed: {v}',
    'upd.done': 'Downloaded, restarting…'
  },
  'ja': {
    'upd.title': 'アップデートがあります 🎆🎆',
    'upd.cancel': 'キャンセル',
    'upd.update': '更新',
    'upd.busy': '更新中 {v}%',
    'upd.devHint': '開発モードのため手動で更新してください',
    'upd.noAsset': 'このリリースには exe がありません。手動で更新してください',
    'upd.fail': '更新に失敗しました：{v}',
    'upd.done': 'ダウンロード完了、再起動します…'
  },
  'ko': {
    'upd.title': '업데이트가 있습니다 🎆🎆',
    'upd.cancel': '취소',
    'upd.update': '업데이트',
    'upd.busy': '업데이트 중 {v}%',
    'upd.devHint': '개발 모드이므로 직접 업데이트하세요',
    'upd.noAsset': '이 릴리스에는 exe가 없습니다. 직접 업데이트하세요',
    'upd.fail': '업데이트 실패: {v}',
    'upd.done': '다운로드 완료, 재시작합니다…'
  }
};
Object.keys(App.UPD_I18N).forEach(function (lang) {
  if (App.i18n.dicts[lang]) Object.assign(App.i18n.dicts[lang], App.UPD_I18N[lang]);
});

App.updateDlg = {
  el: null,
  info: null,
  busy: false,

  /* Release 说明是 Markdown：这里只做「读得顺」的轻量清洗，不引入渲染器 */
  plainNotes(md) {
    let t = String(md || '');
    if (!t.trim()) return '';
    t = t.replace(/\r\n/g, '\n');
    t = t.replace(/```[\s\S]*?```/g, m => m.replace(/```[a-z]*\n?/gi, '').replace(/```/g, ''));  /* 代码块去掉围栏 */
    t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');                    /* 图片整条丢掉 */
    t = t.replace(/\[([^\]]*)\]\(([^)]*)\)/g, '$1（$2）');          /* 链接 → 文字（地址） */
    t = t.replace(/^\s{0,3}#{1,6}\s*/gm, '');                       /* 标题井号 */
    t = t.replace(/^\s{0,3}>\s?/gm, '');                            /* 引用 */
    t = t.replace(/^\s{0,3}[-*+]\s+/gm, '· ');                      /* 列表 */
    t = t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1');
    t = t.replace(/`([^`]+)`/g, '$1');
    t = t.replace(/\n{3,}/g, '\n\n');
    return t.trim();
  },

  show(info) {
    if (!info || this.busy) return;
    this.info = info;
    /* 同 id 的旧窗口可能还在关闭动画里（hideOverlay 不是立即移除）⇒ 按 id 全清，
       否则 getElementById 会拿到旧的那一个，按钮状态全错。 */
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

    /* 开发模式 / 没有 exe 附件：只提示不动（按钮禁用） */
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
    /* 直接摘掉节点：更新窗不需要关闭动画，立即移除才能保证「点取消就没了」。 */
    const el = this.el || document.getElementById('updateOv');
    this.el = null;
    if (el && el.parentNode) el.parentNode.removeChild(el);
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
      ? window.sveApi.onUpdateProgress(pr => {
        if (go && pr && typeof pr.pct === 'number') go.textContent = App.i18n.t('upd.busy').replace('{v}', String(pr.pct));
      })
      : function () { };
    try {
      const r = await window.sveApi.updateInstall({ exeUrl: this.info.exeUrl, version: this.info.remote });
      if (r && r.ok) {
        if (go) go.textContent = App.i18n.t('upd.done');
        return;   /* 主进程会自己重启，窗口随进程一起消失 */
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
      const msg = App.i18n.t('upd.fail').replace('{v}', String(e && e.message || e).slice(0, 80));
      if (typeof showToast === 'function') showToast(msg);
      else console.warn('[update]', msg);
    }
  },

  init() {
    if (!window.sveApi || !window.sveApi.onUpdateAvailable) return;
    window.sveApi.onUpdateAvailable(info => this.show(info));
  }
};
App.updateDlg.init();
