'use strict';
/* 用户设置（语言 / 主题）：面板构建与绑定 + 持久化（preload 暴露 settingsGet/settingsSet，
   落 userData/settings.json；localStorage 作双保险）。
   主题只改 UI 颜色（CSS 变量），#canvasWrap 画布背景与 class 一律不动。 */
App.settings = {
  lang: 'zh-CN',
  /* 默认主题：浅色（首次打开时用浅色）。
     已保存过设置的会读存储里的值，不受这里影响（见下方 load()）。 */
  theme: 'light',
  /* 主题配色：预设表与推导都在 js/theme.js（App.theme）。这里只留
     「当前选中的 id + 自定义种子」和持久化 —— 面板/窗口不管配色怎么算出来的。 */
  /* 自定义主题的种子色（仅 theme === 'custom' 时有意义；随设置一起落盘）。
     存的是**种子**不是 27 个变量：以后调推导比例，老配置自动跟着变好看，不用迁移。 */
  customTheme: null,
  themeOf(id) { return App.theme.presetOf(id) || (id === App.theme.CUSTOM_ID ? { id: id, scheme: App.theme.schemeOf((this.customTheme || {}).bg || '#F8FAFD') } : null); },
  /* 应用主题：id = 预设 id 或 'custom'（可带 seeds）。
     只动 UI 变量；#canvasWrap 画布背景与 class 一律不碰（既有约束）。 */
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
  /* 画布拖动是否必须按住空格（默认开）。
     开 = 按住空格 + 拖动才平移画布（原有行为）；
     关 = 鼠标左键直接拖动即可平移画布（编辑模式下仍走原来的拖动图层，不抢）。 */
  panNeedsSpace: true,

  /* ---------- 自动保存工作进程（历史锚点）----------
     由「设置 → 自动保存设置」窗口写入，io.js 的 startHistAnchors/saveHistAnchor 读取。
     默认值 = 需求指定（15 分钟 / 最多 15 个 / 启用），所以没配置过的用户行为零变化。
     校验口径：间隔 1-1440 分钟、上限 1-1000 个；坏值一律回退默认（绝不让坏值进定时器）。 */
  autoSave: { enabled: true, intervalMin: 15, limit: 15 },

  /* 主题视图的磁贴预览色：从**样式表真值**里读（不手抄一份，免得和 css 走散）。
     dark 那套写在 :root 里，所以要挑带 --bg 的那个 :root 块。读不到就返回 null，
     磁贴退化成"只有名字"（功能不受影响）。 */
  presetPreview(id) {
    const want = id === 'dark' ? ':root' : 'html[data-theme="' + id + '"]';
    for (const sheet of Array.from(document.styleSheets || [])) {
      let rules = null;
      try { rules = sheet.cssRules; } catch (e) { continue; }   /* 跨域表读不了：跳过 */
      for (const r of Array.from(rules || [])) {
        if (r.selectorText !== want || !r.style) continue;
        const bg = r.style.getPropertyValue('--bg').trim();
        if (!bg) continue;                                       /* 挑到的是另一个 :root */
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

  /* ---------- 主题视图（设置窗内的第三个视图，与快捷键视图同一套切法） ---------- */
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
        '<span class="tm-name">' + ((App.i18n && App.i18n.t(th.key)) || th.zh) + '</span>' +
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
    /* 预设磁贴：点了立即生效 + 落盘（与设置窗其它项同一原则：即时生效） */
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
    /* 取色：input 事件实时预览（不落盘，拖动中别狂写盘），change 事件才落盘 */
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

  /* 自定义取色的实时预览：只改预览块自己的变量，不动全局（用户还没点「应用」） */
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

  /* 切到主题视图 */
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
    const cb = box.querySelector('.confirm-box');
    if (cb) cb.classList.add('tm-mode');
    if (title) { title.setAttribute('data-i18n', 'settings.theme'); title.textContent = App.i18n.t('settings.theme'); }
    /* 自定义取色框填上当前值（当前就是自定义 → 用当前种子；否则用出厂值） */
    const seeds = this.theme === App.theme.CUSTOM_ID && this.customTheme
      ? Object.assign({}, App.theme.defaultSeeds(), this.customTheme)
      : App.theme.defaultSeeds();
    const map = { bg: 'tmSeedBg', panel: 'tmSeedPanel', accent: 'tmSeedAccent', text: 'tmSeedText' };
    Object.keys(map).forEach(k => { const i = el && el.querySelector('#' + map[k]); if (i) i.value = seeds[k]; });
    this.previewCustom(seeds);
    this.syncThemeView();
    return true;
  },

  /* 主题视图里的选中态与设置同步（面板不许与真实设置不一致 —— 与 syncPanel 同一原则） */
  syncThemeView() {
    const el = document.getElementById('settingsThemeView');
    if (!el || el.dataset.built !== '1') return;
    el.querySelectorAll('.tm-tile').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-theme-id') === this.theme);
    });
    const now = document.getElementById('themeNowName');
    if (now) now.textContent = this.themeName(this.theme);
  },

  /* 回到设置主视图 */
  showMainView() {
    if (App.keymapUI) App.keymapUI.showMainView();
    const box = document.getElementById('settingsPanel');
    if (!box) return;
    const main = box.querySelector('#settingsMainView');
    const key = box.querySelector('#settingsKeyView');
    const tv = box.querySelector('#settingsThemeView');
    const title = box.querySelector('#settingsTitle');
    if (main) main.classList.remove('hidden');
    if (key) key.classList.add('hidden');
    if (tv) tv.classList.add('hidden');
    const cb = box.querySelector('.confirm-box');
    if (cb) cb.classList.remove('tm-mode', 'km-mode');
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
          '<label for="btnTheme" data-i18n="settings.theme">主题颜色</label>' +
          '<span class="settings-now">' +
            '<span id="themeNowName"></span>' +
            '<button id="btnTheme" class="settings-change" data-i18n="settings.change">更改</button>' +
          '</span>' +
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
      '</div>';
    document.body.appendChild(p);
    p.addEventListener('click', e => { if (e.target === p) App.hideOverlay(p); });
    p.querySelector('#btnSettingsClose').addEventListener('click', () => App.hideOverlay(p));
    /* EvolveUI 下拉动画：设置面板内 select 转 ev-dd */
    if (App.evDropdown) { App.evDropdown(p.querySelector('#settingLang')); }
    p.querySelector('#settingLang').addEventListener('change', e => {
      const v = e.target.value;
      if (App.i18n && App.i18n.dicts[v]) { this.lang = v; App.i18n.set(v); }
    });
    /* 主题：点「更改」→ 同一个设置窗切成主题视图（与「自定义快捷键」同一套切法） */
    const btnTheme = p.querySelector('#btnTheme');
    if (btnTheme) btnTheme.addEventListener('click', () => this.openThemeView());
    /* 编辑速率 / 微调速率：两个入口用同一个窗口组件，各自编辑不同的配置对象 */
    const b1 = p.querySelector('#btnEditSpeed');
    const b2 = p.querySelector('#btnNudgeSpeed');
    if (b1) b1.addEventListener('click', () => { App.hideOverlay(p); App.speedEditor.open('wasm'); });
    if (b2) b2.addEventListener('click', () => { App.hideOverlay(p); App.speedEditor.open('nudge'); });
    /* 自定义快捷键：**不关窗**，把同一个设置窗切成快捷键视图 */
    const bk = p.querySelector('#btnKeymap');
    if (bk && App.keymapUI) bk.addEventListener('click', () => App.keymapUI.open());
    /* 自动保存工作进程：**关掉设置窗**，单独打开自动保存设置窗口（与「更改编辑速率」同路数） */
    const ba = p.querySelector('#btnAutoSave');
    if (ba) ba.addEventListener('click', () => { App.hideOverlay(p); App.autoSaveEditor.open(); });
    if (App.keymapUI) App.keymapUI.build(p.querySelector('.confirm-box'));
    /* 右上角 ×：语义与「关闭」按钮一致（设置窗的改动都是即时生效的，没有待确认状态）。
       注意必须在 keymapUI.build 之后 —— 快捷键视图会把 #settingsKeyView 铺进同一个 confirm-box，
       × 挂在标题行上，早挂晚挂都不冲突，但晚挂能确保标题行已成型。 */
    App.attachDlgClose(p.querySelector('.confirm-box'), () => { App.hideOverlay(p); return true; });
    this.syncPanel();
  },

  /* 面板必须显示「当前实际设置」。
     initPanel 建出来的控件默认值与已保存设置无关 → 不同步的话面板会撒谎
     （机器上存的是浅色，面板显示默认值，看起来像初始主题错了）。
     三处调用：建面板后 / 每次打开面板 / 读完设置后。 */
  syncPanel() {
    const now = document.getElementById('themeNowName');
    if (now) now.textContent = this.themeName(this.theme);
    const l = document.getElementById('settingLang');
    if (l && l.value !== this.lang) l.value = this.lang;
    /* 可见的是 ev-dd 克隆，不是那个被隐藏的原生 select：
       只改 select.value 不改克隆，面板就会「撒谎」（退出重进后显示默认语言）。 */
    if (App.evDropdownSyncAll) App.evDropdownSyncAll();
    this.syncThemeView();
  },

  toggle() {
    const p = document.getElementById('settingsPanel');
    if (!p) return;
    if (p.classList.contains('hidden')) {
      /* 每次打开都从主视图开始（上次停在快捷键页/主题页要复位） */
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

  async load() {
    try {
      const r = await window.sveApi.settingsGet();
      const s = (r && r.settings) || r || {};
      if (s.lang && App.i18n && App.i18n.dicts[s.lang]) this.lang = s.lang;
      /* 自定义主题的种子要先于 applyAll 读进来（applyAll 会按 this.theme 应用） */
      if (s.customTheme && typeof s.customTheme === 'object') this.customTheme = s.customTheme;
      /* 主题：只认预设 id 或 'custom'（老配置里的 light/dark 仍在表内，行为不变；
         表外的坏值一律忽略、保持默认） */
      if (this.themeOf(s.theme)) this.theme = s.theme;
      /* 只有**明确 false** 才关掉（老配置文件里没这个字段 → 保持默认「开」，行为不变） */
      if (s.panNeedsSpace === false) this.panNeedsSpace = false;
      this.applyAutoSave(s.autoSave);
      this.applySpeeds(s);
      this.applyKeymap(s);
    } catch (e) { /* 无 API（异常环境）时用默认 */ }
    /* localStorage 兜底（API 不可用时仍有记忆） */
    try {
      const ls = JSON.parse(localStorage.getItem('sve-settings') || '{}');
      if (!window.sveApi.settingsGet) {
        if (ls.lang && App.i18n.dicts[ls.lang]) this.lang = ls.lang;
        if (ls.customTheme && typeof ls.customTheme === 'object') this.customTheme = ls.customTheme;
        if (this.themeOf(ls.theme)) this.theme = ls.theme;
        if (ls.panNeedsSpace === false) this.panNeedsSpace = false;
        this.applyAutoSave(ls.autoSave);
      }
      this.applySpeeds(ls);
      if (!window.sveApi.settingsGet) this.applyKeymap(ls);   /* 主通道已应用过就不重复覆盖 */
    } catch (e) { /* ignore */ }
    /* 配置生效后把定时器调成用户要的节奏（load 完成才调用，避免用默认值先跑一拍） */
    if (App.restartHistAnchors) App.restartHistAnchors();
    this.applyAll();
    this.syncPanel();   /* 读到的设置立刻反映到面板（面板不许与真实设置不一致） */
  },

  /* 自动保存配置：缺失/非法逐项回退默认值（老配置文件没有这段 → 保持原有 15 分钟/15 个）。
     间隔与上限都用有限数 + 范围校验，坏值绝不进定时器。 */
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
      /* 自定义主题只存种子（27 个变量由 js/theme.js 现算） */
      customTheme: this.theme === App.theme.CUSTOM_ID ? Object.assign({}, this.customTheme) : undefined,
      panNeedsSpace: this.panNeedsSpace !== false,
      /* 自动保存：只存三项；窗口里已校验过，这里再兜一次（不进坏值） */
      autoSave: {
        enabled: this.autoSave.enabled !== false,
        intervalMin: this.autoSave.intervalMin,
        limit: this.autoSave.limit
      },
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
  wasm: { move: 70, size: 95, rotate: 70, skew: 32, opacity: 30 },
  nudge: { move: 0.5, size: 1, rotate: 0.2, skew: 2, opacity: 1 }
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
    /* Esc 关窗 = 取消（恢复打开窗口前的配置），不冒泡给全局 Esc 链路；
       Enter = 只结束输入（值在 input 事件里已即时写入临时配置），绝不提交/关闭窗口 ——
       与全局 keydown 的输入态闸门配合，回车时窗口和编辑模式都不受影响 */
    w.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); this.cancel(); return; }
      if (e.key === 'Enter') {
        const inp = e.target && e.target.closest ? e.target.closest('.speed-input') : null;
        if (inp) { e.stopPropagation(); e.preventDefault(); inp.blur(); }
      }
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

/* ---------- 自动保存「工作进程」设置窗口 ----------
   入口在设置窗「日志」上方；与速率窗同属「独立小窗」，但参数是纯标量（间隔/上限/开关），
   所以打开时读的是**真实设置**、点「确定」才写盘（不做即时生效那套）。
   默认值/范围集中在这里，io.js 与主进程清理逻辑共用同一份口径。 */
App.autoSaveDefaults = { enabled: true, intervalMin: 15, limit: 15 };
App.autoSaveRanges = { intervalMin: [1, 1440], limit: [1, 1000] };

App.autoSaveEditor = {
  el: null,

  build() {
    if (this.el && this.el.isConnected) return this.el;
    /* ★ 挂到 body 而不是 #canvasWrap：本窗是 fixed 全屏模态层（见 css #autoSavePanel），
       挂进 #canvasWrap 会被它的 overflow:hidden 裁掉、且继承不到主页之上的层级。
       与设置窗 #settingsPanel 同一口径（那个也是 appendChild 到 body）。 */
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
      '<div class="autosave-note" id="autoSaveNote"></div>' +
      '<div class="anchor-btns">' +
        '<button class="autosave-reset" data-i18n="autosave.reset"></button>' +
        '<button class="autosave-cancel" data-i18n="autosave.cancel"></button>' +
        '<button class="autosave-ok" data-i18n="autosave.ok"></button>' +
      '</div></div>';
    host.appendChild(w);
    /* 建窗即套词典：data-i18n 只在 apply() 时生效，不刷一次会是空白标签 */
    if (App.i18n && App.i18n.apply) App.i18n.apply(w);
    w.querySelector('.autosave-toggle').addEventListener('click', () => this.toggleEnabled());
    w.querySelector('.autosave-reset').addEventListener('click', () => this.resetToDefaults());
    w.querySelector('.autosave-cancel').addEventListener('click', () => this.cancel());
    w.querySelector('.autosave-ok').addEventListener('click', () => this.commit());
    /* 输入即时刷新摘要 + 标红非法值（不写盘，确定才生效） */
    w.addEventListener('input', e => {
      const t = e.target;
      if (!t || !t.classList || !t.classList.contains('speed-input')) return;
      this.markBad();
      this.syncNote();
    });
    w.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); this.cancel(); return; }
      if (e.key === 'Enter') {
        const inp = e.target && e.target.closest ? e.target.closest('.speed-input') : null;
        if (inp) { e.stopPropagation(); e.preventDefault(); this.commit(); }
      }
    });
    /* 右上角 ×：等于「取消」（不写盘）。语义与速率窗不同：这里没有即时生效的临时值，
       但保持「× = 放弃本次改动」比「× = 保存」更符合用户预期。 */
    App.attachDlgClose(w.querySelector('.speed-box'), () => { this.cancel(); return true; });
    this.el = w;
    return w;
  },

  /* 输入框当前值 → 合法值（非法返回 null）。enabled 单独管，不受影响 */
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

  /* 开关当前状态（role=switch 的自绘键） */
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
  toggleEnabled() { this.setToggleUI(!this.isEnabled()); this.syncNote(); },

  /* 摘要行：把「间隔 × 上限」翻成一句人话 */
  syncNote() {
    const el = this.el && this.el.querySelector('#autoSaveNote');
    if (!el) return;
    const f = this.readForm();
    const d = App.autoSaveDefaults;
    el.textContent = App.i18n.tf('autosave.note', {
      i: f ? f.intervalMin : d.intervalMin,
      n: f ? f.limit : d.limit
    });
    el.classList.toggle('autosave-note-off', !this.isEnabled());
  },

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
    this.syncNote();
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
    this.syncNote();
    return true;
  },

  /* 取消：什么都不写，关窗（定时器仍在按老配置跑） */
  cancel() {
    if (this.el) App.hideOverlay(this.el);
    return true;
  },

  /* 确定：校验 → 写入 App.settings.autoSave → 落盘 → 立刻重排定时器（不用重启软件） */
  commit() {
    const f = this.readForm();
    if (!f) { this.markBad(); showToast(App.i18n.t('toast.autosave.badValue')); return false; }
    const enabled = this.isEnabled();
    const prev = App.settings.autoSave || App.autoSaveDefaults;
    App.settings.autoSave = { enabled: enabled, intervalMin: f.intervalMin, limit: f.limit };
    if (this.el) App.hideOverlay(this.el);
    /* 定时器立刻按新节奏跑（关掉自动保存时是清掉定时器） */
    if (App.restartHistAnchors) App.restartHistAnchors();
    const p = App.settings.save();
    if (p && p.then) {
      p.then(r => {
        if (r && r.ok === false) {
          /* 落盘失败：内存里已经是新值（本次会话仍按新节奏跑），只提示，不假装存住了 */
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

App.settings.initPanel();
App.settings.load();
