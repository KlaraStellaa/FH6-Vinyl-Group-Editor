'use strict';
/* 用户设置（语言 / 主题）：面板构建与绑定 + 持久化（preload 暴露 settingsGet/settingsSet，
   落 userData/settings.json；localStorage 作双保险）。
   主题只改 UI 颜色（CSS 变量），#canvasWrap 画布背景与 class 一律不动（判据咬死）。 */
App.settings = {
  lang: 'zh-CN',
  /* 默认主题：浅色（用户 2026-09-23 要求 —— 首次打开时用浅色）。
     已保存过设置的会读存储里的值，不受这里影响（见下方 load()）。 */
  theme: 'light',
  /* 画布拖动是否必须按住空格（默认开）。
     开 = 按住空格 + 拖动才平移画布（原有行为）；
     关 = 鼠标左键直接拖动即可平移画布（编辑模式下仍走原来的拖动图层，不抢）。 */
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
        /* 主视图与「自定义快捷键」视图互斥切换（同一个设置窗，不另开窗口） */
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
    /* EvolveUI 下拉动画：设置面板内 select 转 ev-dd */
    if (App.evDropdown) { App.evDropdown(p.querySelector('#settingLang')); App.evDropdown(p.querySelector('#settingTheme')); }
    p.querySelector('#settingLang').addEventListener('change', e => {
      const v = e.target.value;
      if (App.i18n && App.i18n.dicts[v]) { this.lang = v; App.i18n.set(v); }
    });
    p.querySelector('#settingTheme').addEventListener('change', e => {
      const v = e.target.value === 'light' ? 'light' : 'dark';
      this.theme = v;
      document.documentElement.dataset.theme = v;   /* 只动 UI 变量；#canvasWrap 不碰 */
      this.save();
    });
    /* 编辑速率 / 微调速率：两个入口用同一个窗口组件，各自编辑不同的配置对象 */
    const b1 = p.querySelector('#btnEditSpeed');
    const b2 = p.querySelector('#btnNudgeSpeed');
    if (b1) b1.addEventListener('click', () => { App.hideOverlay(p); App.speedEditor.open('wasm'); });
    if (b2) b2.addEventListener('click', () => { App.hideOverlay(p); App.speedEditor.open('nudge'); });
    /* 自定义快捷键：**不关窗**，把同一个设置窗切成快捷键视图 */
    const bk = p.querySelector('#btnKeymap');
    if (bk && App.keymapUI) bk.addEventListener('click', () => App.keymapUI.open());
    if (App.keymapUI) App.keymapUI.build(p.querySelector('.confirm-box'));
    /* 右上角 ×：语义与「关闭」按钮一致（设置窗的改动都是即时生效的，没有待确认状态）。
       注意必须在 keymapUI.build 之后 —— 快捷键视图会把 #settingsKeyView 铺进同一个 confirm-box，
       × 挂在标题行上，早挂晚挂都不冲突，但晚挂能确保标题行已成型。 */
    App.attachDlgClose(p.querySelector('.confirm-box'), () => { App.hideOverlay(p); return true; });
    this.syncPanel();
  },

  /* 面板里的两个下拉必须显示「当前实际设置」。
     2026-09-12 根因修复：initPanel 建出来的 select 默认选中项是写死的（深色 / 中文），
     从不与已保存的设置同步 → 面板会撒谎。用户报障原话：「初始主题颜色不是深色吗，我进去怎么是
     白色，设置到浅色再设置深色才恢复」——他机器上存的就是浅色（主题是持久化的、不是开机重置），
     而面板显示"深色"，看起来像初始主题错了。三处调用：建面板后 / 每次打开面板 / 读完设置后。 */
  syncPanel() {
    const t = document.getElementById('settingTheme');
    if (t && t.value !== this.theme) t.value = this.theme;
    const l = document.getElementById('settingLang');
    if (l && l.value !== this.lang) l.value = this.lang;
    /* 可见的是 ev-dd 克隆，不是这两个被隐藏的原生 select：
       只改 select.value 不改克隆，面板就会「撒谎」（退出重进后显示默认语言/主题）。 */
    if (App.evDropdownSyncAll) App.evDropdownSyncAll();
  },

  toggle() {
    const p = document.getElementById('settingsPanel');
    if (!p) return;
    if (p.classList.contains('hidden')) {
      /* 每次打开都从主视图开始（上次停在快捷键页要复位） */
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
      /* 只有**明确 false** 才关掉（老配置文件里没这个字段 → 保持默认「开」，行为不变） */
      if (s.panNeedsSpace === false) this.panNeedsSpace = false;
      this.applySpeeds(s);
      this.applyKeymap(s);
    } catch (e) { /* 无 API（异常环境）时用默认 */ }
    /* localStorage 兜底（API 不可用时仍有记忆） */
    try {
      const ls = JSON.parse(localStorage.getItem('sve-settings') || '{}');
      if (!window.sveApi.settingsGet) {
        if (ls.lang && App.i18n.dicts[ls.lang]) this.lang = ls.lang;
        if (ls.theme === 'light' || ls.theme === 'dark') this.theme = ls.theme;
        if (ls.panNeedsSpace === false) this.panNeedsSpace = false;
      }
      this.applySpeeds(ls);
      if (!window.sveApi.settingsGet) this.applyKeymap(ls);   /* 主通道已应用过就不重复覆盖 */
    } catch (e) { /* ignore */ }
    this.applyAll();
    this.syncPanel();   /* 读到的设置立刻反映到面板（面板不许与真实设置不一致） */
  },

  /* 启动时读取并校验速率配置：逐项校验，缺失/非法值回退当前（默认）值
     —— 绝不让坏值进编辑循环 */
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

  /* 快捷键绑定表：只存与默认值不同的动作（默认值将来调整时，没动过的项能跟着更新）。
     非法/缺失项由 keymap.js 的 resolve 回退默认，坏值进不了事件处理。 */
  applyKeymap(s) {
    if (!App.keymap) return;
    App.keymap.load(s && s.keymap);
    if (App.refreshShortcutPanel) App.refreshShortcutPanel();   /* 帮助窗口立刻同步新键位 */
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
    /* 保存失败不许静默伪装成功：调用方（确定按钮）据此提示用户 */
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

/* ---------- 编辑速率 / 微调速率窗口 ----------
   两个入口共用一个窗口组件，分别编辑 [editSpeeds]（WASD 连续调整）与
   [nudgeSpeeds]（方向键单步）；两套配置互不覆盖（不同配置键、不同默认值）。
   打开时保存完整快照：input 事件立即写入临时配置（用户可马上按 WASD / 方向键试），
   取消 → 恢复快照并关闭；确定 → 保留临时配置并写入持久化设置。 */
App.speedFields = ['move', 'size', 'rotate', 'skew', 'opacity'];
App.speedDefaults = {
  wasm: { move: 70, size: 95, rotate: 70, skew: 25, opacity: 30 },
  nudge: { move: 0.2, size: 0.8, rotate: 0.1, skew: 0.1, opacity: 1 }
};
App.speedRanges = {
  wasm: { move: [1, 5000], size: [1, 5000], rotate: [1, 5000], skew: [1, 5000], opacity: [1, 5000] },
  nudge: { move: [0.001, 200], size: [0.001, 200], rotate: [0.001, 180], skew: [0.001, 180], opacity: [0.001, 100] }
};
/* 有限数字 + 合理范围校验：空值/NaN/Infinity/负数/极端值一律不写入，回退 fallback */
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
    /* 建窗即套用词典：data-i18n 属性只在 apply() 时生效，不主动刷一次会是空白标签 */
    if (App.i18n && App.i18n.apply) App.i18n.apply(w);
    /* 输入：合法即写入临时配置（即时生效）；非法只标红，绝不让坏值进编辑循环 */
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
    /* 重置：临时配置回到默认值（输入框同步）—— 仍然要点「确定」才写入持久化设置；
       点「重置」后再点「取消」，一切照旧（配置回到打开窗口前的快照，默认值不留痕） */
    w.querySelector('.speed-reset').addEventListener('click', () => this.resetToDefaults());
    /* Esc 关窗 = 取消（恢复打开窗口前的配置），不冒泡给全局 Esc 链路 */
    w.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); this.cancel(); }
    });
    /* 右上角 ×：必须走 cancel() 而不是 hideOverlay —— 速率窗里输入的数字是即时写进
       临时配置的，直接隐藏会把没确认的值静默留下。 */
    App.attachDlgClose(w.querySelector('.speed-box'), () => this.cancel());
    this.el = w;
    return w;
  },

  open(kind) {
    if (kind !== 'wasm' && kind !== 'nudge') return false;
    if (this.kind) this.cancel();       // 另一个窗口开着：先按取消回滚，临时值不串台
    const w = this.build();
    this.kind = kind;
    const cfg = App.speedConfig(kind);
    this.snapshot = {};
    App.speedFields.forEach(f => { this.snapshot[f] = App.normalizeSpeed(kind, f, cfg[f], App.speedDefaults[kind][f]); });
    /* 输入框显示当前真实配置（不是写死的默认值） */
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

  /* 重置为默认值：只改临时配置 + 输入框显示，不落盘；确定才生效，取消则整窗回滚 */
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

  /* 取消：恢复打开窗口前的完整配置并关闭（切主页/切标签/关文档也走这里） */
  cancel() {
    if (!this.kind) return false;
    const cfg = App.speedConfig(this.kind);
    if (this.snapshot) Object.keys(this.snapshot).forEach(f => { cfg[f] = this.snapshot[f]; });
    this.kind = null;
    this.snapshot = null;
    if (this.el) App.hideOverlay(this.el);
    return true;
  },

  /* 确定：保留临时配置并写入持久化设置；保存失败要提示，不静默伪装成功 */
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
