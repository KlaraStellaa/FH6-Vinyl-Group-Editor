'use strict';
/* 主题配色：预设表 + 「种子色 → 整套变量」的推导 + 应用。
   为什么要有推导：一套主题要 27 个 CSS 变量，让用户手调 27 个值既不现实也必然调丑。
   所以只让用户（和预设）给 6 个种子色，其余按统一比例从「面板 ↔ 正文色」插值出来 ——
   同一组比例对深色族（提亮）和浅色族（压暗）都成立。

   ★ 这套比例与 _forza-src/_tools/gen-themes.cjs（生成 css/style.css 里 6 套扩展主题的
     变量块）是**同一套公式**。两边若不一致，"预览里的自定义色"与"预设色"就会长得不像一家人 ——
     判据 _forza-src/run-themes.js 的 T8 拿 CSS 块里的种子回灌 derive() 逐个变量比对，守着这一点。

   应用方式：
     · 预设 → 只写 data-theme（用 CSS 里预先算好的变量块，首屏无闪动）
     · 自定义 → 写 data-theme="custom" + 把推导出的变量内联到 <html> 的 style 上
   两族差异用 data-scheme（dark/light）表达，与主题 id 解耦。 */
App.theme = {
  /* 预设表：id 必须与 css/style.css 的变量块一一对应（dark 那套写在 :root 里）。
     文案走 i18n 词条；zh 是词条生效前的兜底。 */
  THEMES: [
    { id: 'dark',     scheme: 'dark',  key: 'settings.dark',  zh: '深色' },
    { id: 'midnight', scheme: 'dark',  key: 'settings.theme.midnight', zh: '午夜蓝' },
    { id: 'forest',   scheme: 'dark',  key: 'settings.theme.forest',   zh: '松林' },
    { id: 'ember',    scheme: 'dark',  key: 'settings.theme.ember',    zh: '暖炭' },
    { id: 'light',    scheme: 'light', key: 'settings.light', zh: '浅色' },
    { id: 'sepia',    scheme: 'light', key: 'settings.theme.sepia',    zh: '米白' },
    { id: 'frost',    scheme: 'light', key: 'settings.theme.frost',    zh: '霜蓝' },
    { id: 'sakura',   scheme: 'light', key: 'settings.theme.sakura',   zh: '樱粉' }
  ],
  CUSTOM_ID: 'custom',
  DEFAULT: 'light',
  /* 自定义主题要用户挑的种子（其余全部推导） */
  SEED_KEYS: ['bg', 'panel', 'accent', 'text'],
  /* 推导出来的变量清单（顺序无关，只用于内联/清理） */
  VAR_KEYS: ['--bg', '--panel', '--panel2', '--border', '--switch-off', '--text', '--dim', '--accent',
    '--btn-bg', '--btn-border', '--btn-hover-bg', '--btn-active-bg', '--input-bg', '--tabbar-bg',
    '--tab-pill-bg', '--tab-pill-hover-bg', '--tab-pill-active-bg', '--card-bg', '--card-hover-bg',
    '--overlay-bg', '--accent-sel-bg', '--thumb-bg', '--swatch-bg', '--scrollbar-thumb',
    '--btn-shadow', '--acrylic-bg', '--acrylic-border'],

  /* ---------- 颜色工具 ---------- */
  _hex(h) {
    const s = String(h || '').replace('#', '').trim();
    const v = s.length === 3 ? s.split('').map(c => c + c).join('') : s;
    if (!/^[0-9a-fA-F]{6}$/.test(v)) return null;
    return [0, 2, 4].map(i => parseInt(v.substr(i, 2), 16));
  },
  _hex6(h) {
    const c = this._hex(h);
    return c ? '#' + c.map(v => v.toString(16).padStart(2, '0')).join('') : null;
  },
  /* 线性插值 a→b（t=0 取 a）。不做 gamma 校正：与 gen-themes.cjs 保持逐位一致 */
  mix(a, b, t) {
    const x = this._hex(a), y = this._hex(b);
    if (!x || !y) return this._hex6(a) || '#000000';
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
  },
  /* 相对亮度（WCAG）：用于明暗族判定与对比度守卫 */
  _lum(c) {
    const v = this._hex(c) || [0, 0, 0];
    const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(v[0]) + 0.7152 * f(v[1]) + 0.0722 * f(v[2]);
  },
  contrast(a, b) {
    const L1 = this._lum(a), L2 = this._lum(b);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  },
  /* 明暗族按**底色亮度**判定，不让用户理解这个概念 */
  schemeOf(bg) {
    return this._lum(bg) > 0.42 ? 'light' : 'dark';
  },

  /* ---------- 推导（与 gen-themes.cjs 同公式） ---------- */
  STEPS: {
    panel2: { dark: 0.035, light: 0.22 },
    btnBg: { dark: 0.04, light: 0 },
    btnHover: { dark: 0.085, light: 0.09 },
    btnActive: { dark: 0.13, light: 0.14 },
    border: { dark: 0.11, light: 0.20 },
    tabPill: { dark: 0.03, light: 0 },
    tabPillHover: { dark: 0.07, light: 0.09 },
    tabPillActive: { dark: 0.085, light: 0 },
    card: { dark: 0.04, light: 0.22 },
    cardHover: { dark: 0.085, light: 0.28 },
    overlay: { dark: 0.02, light: 0.12 },
    switchOff: { dark: 0.20, light: 0.21 },
    scrollbar: { dark: 0.29, light: 0.39 },
    accentSel: { dark: 0.22, light: 0.18 },
    tabbarFromBg: { dark: 0.40, light: null },
    tabbar: { dark: null, light: 0.09 },
    thumbFromBg: { dark: 0.15, light: null },
    thumb: { dark: null, light: 0.06 },
    dim: { dark: 0.61, light: 0.60 }      /* 次要文字：从面板向正文色走六成 */
  },
  /* seeds: { bg, panel, accent, text, dim?, border?, scheme? }
     缺 dim/border/scheme 时按同一套比例推出来 —— 自定义主题只给 4 个种子即可。 */
  derive(seeds) {
    const s = seeds || {};
    const bg = this._hex6(s.bg) || '#1b1d21';
    const panel = this._hex6(s.panel) || '#232529';
    const accent = this._hex6(s.accent) || '#4ea1ff';
    const text = this._hex6(s.text) || '#e6e8eb';
    const scheme = s.scheme || this.schemeOf(bg);
    const light = scheme === 'light';
    const st = k => this.STEPS[k][light ? 'light' : 'dark'];
    const border = this._hex6(s.border) || this.mix(panel, text, st('border'));
    const dim = this._hex6(s.dim) || this.mix(panel, text, st('dim'));
    const v = {};
    v['--bg'] = bg;
    v['--panel'] = panel;
    v['--panel2'] = this.mix(panel, text, st('panel2'));
    v['--border'] = border;
    v['--switch-off'] = this.mix(panel, text, st('switchOff'));
    v['--text'] = text;
    v['--dim'] = dim;
    v['--accent'] = accent;
    v['--btn-bg'] = light ? bg : this.mix(panel, text, st('btnBg'));
    v['--btn-border'] = border;
    v['--btn-hover-bg'] = this.mix(panel, text, st('btnHover'));
    v['--btn-active-bg'] = this.mix(panel, text, st('btnActive'));
    v['--input-bg'] = light ? panel : this.mix(panel, text, st('btnBg'));
    v['--tabbar-bg'] = light ? this.mix(panel, text, st('tabbar')) : this.mix(bg, panel, st('tabbarFromBg'));
    v['--tab-pill-bg'] = light ? bg : this.mix(panel, text, st('tabPill'));
    v['--tab-pill-hover-bg'] = this.mix(panel, text, st('tabPillHover'));
    v['--tab-pill-active-bg'] = light ? panel : this.mix(panel, text, st('tabPillActive'));
    v['--card-bg'] = this.mix(panel, text, st('card'));
    v['--card-hover-bg'] = this.mix(panel, text, st('cardHover'));
    v['--overlay-bg'] = this.mix(panel, text, st('overlay'));
    v['--accent-sel-bg'] = this.mix(panel, accent, st('accentSel'));
    v['--thumb-bg'] = light ? this.mix(bg, text, st('thumb')) : this.mix(bg, panel, st('thumbFromBg'));
    v['--swatch-bg'] = light ? '#5f6570' : '#c8cbd2';
    v['--scrollbar-thumb'] = this.mix(panel, text, st('scrollbar'));
    v['--btn-shadow'] = light ? '0 1px 3px rgba(0, 0, 0, .1)' : '0 1px 3px rgba(0, 0, 0, .3)';
    const ac = this._hex(light ? bg : this.mix(bg, panel, 0.3));
    v['--acrylic-bg'] = 'rgba(' + (ac || [0, 0, 0]).join(', ') + ', .78)';
    v['--acrylic-border'] = light ? 'rgba(0, 0, 0, .06)' : 'rgba(255, 255, 255, .08)';
    return { vars: v, scheme: scheme, seeds: { bg: bg, panel: panel, accent: accent, text: text, dim: dim, border: border } };
  },

  /* ---------- 应用 ---------- */
  presetOf(id) { return this.THEMES.find(t => t.id === id) || null; },
  clearVars() {
    const de = document.documentElement;
    this.VAR_KEYS.forEach(k => de.style.removeProperty(k));
  },
  /* 应用预设（走 CSS 变量块） */
  applyPreset(id) {
    const t = this.presetOf(id) || this.presetOf(this.DEFAULT);
    this.clearVars();
    const de = document.documentElement;
    de.dataset.theme = t.id;
    de.dataset.scheme = t.scheme;
    return { kind: 'preset', id: t.id, scheme: t.scheme };
  },
  /* 应用自定义（内联变量 + data-theme=custom） */
  applyCustom(seeds) {
    const r = this.derive(seeds);
    const de = document.documentElement;
    this.clearVars();
    Object.keys(r.vars).forEach(k => de.style.setProperty(k, r.vars[k]));
    de.dataset.theme = this.CUSTOM_ID;
    de.dataset.scheme = r.scheme;
    return { kind: 'custom', id: this.CUSTOM_ID, scheme: r.scheme, seeds: r.seeds, vars: r.vars };
  },
  /* 自定义色的对比度体检：返回不足的项（空数组 = 合格） */
  customWarnings(seeds) {
    const r = this.derive(seeds);
    const out = [];
    if (this.contrast(r.vars['--panel'], r.vars['--text']) < 4.5) out.push({ key: 'text', value: +this.contrast(r.vars['--panel'], r.vars['--text']).toFixed(2) });
    if (this.contrast(r.vars['--panel'], r.vars['--dim']) < 2) out.push({ key: 'dim', value: +this.contrast(r.vars['--panel'], r.vars['--dim']).toFixed(2) });
    return out;
  },
  /* 自定义色的出厂值（沿用浅色预设的种子，用户改起来有参照） */
  defaultSeeds() {
    return { bg: '#F8FAFD', panel: '#FFFFFF', accent: '#00A89A', text: '#000000' };
  }
};
