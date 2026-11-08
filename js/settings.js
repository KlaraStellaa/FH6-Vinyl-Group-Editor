'use strict';

App.settings = {
  lang: 'zh-CN',
  
  theme: 'light',
  
  
  customTheme: null,
  
  helpHintAck: false,
  
  legacyHintAck: false,
  themeOf(id) { return App.theme.presetOf(id) || (id === App.theme.CUSTOM_ID ? { id: id, scheme: App.theme.schemeOf((this.customTheme || {}).bg || '#F8FAFD') } : null); },
  
  applyTheme(id, seeds) {
    let r;
    if (id === App.theme.CUSTOM_ID) {
      this.customTheme = Object.assign({}, App.theme.defaultSeeds(), this.customTheme || {}, seeds || {});
      r = App.theme.applyCustom(this.customTheme);
    } else {
      r = App.theme.applyPreset(id);
    }
    this.theme = r.id;
    return r;
  },
  
  panNeedsSpace: true,
  
  quickClick: false,

  
  autoSave: { enabled: true, intervalMin: 15, limit: 15 },

  
  presetPreview(id) {
    const want = id === 'dark' ? ':root' : 'html[data-theme="' + id + '"]';
    for (const sheet of Array.from(document.styleSheets || [])) {
      let rules = null;
      try { rules = sheet.cssRules; } catch (e) { continue; }   
      for (const r of Array.from(rules || [])) {
        if (r.selectorText !== want || !r.style) continue;
        const bg = r.style.getPropertyValue('--bg').trim();
        if (!bg) continue;                                       
        return {
          bg: bg,
          panel: r.style.getPropertyValue('--panel').trim(),
          accent: r.style.getPropertyValue('--accent').trim(),
          text: r.style.getPropertyValue('--text').trim()
        };
      }
    }
    return null;
  },

  
  themeName(id) {
    const t = App.theme.presetOf(id);
    if (t) return (App.i18n && App.i18n.t(t.key)) || t.zh;
    return id === App.theme.CUSTOM_ID ? App.i18n.t('theme.custom') : id;
  },

  buildThemeView() {
    const el = document.getElementById('settingsThemeView');
    if (!el || el.dataset.built === '1') return el;
    const t = k => App.i18n.t(k);
    const tile = th => {
      const p = this.presetPreview(th.id) || {};
      const style = p.bg ? ' style="--pv-bg:' + p.bg + ';--pv-panel:' + p.panel + ';--pv-accent:' + p.accent + '"' : '';
      return '<button type="button" class="tm-tile" data-theme-id="' + th.id + '"' + style + '>' +
        '<span class="tm-mock"><i class="tm-m-bg"></i><i class="tm-m-panel"></i><i class="tm-m-accent"></i></span>' +
        
        '<span class="tm-name" data-i18n="' + th.key + '">' + ((App.i18n && App.i18n.t(th.key)) || th.zh) + '</span>' +
        '</button>';
    };
    el.innerHTML =
      '<div class="tm-head" data-i18n="theme.presets">预设</div>' +
      '<div class="tm-grid">' + App.theme.THEMES.map(tile).join('') + '</div>' +
      '<div class="tm-head tm-head-custom" data-i18n="theme.custom">自定义</div>' +
      '<div class="tm-custom">' +
        '<div class="tm-seeds">' +
          '<label class="tm-seed"><span data-i18n="theme.seed.bg">底色</span><input type="color" id="tmSeedBg"></label>' +
          '<label class="tm-seed"><span data-i18n="theme.seed.panel">面板</span><input type="color" id="tmSeedPanel"></label>' +
          '<label class="tm-seed"><span data-i18n="theme.seed.accent">强调色</span><input type="color" id="tmSeedAccent"></label>' +
          '<label class="tm-seed"><span data-i18n="theme.seed.text">正文色</span><input type="color" id="tmSeedText"></label>' +
        '</div>' +
        '<div class="tm-preview" id="tmPreview">' +
          '<div class="tm-pv-top"></div>' +
          '<div class="tm-pv-body"><span class="tm-pv-side"></span>' +
            '<span class="tm-pv-main"><i class="tm-pv-line"></i><i class="tm-pv-line dim"></i>' +
            '<span class="tm-pv-btns"><i></i><i class="accent"></i></span></span>' +
          '</div>' +
        '</div>' +
        '<div class="tm-warn hidden" id="tmWarn"></div>' +
        '<div class="tm-custom-btns">' +
          '<button id="tmResetCustom" data-i18n="theme.custom.reset">恢复默认</button>' +
          '<button id="tmApplyCustom" data-i18n="theme.custom.apply">应用自定义</button>' +
        '</div>' +
      '</div>' +
      '<div class="tm-foot"><button id="tmBack" data-i18n="theme.back">返回</button></div>';
    el.dataset.built = '1';
    
    if (App.i18n && App.i18n.apply) App.i18n.apply(el);
    
    el.querySelectorAll('.tm-tile').forEach(b => {
      b.addEventListener('click', () => {
        this.applyTheme(b.getAttribute('data-theme-id'));
        this.save();
        this.syncPanel();
      });
    });
    const seedIds = { bg: 'tmSeedBg', panel: 'tmSeedPanel', accent: 'tmSeedAccent', text: 'tmSeedText' };
    const readSeeds = () => {
      const o = {};
      Object.keys(seedIds).forEach(k => { o[k] = el.querySelector('#' + seedIds[k]).value; });
      return o;
    };
    
    el.querySelectorAll('.tm-seed input').forEach(inp => {
      inp.addEventListener('input', () => this.previewCustom(readSeeds()));
      inp.addEventListener('change', () => { this.applyTheme(App.theme.CUSTOM_ID, readSeeds()); this.save(); this.syncPanel(); });
    });
    el.querySelector('#tmApplyCustom').addEventListener('click', () => {
      this.applyTheme(App.theme.CUSTOM_ID, readSeeds());
      this.save();
      this.syncPanel();
    });
    el.querySelector('#tmResetCustom').addEventListener('click', () => {
      const d = App.theme.defaultSeeds();
      Object.keys(seedIds).forEach(k => { el.querySelector('#' + seedIds[k]).value = d[k]; });
      this.previewCustom(d);
    });
    el.querySelector('#tmBack').addEventListener('click', () => this.showMainView());
    return el;
  },

  
  previewCustom(seeds) {
    const el = document.getElementById('tmPreview');
    if (!el) return;
    const r = App.theme.derive(seeds);
    const v = r.vars;
    el.setAttribute('style',
      '--pv-bg:' + v['--bg'] + ';--pv-panel:' + v['--panel'] + ';--pv-accent:' + v['--accent'] +
      ';--pv-text:' + v['--text'] + ';--pv-dim:' + v['--dim'] + ';--pv-btn:' + v['--btn-bg'] +
      ';--pv-border:' + v['--border']);
    const warn = document.getElementById('tmWarn');
    const bad = App.theme.customWarnings(seeds);
    if (warn) {
      if (bad.length) {
        warn.textContent = App.i18n.t('theme.warn').replace('{v}', bad.map(b => b.key + ' ' + b.value).join(' / '));
        warn.classList.remove('hidden');
      } else warn.classList.add('hidden');
    }
  },

  
  openThemeView() {
    const box = document.getElementById('settingsPanel');
    if (!box) return false;
    const el = this.buildThemeView();
    const main = box.querySelector('#settingsMainView');
    const key = box.querySelector('#settingsKeyView');
    const title = box.querySelector('#settingsTitle');
    if (main) main.classList.add('hidden');
    if (key) key.classList.add('hidden');
    if (el) el.classList.remove('hidden');
    
    if (el && App.i18n && App.i18n.apply) App.i18n.apply(el);
    const cb = box.querySelector('.confirm-box');
    if (cb) cb.classList.add('tm-mode');
    if (title) { title.setAttribute('data-i18n', 'settings.theme'); title.textContent = App.i18n.t('settings.theme'); }
    
    const seeds = this.theme === App.theme.CUSTOM_ID && this.customTheme
      ? Object.assign({}, App.theme.defaultSeeds(), this.customTheme)
      : App.theme.defaultSeeds();
    const map = { bg: 'tmSeedBg', panel: 'tmSeedPanel', accent: 'tmSeedAccent', text: 'tmSeedText' };
    Object.keys(map).forEach(k => { const i = el && el.querySelector('#' + map[k]); if (i) i.value = seeds[k]; });
    this.previewCustom(seeds);
    this.syncThemeView();
    return true;
  },

  
  syncThemeView() {
    const el = document.getElementById('settingsThemeView');
    if (!el || el.dataset.built !== '1') return;
    el.querySelectorAll('.tm-tile').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-theme-id') === this.theme);
    });
    const now = document.getElementById('themeNowName');
    if (now) now.textContent = this.themeName(this.theme);
  },

  
  showMainView() {
    if (App.keymapUI) App.keymapUI.showMainView();
    const box = document.getElementById('settingsPanel');
    if (!box) return;
    const main = box.querySelector('#settingsMainView');
    const key = box.querySelector('#settingsKeyView');
    const tv = box.querySelector('#settingsThemeView');
    const fv = box.querySelector('#settingsFontView');
    const title = box.querySelector('#settingsTitle');
    if (main) main.classList.remove('hidden');
    if (key) key.classList.add('hidden');
    if (tv) tv.classList.add('hidden');
    if (fv) fv.classList.add('hidden');
    const cb = box.querySelector('.confirm-box');
    if (cb) cb.classList.remove('tm-mode', 'km-mode', 'ft-mode');
    if (title) { title.setAttribute('data-i18n', 'settings.title'); title.textContent = App.i18n.t('settings.title'); }
  },

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
          '<label for="btnTheme" data-i18n="settings.theme">主题颜色</label>' +
          '<span class="settings-now">' +
            '<span id="themeNowName"></span>' +
            '<button id="btnTheme" class="settings-change" data-i18n="settings.change">更改</button>' +
          '</span>' +
        '</div>' +
        
        '<div class="settings-row" id="settingsFontRow">' +
          '<label data-i18n="settings.font">更改字体</label>' +
          '<span class="settings-now">' +
            
            '<button id="btnFont" class="settings-change" data-i18n="settings.change">更改</button>' +
          '</span>' +
        '</div>' +
        
        '<div class="settings-row">' +
          '<label data-i18n="settings.speedAll">调整编辑速率</label>' +
          '<button id="btnSpeedAll" class="settings-change" data-i18n="settings.change">更改</button>' +
        '</div>' +
        '<div class="settings-row">' +
          '<label data-i18n="settings.keymap">自定义快捷键</label>' +
          '<button id="btnKeymap" class="settings-change" data-i18n="settings.change">更改</button>' +
        '</div>' +
        '<div class="settings-row">' +
          '<label data-i18n="settings.autosave">自动保存工作进程</label>' +
          '<button id="btnAutoSave" class="settings-change" data-i18n="settings.change">更改</button>' +
        '</div>' +
        '<div class="settings-row">' +
          '<label data-i18n="log.title">日志</label>' +
          '<button id="btnLogInSettings" class="settings-change" data-i18n="log.view">查看日志</button>' +
        '</div>' +
        '<div class="anchor-btns"><button id="btnSettingsClose" data-i18n="settings.close">关闭</button></div>' +
        '</div>' +
        '<div id="settingsKeyView" class="hidden"></div>' +
        '<div id="settingsThemeView" class="hidden"></div>' +
        '<div id="settingsFontView" class="hidden"></div>' +
      '</div>';
    document.body.appendChild(p);
    p.addEventListener('click', e => { if (e.target === p) App.hideOverlay(p); });
    p.querySelector('#btnSettingsClose').addEventListener('click', () => App.hideOverlay(p));
    
    if (App.evDropdown) { App.evDropdown(p.querySelector('#settingLang')); }
    p.querySelector('#settingLang').addEventListener('change', e => {
      const v = e.target.value;
      if (App.i18n && App.i18n.dicts[v]) { this.lang = v; App.i18n.set(v); }
    });
    
    const btnTheme = p.querySelector('#btnTheme');
    if (btnTheme) btnTheme.addEventListener('click', () => this.openThemeView());
    
    const btnFont = p.querySelector('#btnFont');
    if (btnFont) btnFont.addEventListener('click', () => { if (App.fonts) App.fonts.open(); });
    
    const b1 = p.querySelector('#btnSpeedAll');
    if (b1) b1.addEventListener('click', () => { App.hideOverlay(p); App.speedOverview.open(); });
    
    const bk = p.querySelector('#btnKeymap');
    if (bk && App.keymapUI) bk.addEventListener('click', () => App.keymapUI.open());
    
    const ba = p.querySelector('#btnAutoSave');
    if (ba) ba.addEventListener('click', () => { App.hideOverlay(p); App.autoSaveEditor.open(); });
    if (App.keymapUI) App.keymapUI.build(p.querySelector('.confirm-box'));
    
    App.attachDlgClose(p.querySelector('.confirm-box'), () => { App.hideOverlay(p); return true; });
    this.syncPanel();
  },

  
  syncPanel() {
    const now = document.getElementById('themeNowName');
    if (now) now.textContent = this.themeName(this.theme);
    const l = document.getElementById('settingLang');
    if (l && l.value !== this.lang) l.value = this.lang;
    
    if (App.evDropdownSyncAll) App.evDropdownSyncAll();
    this.syncThemeView();
    if (App.fonts) App.fonts.syncPanel();
  },

  toggle() {
    const p = document.getElementById('settingsPanel');
    if (!p) return;
    if (p.classList.contains('hidden')) {
      
      this.showMainView();
      this.syncPanel(); App.showOverlay(p);
    } else App.hideOverlay(p);
  },

  applyAll() {
    this.applyTheme(this.theme);
    if (App.i18n) {
      if (App.i18n.dicts[this.lang]) App.i18n.lang = this.lang;
      document.documentElement.lang = App.i18n.lang;
      App.i18n.apply();
    }
  },

  
  async whenReady() {
    const ready = () => !!(App.state && App.gpmap && App.fonts);
    for (let i = 0; i < 200 && !ready(); i++) await new Promise(r => setTimeout(r, 15));
    return ready();
  },

  async load() {
    await this.whenReady();
    try {
      const r = await window.sveApi.settingsGet();
      const s = (r && r.settings) || r || {};
      if (s.lang && App.i18n && App.i18n.dicts[s.lang]) this.lang = s.lang;
      
      if (s.customTheme && typeof s.customTheme === 'object') this.customTheme = s.customTheme;
      
      if (this.themeOf(s.theme)) this.theme = s.theme;
      
      if (s.panNeedsSpace === false) this.panNeedsSpace = false;
      
      if (s.quickClick === true) this.quickClick = true;
      this.applyAutoSave(s.autoSave);
      this.applySpeeds(s);
      this.applyKeymap(s);
      
      if (App.Favorites) App.Favorites.load(s.favorites);
      if (App.gpmap) App.gpmap.load(s.gpmap);
      
      if (App.xbind) App.xbind.load(s.xbind);
      if (App.fonts) App.fonts.load(s);
      
      if (s.helpHintAck === true) this.helpHintAck = true;
      
      if (s.legacyHintAck === true) this.legacyHintAck = true;
    } catch (e) {  }
    
    try {
      const ls = JSON.parse(localStorage.getItem('sve-settings') || '{}');
      if (!window.sveApi.settingsGet) {
        if (ls.lang && App.i18n.dicts[ls.lang]) this.lang = ls.lang;
        if (ls.customTheme && typeof ls.customTheme === 'object') this.customTheme = ls.customTheme;
        if (this.themeOf(ls.theme)) this.theme = ls.theme;
        if (ls.panNeedsSpace === false) this.panNeedsSpace = false;
        if (ls.quickClick === true) this.quickClick = true;
        this.applyAutoSave(ls.autoSave);
      }
      
      if (!window.sveApi.settingsGet) this.applySpeeds(ls);
      if (!window.sveApi.settingsGet) this.applyKeymap(ls);   
      
      if (App.Favorites && !window.sveApi.settingsGet) App.Favorites.load(ls.favorites);
      if (App.gpmap && !window.sveApi.settingsGet) App.gpmap.load(ls.gpmap);
      if (App.xbind && !window.sveApi.settingsGet) App.xbind.load(ls.xbind);
    } catch (e) {  }
    
    if (App.restartHistAnchors) App.restartHistAnchors();
    this.applyAll();
    this.syncPanel();   
    
    if (App.helpHint) App.helpHint.check();
  },

  
  applyAutoSave(a) {
    const d = App.autoSaveDefaults;
    const num = (v, lo, hi, fb) => {
      if (typeof v === 'boolean' || v === undefined || v === null || v === '') return fb;
      const n = Number(v);
      if (!isFinite(n) || n < lo || n > hi) return fb;
      return Math.round(n);
    };
    this.autoSave = {
      enabled: !a || a.enabled !== false,
      intervalMin: a ? num(a.intervalMin, App.autoSaveRanges.intervalMin[0], App.autoSaveRanges.intervalMin[1], d.intervalMin) : d.intervalMin,
      limit: a ? num(a.limit, App.autoSaveRanges.limit[0], App.autoSaveRanges.limit[1], d.limit) : d.limit
    };
    return this.autoSave;
  },

  
  applySpeeds(s) {
    if (!s || !App.state) return;
    const put = (kind, key, store) => {
      if (!store) return;
      App.state[key] = App.state[key] || {};
      App.speedFieldsByKind[kind].forEach(f => {
        App.state[key][f] = App.normalizeSpeed(kind, f, store[f], App.state[key][f]);
      });
    };
    put('wasm', 'editSpeeds', s.editSpeeds);
    put('nudge', 'nudgeSpeeds', s.nudgeSpeeds);
    
    put('drag', 'dragSpeeds', s.dragSpeeds);
  },

  
  applyKeymap(s) {
    if (!App.keymap) return;
    App.keymap.load(s && s.keymap);
    if (App.refreshShortcutPanel) App.refreshShortcutPanel();   
  },

  save() {
    const payload = {
      lang: this.lang, theme: this.theme,
      
      customTheme: this.theme === App.theme.CUSTOM_ID ? Object.assign({}, this.customTheme) : undefined,
      panNeedsSpace: this.panNeedsSpace !== false,
      
      quickClick: this.quickClick === true,
      
      autoSave: {
        enabled: this.autoSave.enabled !== false,
        intervalMin: this.autoSave.intervalMin,
        limit: this.autoSave.limit
      },
      editSpeeds: Object.assign({}, App.state.editSpeeds),
      nudgeSpeeds: Object.assign({}, App.state.nudgeSpeeds),
      
      dragSpeeds: Object.assign({}, App.state.dragSpeeds),
      keymap: App.keymap ? App.keymap.payload() : undefined,
      
      gpmap: App.gpmap ? App.gpmap.payload() : undefined,
      
      xbind: App.xbind ? App.xbind.payload() : undefined,
      
      favorites: App.Favorites ? App.Favorites.payload() : [],
      
      helpHintAck: this.helpHintAck === true,
      
      legacyHintAck: this.legacyHintAck === true,
      
      font: App.fonts ? App.fonts.payload() : undefined
    };
    try { localStorage.setItem('sve-settings', JSON.stringify(payload)); } catch (e) {  }
    
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


App.speedFieldsByKind = {
  wasm: ['move', 'size', 'rotate', 'skew', 'opacity'],
  nudge: ['move', 'size', 'rotate', 'skew', 'opacity'],
  
  drag: ['move', 'size', 'rotate', 'skew']
};
App.speedFields = App.speedFieldsByKind.wasm;   
App.speedDefaults = {
  wasm: { move: 70, size: 95, rotate: 70, skew: 32, opacity: 30 },
  nudge: { move: 0.5, size: 1, rotate: 0.2, skew: 2, opacity: 1 },
  drag: { move: 1, size: 1, rotate: 1, skew: 1 }
};
App.speedRanges = {
  wasm: { move: [1, 5000], size: [1, 5000], rotate: [1, 5000], skew: [1, 5000], opacity: [1, 5000] },
  nudge: { move: [0.001, 200], size: [0.001, 200], rotate: [0.001, 180], skew: [0.001, 180], opacity: [0.001, 100] },
  
  drag: { move: [0.01, 20], size: [0.01, 20], rotate: [0.01, 20], skew: [0.01, 20] }
};

App.normalizeSpeed = function (kind, field, v, fallback) {
  const r = (App.speedRanges[kind] || {})[field] || [0.0001, 1e6];
  const n = Number(v);
  if (v === undefined || v === null || v === '' || typeof v === 'boolean' || !isFinite(n) || n < r[0] || n > r[1]) return fallback;
  return n;
};
App.speedConfig = function (kind) {
  if (kind === 'nudge') return App.state.nudgeSpeeds;
  if (kind === 'drag') return App.state.dragSpeeds;
  return App.state.editSpeeds;
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
      '<div class="speed-cell" data-f="' + f + '">' +
        '<label class="speed-label" data-i18n="speed.' + f + '"></label>' +
        
        '<input class="speed-input" type="number" step="0.1" data-speed="' + f + '">' +
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
    w.querySelector('.speed-cancel').addEventListener('click', () => this.cancel({ back: true }));
    w.querySelector('.speed-ok').addEventListener('click', () => this.commit({ back: true }));
    
    w.querySelector('.speed-reset').addEventListener('click', () => this.resetToDefaults());
    
    w.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); this.cancel({ back: true }); return; }
      if (e.key === 'Enter') {
        const inp = e.target && e.target.closest ? e.target.closest('.speed-input') : null;
        if (inp) { e.stopPropagation(); e.preventDefault(); inp.blur(); }
      }
    });
    
    App.attachDlgClose(w.querySelector('.speed-box'), () => this.cancel({ back: true }));
    this.el = w;
    return w;
  },

  open(kind, opts) {
    if (!App.speedFieldsByKind[kind]) return false;
    
    if (this.kind) { this.backTo = null; this.cancel(); }
    const w = this.build();
    this.kind = kind;
    this.backTo = (opts && opts.backTo) || null;
    const fields = App.speedFieldsByKind[kind];
    const cfg = App.speedConfig(kind);
    this.snapshot = {};
    
    App.speedFields.forEach(f => {
      const cell = w.querySelector('.speed-cell[data-f="' + f + '"]');
      if (cell) cell.style.display = fields.indexOf(f) >= 0 ? '' : 'none';
    });
    fields.forEach(f => { this.snapshot[f] = App.normalizeSpeed(kind, f, cfg[f], App.speedDefaults[kind][f]); });
    
    fields.forEach(f => {
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
    App.speedFieldsByKind[kind].forEach(f => {
      const v = App.speedDefaults[kind][f];
      cfg[f] = v;
      const inp = w.querySelector('.speed-input[data-speed="' + f + '"]');
      if (inp) { inp.value = String(v); inp.classList.remove('speed-bad'); }
    });
    return true;
  },

  
  cancel(opts) {
    if (!this.kind) return false;
    const cfg = App.speedConfig(this.kind);
    if (this.snapshot) Object.keys(this.snapshot).forEach(f => { cfg[f] = this.snapshot[f]; });
    this.kind = null;
    this.snapshot = null;
    if (this.el) App.hideOverlay(this.el);
    const back = (opts && opts.back) ? this.backTo : null;
    this.backTo = null;
    if (back && App.speedOverview) App.speedOverview.open();
    return true;
  },

  
  commit(opts) {
    if (!this.kind) return false;
    this.kind = null;
    this.snapshot = null;
    if (this.el) App.hideOverlay(this.el);
    const back = (opts && opts.back) ? this.backTo : null;
    this.backTo = null;
    if (back && App.speedOverview) App.speedOverview.open();
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


App.speedOverview = {
  el: null,

  build() {
    if (this.el && this.el.isConnected) return this.el;
    const p = document.createElement('div');
    p.id = 'speedOverviewPanel';
    p.className = 'confirm-overlay hidden';
    const row = (kind, labelKey) =>
      '<div class="settings-row">' +
        '<label data-i18n="' + labelKey + '"></label>' +
        '<button class="settings-change" data-speed-open="' + kind + '" data-i18n="settings.change"></button>' +
      '</div>';
    p.innerHTML = '<div class="confirm-box settings-box">' +
      '<div class="anchor-title" data-i18n="speed.overview.title"></div>' +
      row('wasm', 'speed.overview.base') +
      row('nudge', 'speed.overview.nudge') +
      row('drag', 'speed.overview.drag') +
      '<div class="anchor-btns"><button class="speed-ov-close" data-i18n="settings.close"></button></div>' +
      '</div>';
    document.body.appendChild(p);
    if (App.i18n && App.i18n.apply) App.i18n.apply(p);
    p.addEventListener('click', e => { if (e.target === p) this.close(); });
    p.querySelector('.speed-ov-close').addEventListener('click', () => this.close());
    p.querySelectorAll('[data-speed-open]').forEach(b => {
      b.addEventListener('click', () => {
        const kind = b.getAttribute('data-speed-open');
        this.close();
        
        App.speedEditor.open(kind, { backTo: 'overview' });
      });
    });
    App.attachDlgClose(p.querySelector('.confirm-box'), () => { this.close(); return true; });
    this.el = p;
    return p;
  },

  open() {
    const p = this.build();
    
    if (App.i18n && App.i18n.apply) App.i18n.apply(p);
    App.showOverlay(p);
    
    if (!this._esc) {
      this._esc = e => {
        if (e.key === 'Escape' && this.isOpen()) {
          e.stopPropagation(); e.preventDefault(); this.close();
        }
      };
      document.addEventListener('keydown', this._esc, true);
    }
    return true;
  },

  
  close() {
    if (this.el) App.hideOverlay(this.el);
    if (this._esc) { document.removeEventListener('keydown', this._esc, true); this._esc = null; }
    return true;
  },

  isOpen() {
    return !!(this.el && this.el.isConnected && !this.el.classList.contains('hidden'));
  }
};


App.autoSaveDefaults = { enabled: true, intervalMin: 15, limit: 15 };
App.autoSaveRanges = { intervalMin: [1, 1440], limit: [1, 1000] };

App.autoSaveEditor = {
  el: null,

  build() {
    if (this.el && this.el.isConnected) return this.el;
    
    const host = document.body;
    const w = document.createElement('div');
    w.id = 'autoSavePanel';
    w.className = 'hidden';
    w.innerHTML = '<div class="speed-box autosave-box">' +
      '<div class="speed-title" id="autoSaveTitle"></div>' +
      '<div class="autosave-row autosave-switch">' +
        '<label data-i18n="autosave.enabled"></label>' +
        '<button type="button" class="autosave-toggle" role="switch" aria-checked="true"></button>' +
      '</div>' +
      '<div class="autosave-row">' +
        '<label for="autoSaveInterval" data-i18n="autosave.interval"></label>' +
        '<input id="autoSaveInterval" class="speed-input" type="number" min="1" max="1440" step="1">' +
      '</div>' +
      '<div class="autosave-row">' +
        '<label for="autoSaveLimit" data-i18n="autosave.limit"></label>' +
        '<input id="autoSaveLimit" class="speed-input" type="number" min="1" max="1000" step="1">' +
      '</div>' +
      '<div class="anchor-btns">' +
        '<button class="autosave-reset" data-i18n="autosave.reset"></button>' +
        '<button class="autosave-cancel" data-i18n="autosave.cancel"></button>' +
        '<button class="autosave-ok" data-i18n="autosave.ok"></button>' +
      '</div></div>';
    host.appendChild(w);
    
    if (App.i18n && App.i18n.apply) App.i18n.apply(w);
    w.querySelector('.autosave-toggle').addEventListener('click', () => this.toggleEnabled());
    w.querySelector('.autosave-reset').addEventListener('click', () => this.resetToDefaults());
    w.querySelector('.autosave-cancel').addEventListener('click', () => this.cancel());
    w.querySelector('.autosave-ok').addEventListener('click', () => this.commit());
    
    w.addEventListener('input', e => {
      const t = e.target;
      if (!t || !t.classList || !t.classList.contains('speed-input')) return;
      this.markBad();
    });
    w.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); this.cancel(); return; }
      if (e.key === 'Enter') {
        const inp = e.target && e.target.closest ? e.target.closest('.speed-input') : null;
        if (inp) { e.stopPropagation(); e.preventDefault(); this.commit(); }
      }
    });
    
    App.attachDlgClose(w.querySelector('.speed-box'), () => { this.cancel(); return true; });
    this.el = w;
    return w;
  },

  
  readForm() {
    const w = this.el;
    if (!w) return null;
    const ok = (inp, r) => {
      if (!inp) return null;
      const n = Number(inp.value);
      if (inp.value === '' || !isFinite(n) || n < r[0] || n > r[1]) return null;
      return Math.round(n);
    };
    const iv = ok(w.querySelector('#autoSaveInterval'), App.autoSaveRanges.intervalMin);
    const lm = ok(w.querySelector('#autoSaveLimit'), App.autoSaveRanges.limit);
    if (iv === null || lm === null) return null;
    return { intervalMin: iv, limit: lm };
  },

  markBad() {
    const w = this.el;
    if (!w) return;
    const bad = (inp, r) => {
      if (!inp) return;
      const n = Number(inp.value);
      inp.classList.toggle('speed-bad', inp.value === '' || !isFinite(n) || n < r[0] || n > r[1]);
    };
    bad(w.querySelector('#autoSaveInterval'), App.autoSaveRanges.intervalMin);
    bad(w.querySelector('#autoSaveLimit'), App.autoSaveRanges.limit);
  },

  
  setToggleUI(on) {
    const b = this.el && this.el.querySelector('.autosave-toggle');
    if (!b) return;
    b.classList.toggle('autosave-on', !!on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  },
  isEnabled() {
    const b = this.el && this.el.querySelector('.autosave-toggle');
    return !!(b && b.classList.contains('autosave-on'));
  },
  toggleEnabled() { this.setToggleUI(!this.isEnabled()); },

  open() {
    const w = this.build();
    const cur = App.settings.autoSave || App.autoSaveDefaults;
    const iv = w.querySelector('#autoSaveInterval');
    const lm = w.querySelector('#autoSaveLimit');
    iv.value = String(cur.intervalMin);
    lm.value = String(cur.limit);
    iv.classList.remove('speed-bad');
    lm.classList.remove('speed-bad');
    this.setToggleUI(cur.enabled !== false);
    const title = w.querySelector('#autoSaveTitle');
    title.setAttribute('data-i18n', 'autosave.title');
    title.textContent = App.i18n.t('autosave.title');
    App.showOverlay(w);
    return true;
  },

  resetToDefaults() {
    const w = this.el;
    if (!w) return false;
    const d = App.autoSaveDefaults;
    w.querySelector('#autoSaveInterval').value = String(d.intervalMin);
    w.querySelector('#autoSaveLimit').value = String(d.limit);
    w.querySelector('#autoSaveInterval').classList.remove('speed-bad');
    w.querySelector('#autoSaveLimit').classList.remove('speed-bad');
    this.setToggleUI(d.enabled);
    return true;
  },

  
  cancel() {
    if (this.el) App.hideOverlay(this.el);
    return true;
  },

  
  commit() {
    const f = this.readForm();
    if (!f) { this.markBad(); showToast(App.i18n.t('toast.autosave.badValue')); return false; }
    const enabled = this.isEnabled();
    const prev = App.settings.autoSave || App.autoSaveDefaults;
    App.settings.autoSave = { enabled: enabled, intervalMin: f.intervalMin, limit: f.limit };
    if (this.el) App.hideOverlay(this.el);
    
    if (App.restartHistAnchors) App.restartHistAnchors();
    const p = App.settings.save();
    if (p && p.then) {
      p.then(r => {
        if (r && r.ok === false) {
          
          showToast(App.i18n.tf('toast.autosave.saveFail', { v: r.error || '' }));
          return;
        }
        showToast(App.i18n.t(enabled ? 'toast.autosave.saved' : 'toast.autosave.disabled'));
      });
    }
    void prev;
    return true;
  },

  isOpen() { return !!(this.el && !this.el.classList.contains('hidden')); }
};


if (App.i18n && typeof App.i18n.onApply === 'function') {
  App.i18n.onApply(function () {
    try {
      const now = document.getElementById('themeNowName');
      if (now && App.settings) now.textContent = App.settings.themeName(App.settings.theme);
    } catch (e) {  }
    try {
      const tn = document.getElementById('themeName');
      if (tn && App.settings) tn.textContent = App.settings.themeName(App.settings.theme);
    } catch (e) {  }
  });
}

App.settings.initPanel();
App.settings.load();
