'use strict';
App.settings = {
  lang: 'zh-CN',
  theme: 'light',
  panNeedsSpace: true,

  initPanel() {
    if (document.getElementById('settingsPanel')) return;
    const bar = document.getElementById('tabBar');
    if (!bar) return;
    const p = document.createElement('div');
    p.id = 'settingsPanel';
    p.className = 'confirm-overlay hidden';
    p.innerHTML =
      '<div class="confirm-box settings-box">' +
        '<div class="anchor-title" id="settingsTitle" data-i18n="settings.title">设置</div>' +
        '<div id="settingsMainView">' +
        '<div class="settings-row">' +
          '<label for="settingLang" data-i18n="settings.lang">语言 / Language</label>' +
          '<select id="settingLang">' +
            '<option data-lang="zh-CN" value="zh-CN">中文</option>' +
            '<option data-lang="zh-TW" value="zh-TW">繁體中文</option>' +
            '<option data-lang="en" value="en">English</option>' +
            '<option data-lang="ja" value="ja">日本語</option>' +
            '<option data-lang="ko" value="ko">한국어</option>' +
          '</select>' +
        '</div>' +
        '<div class="settings-row">' +
          '<label for="settingTheme" data-i18n="settings.theme">主题颜色</label>' +
          '<select id="settingTheme">' +
            '<option data-theme="dark" value="dark" data-i18n="settings.dark">深色</option>' +
            '<option data-theme="light" value="light" data-i18n="settings.light">浅色</option>' +
          '</select>' +
        '</div>' +
        '<div class="settings-row">' +
          '<label data-i18n="settings.speedWasm">更改编辑速率</label>' +
          '<button id="btnEditSpeed" class="settings-change" data-i18n="settings.change">更改</button>' +
        '</div>' +
        '<div class="settings-row">' +
          '<label data-i18n="settings.speedNudge">更改微调编辑速率</label>' +
          '<button id="btnNudgeSpeed" class="settings-change" data-i18n="settings.change">更改</button>' +
        '</div>' +
        '<div class="settings-row">' +
          '<label data-i18n="settings.keymap">自定义快捷键</label>' +
          '<button id="btnKeymap" class="settings-change" data-i18n="settings.change">更改</button>' +
        '</div>' +
        '<div class="settings-row">' +
          '<label data-i18n="log.title">日志</label>' +
          '<button id="btnLogInSettings" class="settings-change" data-i18n="log.view">查看日志</button>' +
        '</div>' +
        '<div class="anchor-btns"><button id="btnSettingsClose" data-i18n="settings.close">关闭</button></div>' +
        '</div>' +
        '<div id="settingsKeyView" class="hidden"></div>' +
      '</div>';
    document.body.appendChild(p);
    p.addEventListener('click', e => { if (e.target === p) App.hideOverlay(p); });
    p.querySelector('#btnSettingsClose').addEventListener('click', () => App.hideOverlay(p));
    if (App.evDropdown) { App.evDropdown(p.querySelector('#settingLang')); App.evDropdown(p.querySelector('#settingTheme')); }
    p.querySelector('#settingLang').addEventListener('change', e => {
      const v = e.target.value;
      if (App.i18n && App.i18n.dicts[v]) { this.lang = v; App.i18n.set(v); }
    });
    p.querySelector('#settingTheme').addEventListener('change', e => {
      const v = e.target.value === 'light' ? 'light' : 'dark';
      this.theme = v;
      document.documentElement.dataset.theme = v;
      this.save();
    });
    const b1 = p.querySelector('#btnEditSpeed');
    const b2 = p.querySelector('#btnNudgeSpeed');
    if (b1) b1.addEventListener('click', () => { App.hideOverlay(p); App.speedEditor.open('wasm'); });
    if (b2) b2.addEventListener('click', () => { App.hideOverlay(p); App.speedEditor.open('nudge'); });
    const bk = p.querySelector('#btnKeymap');
    if (bk && App.keymapUI) bk.addEventListener('click', () => App.keymapUI.open());
    if (App.keymapUI) App.keymapUI.build(p.querySelector('.confirm-box'));
    App.attachDlgClose(p.querySelector('.confirm-box'), () => { App.hideOverlay(p); return true; });
    this.syncPanel();
  },

  syncPanel() {
    const t = document.getElementById('settingTheme');
    if (t && t.value !== this.theme) t.value = this.theme;
    const l = document.getElementById('settingLang');
    if (l && l.value !== this.lang) l.value = this.lang;
    if (App.evDropdownSyncAll) App.evDropdownSyncAll();
  },

  toggle() {
    const p = document.getElementById('settingsPanel');
    if (!p) return;
    if (p.classList.contains('hidden')) {
      if (App.keymapUI) App.keymapUI.showMainView();
      this.syncPanel(); App.showOverlay(p);
    } else App.hideOverlay(p);
  },

  applyAll() {
    document.documentElement.dataset.theme = this.theme;
    if (App.i18n) {
      if (App.i18n.dicts[this.lang]) App.i18n.lang = this.lang;
      document.documentElement.lang = App.i18n.lang;
      App.i18n.apply();
    }
  },

  async load() {
    try {
      const r = await window.sveApi.settingsGet();
      const s = (r && r.settings) || r || {};
      if (s.lang && App.i18n && App.i18n.dicts[s.lang]) this.lang = s.lang;
      if (s.theme === 'light' || s.theme === 'dark') this.theme = s.theme;
      if (s.panNeedsSpace === false) this.panNeedsSpace = false;
      this.applySpeeds(s);
      this.applyKeymap(s);
    } catch (e) { }
    try {
      const ls = JSON.parse(localStorage.getItem('sve-settings') || '{}');
      if (!window.sveApi.settingsGet) {
        if (ls.lang && App.i18n.dicts[ls.lang]) this.lang = ls.lang;
        if (ls.theme === 'light' || ls.theme === 'dark') this.theme = ls.theme;
        if (ls.panNeedsSpace === false) this.panNeedsSpace = false;
      }
      this.applySpeeds(ls);
      if (!window.sveApi.settingsGet) this.applyKeymap(ls);
    } catch (e) { /* ignore */ }
    this.applyAll();
    this.syncPanel();
  },

  applySpeeds(s) {
    if (!s || !App.state) return;
    const put = (kind, key, store) => {
      if (!store) return;
      App.state[key] = App.state[key] || {};
      App.speedFields.forEach(f => {
        App.state[key][f] = App.normalizeSpeed(kind, f, store[f], App.state[key][f]);
      });
    };
    put('wasm', 'editSpeeds', s.editSpeeds);
    put('nudge', 'nudgeSpeeds', s.nudgeSpeeds);
  },

  applyKeymap(s) {
    if (!App.keymap) return;
    App.keymap.load(s && s.keymap);
    if (App.refreshShortcutPanel) App.refreshShortcutPanel();
  },

  save() {
    const payload = {
      lang: this.lang, theme: this.theme,
      panNeedsSpace: this.panNeedsSpace !== false,
      editSpeeds: Object.assign({}, App.state.editSpeeds),
      nudgeSpeeds: Object.assign({}, App.state.nudgeSpeeds),
      keymap: App.keymap ? App.keymap.payload() : undefined
    };
    try { localStorage.setItem('sve-settings', JSON.stringify(payload)); } catch (e) { /* ignore */ }
    try {
      if (window.sveApi && window.sveApi.settingsSet) {
        return Promise.resolve(window.sveApi.settingsSet(payload)).then(r => {
          if (r && r.ok === false) {
            console.warn('[settings] 保存失败', r.error);
            return { ok: false, error: String(r.error || 'unknown') };
          }
          return { ok: true };
        }).catch(e => {
          console.warn('[settings] 保存异常', e);
          return { ok: false, error: String((e && e.message) || e) };
        });
      }
    } catch (e) {
      console.warn('[settings] 保存异常', e);
      return Promise.resolve({ ok: false, error: String((e && e.message) || e) });
    }
    return Promise.resolve({ ok: true });
  }
};

App.speedFields = ['move', 'size', 'rotate', 'skew', 'opacity'];
App.speedDefaults = {
  wasm: { move: 70, size: 95, rotate: 70, skew: 32, opacity: 30 },
  nudge: { move: 0.5, size: 1, rotate: 0.2, skew: 2, opacity: 1 }
};
App.speedRanges = {
  wasm: { move: [1, 5000], size: [1, 5000], rotate: [1, 5000], skew: [1, 5000], opacity: [1, 5000] },
  nudge: { move: [0.001, 200], size: [0.001, 200], rotate: [0.001, 180], skew: [0.001, 180], opacity: [0.001, 100] }
};
App.normalizeSpeed = function (kind, field, v, fallback) {
  const r = (App.speedRanges[kind] || {})[field] || [0.0001, 1e6];
  const n = Number(v);
  if (v === undefined || v === null || v === '' || typeof v === 'boolean' || !isFinite(n) || n < r[0] || n > r[1]) return fallback;
  return n;
};
App.speedConfig = function (kind) {
  return kind === 'nudge' ? App.state.nudgeSpeeds : App.state.editSpeeds;
};

App.speedEditor = {
  kind: null,
  snapshot: null,
  el: null,

  build() {
    if (this.el && this.el.isConnected) return this.el;
    const host = document.getElementById('canvasWrap') || document.body;
    const w = document.createElement('div');
    w.id = 'speedPanel';
    w.className = 'hidden';
    const cells = App.speedFields.map(f =>
      '<div class="speed-cell">' +
        '<label class="speed-label" data-i18n="speed.' + f + '"></label>' +
        '<input class="speed-input" type="number" step="any" data-speed="' + f + '">' +
      '</div>').join('');
    w.innerHTML = '<div class="speed-box">' +
      '<div class="speed-title" id="speedTitle"></div>' +
      '<div class="speed-row">' + cells + '</div>' +
      '<div class="speed-reset-row"><button class="speed-reset" data-i18n="speed.reset"></button></div>' +
      '<div class="anchor-btns">' +
        '<button class="speed-cancel" data-i18n="speed.cancel"></button>' +
        '<button class="speed-ok" data-i18n="speed.ok"></button>' +
      '</div></div>';
    host.appendChild(w);
    if (App.i18n && App.i18n.apply) App.i18n.apply(w);
    w.addEventListener('input', e => {
      const inp = e.target && e.target.closest ? e.target.closest('.speed-input') : null;
      if (!inp || !this.kind) return;
      const f = inp.getAttribute('data-speed');
      const cfg = App.speedConfig(this.kind);
      const r = App.speedRanges[this.kind][f];
      const n = Number(inp.value);
      const bad = (inp.value === '' || !isFinite(n) || n < r[0] || n > r[1]);
      inp.classList.toggle('speed-bad', bad);
      if (bad) return;
      cfg[f] = n;
    });
    w.querySelector('.speed-cancel').addEventListener('click', () => this.cancel());
    w.querySelector('.speed-ok').addEventListener('click', () => this.commit());
    w.querySelector('.speed-reset').addEventListener('click', () => this.resetToDefaults());
    w.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); this.cancel(); return; }
      if (e.key === 'Enter') {
        const inp = e.target && e.target.closest ? e.target.closest('.speed-input') : null;
        if (inp) { e.stopPropagation(); e.preventDefault(); inp.blur(); }
      }
    });
    App.attachDlgClose(w.querySelector('.speed-box'), () => this.cancel());
    this.el = w;
    return w;
  },

  open(kind) {
    if (kind !== 'wasm' && kind !== 'nudge') return false;
    if (this.kind) this.cancel();
    const w = this.build();
    this.kind = kind;
    const cfg = App.speedConfig(kind);
    this.snapshot = {};
    App.speedFields.forEach(f => { this.snapshot[f] = App.normalizeSpeed(kind, f, cfg[f], App.speedDefaults[kind][f]); });
    App.speedFields.forEach(f => {
      const inp = w.querySelector('.speed-input[data-speed="' + f + '"]');
      if (inp) { inp.value = String(this.snapshot[f]); inp.classList.remove('speed-bad'); }
    });
    const title = w.querySelector('#speedTitle');
    const key = 'speed.title.' + kind;
    title.setAttribute('data-i18n', key);
    title.textContent = App.i18n.t(key);
    App.showOverlay(w);
    return true;
  },

  resetToDefaults() {
    if (!this.kind) return false;
    const w = this.el;
    if (!w) return false;
    const kind = this.kind;
    const cfg = App.speedConfig(kind);
    App.speedFields.forEach(f => {
      const v = App.speedDefaults[kind][f];
      cfg[f] = v;
      const inp = w.querySelector('.speed-input[data-speed="' + f + '"]');
      if (inp) { inp.value = String(v); inp.classList.remove('speed-bad'); }
    });
    return true;
  },

  cancel() {
    if (!this.kind) return false;
    const cfg = App.speedConfig(this.kind);
    if (this.snapshot) Object.keys(this.snapshot).forEach(f => { cfg[f] = this.snapshot[f]; });
    this.kind = null;
    this.snapshot = null;
    if (this.el) App.hideOverlay(this.el);
    return true;
  },

  commit() {
    if (!this.kind) return false;
    this.kind = null;
    this.snapshot = null;
    if (this.el) App.hideOverlay(this.el);
    const p = App.settings.save();
    if (p && p.then) {
      p.then(r => {
        if (r && r.ok === false) showToast(App.i18n.tf('toast.speed.saveFail', { v: r.error || '' }));
        else showToast(App.i18n.t('toast.speed.saved'));
      });
    }
    return true;
  },

  isOpen() { return !!this.kind; }
};

App.settings.initPanel();
App.settings.load();
