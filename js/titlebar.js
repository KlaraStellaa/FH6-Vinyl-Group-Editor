'use strict';
/* ===== 自绘标题栏（UI 改良 C 项）=====
   背景：main.js 的 createWindow() 用 frame:false 去掉了系统标题栏，窗口的
   最小化 / 最大化-还原 / 关闭 三个动作改由页面内的 #titleBar 提供。

   硬约束（改动前务必读一遍）：
   · 标题文字**只能从既有来源读**（<title data-i18n="app.title"> 的 textContent，
     也就是 dlg-i18n.js 里那一个 app.title），本文件**绝不新增/改写任何品牌名**。
   · 关闭**必须**调 sveApi.windowControl('close')，由主进程走 win.close()，
     从而复用既有 close → confirmClose(win) 的「保存 / 不保存 / 取消」链。
     不要在这里直接搞 window.close() 或任何绕过确认的写法。
   · 三个按钮是 **<button>**，但 CSS 上必须显式 -webkit-app-region: no-drag，
     否则会被外层拖动区吞掉点击（Windows 上表现为「点不动」）。
   · 图标用内联 SVG（与工具栏图标同一套 Fluent 风格），不引外部资源，不放宽 CSP。
   · 状态必须与系统真实状态同步：加载时主动 windowStateGet()，之后靠主进程
     在 maximize/unmaximize/focus/blur 时推来的 'window-state' 事件更新。
   · 本文件不新开任何全局 IPC 面，只用 preload 已暴露的三个受限接口。 */

(function () {
  const ICONS = {
    /* Fluent 风格：横线 */
    minimize: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.5 12.75a.75.75 0 0 1 0-1.5h15a.75.75 0 0 1 0 1.5h-15Z" fill="currentColor"/></svg>',
    /* Fluent 风格：方框 */
    maximize: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.25 4.5h11.5A1.75 1.75 0 0 1 19.5 6.25v11.5a1.75 1.75 0 0 1-1.75 1.75H6.25a1.75 1.75 0 0 1-1.75-1.75V6.25A1.75 1.75 0 0 1 6.25 4.5Zm11.5 1.5H6.25a.25.25 0 0 0-.25.25v11.5c0 .138.112.25.25.25h11.5a.25.25 0 0 0 .25-.25V6.25a.25.25 0 0 0-.25-.25Z" fill="currentColor"/></svg>',
    /* Fluent 风格：两个错开方框（还原） */
    restore: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7.5 5.75A2.75 2.75 0 0 1 10.25 3h7A3.75 3.75 0 0 1 21 6.75v7a2.75 2.75 0 0 1-2.75 2.75v.25a3.25 3.25 0 0 1-3.25 3.25h-7A4.25 4.25 0 0 1 3.75 15.5v-7A3.75 3.75 0 0 1 7.5 4.75V5.75Zm1.5.25v8.25a.25.25 0 0 1-.25.25H5.25v6.5A2.75 2.75 0 0 0 8 18.25h6.75v-6.5a.25.25 0 0 1-.25-.25V6H10.25a.25.25 0 0 0-.25.25Zm2.75 8h6.5a.25.25 0 0 0 .25-.25v-7A2.25 2.25 0 0 0 16.25 4.5h-6.5v7c0 .69-.56 1.25-1.25 1.25h-.25v1.25c0 .138.112.25.25.25h.25Z" fill="currentColor"/></svg>',
    /* Fluent 风格：叉 */
    close: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.397 4.554a.75.75 0 0 1 1.06 0L12 11.1l6.545-6.546a.75.75 0 1 1 1.06 1.06L13.06 12.16l6.546 6.545a.75.75 0 0 1-1.06 1.06L12 13.22l-6.545 6.545a.75.75 0 0 1-1.06-1.06l6.545-6.546-6.545-6.545a.75.75 0 0 1 0-1.06Z" fill="currentColor"/></svg>'
  };

  App.TitleBar = {
    box: null,
    btnMax: null,
    unsub: null,
    _maximized: false,

    /* 标题来源：<title>（data-i18n="app.title"）。i18n.apply() 会把它刷成当前语言，
       但它不进 DOM 可见区，所以这里单独取出来渲染到 #titleBarTitle。
       ⚠ 只用既有标题，不拼新品牌名。 */
    title() {
      const t = document.querySelector('head > title');
      const s = t ? String(t.textContent || '').trim() : '';
      return s || 'FH6 Vinyl Group Editor';
    },

    /* 按当前最大化状态刷「最大化 / 还原」键的图标与无障碍名 */
    renderMaxBtn() {
      const b = this.btnMax;
      if (!b) return;
      const isMax = !!this._maximized;
      const key = isMax ? 'win.restore' : 'win.maximize';
      const label = App.i18n.t(key);
      b.innerHTML = isMax ? ICONS.restore : ICONS.maximize;
      b.setAttribute('aria-label', label);
      b.setAttribute('title', label);
      b.setAttribute('data-i18n-attr', 'aria-label');
      b.setAttribute('data-i18n', key);
      b.setAttribute('data-max', isMax ? '1' : '0');
      b.setAttribute('aria-pressed', isMax ? 'true' : 'false');
    },

    /* 主进程推来的真实窗口状态 */
    applyState(st) {
      if (!st) return;
      this._maximized = !!st.maximized;
      this.renderMaxBtn();
    },

    /* 三个按钮的无障碍名（切语言时重刷） */
    renderLabels() {
      const set = (el, key) => {
        if (!el) return;
        const v = App.i18n.t(key);
        el.setAttribute('aria-label', v);
        el.setAttribute('title', v);
        el.setAttribute('data-i18n', key);
        el.setAttribute('data-i18n-attr', 'aria-label');
      };
      /* ★ 2026-09-23 修：三个按钮的**图标**要靠这里注入（HTML 里 <button> 是空的）。
         原来的 bug：只给 winMax 注入了图标（在 renderMaxBtn 里），
         ICONS.minimize / ICONS.close 定义了却从来没被使用 ——
         结果最小化和关闭按钮一直是空白，看起来像「图标不见了」。
         （实测：winMax 有 15x15 的 svg，winMin / winClose 没有。） */
      const paint = (el, svg) => { if (el) el.innerHTML = svg; };
      paint(document.getElementById('winMin'), ICONS.minimize);
      paint(document.getElementById('winClose'), ICONS.close);
      set(document.getElementById('winMin'), 'win.minimize');
      set(document.getElementById('winMax'), 'win.maximize');
      set(document.getElementById('winClose'), 'win.close');
      this.renderMaxBtn();
      const host = document.getElementById('titleBarTitle');
      if (host) host.textContent = this.title();
    },

    /* 点击处理：全部走 preload 暴露的受限动作，不给渲染层指定任意窗口/方法的能力 */
    async act(action) {
      if (!window.sveApi || typeof window.sveApi.windowControl !== 'function') return false;
      try {
        const r = await window.sveApi.windowControl(action);
        if (r && typeof r.maximized === 'boolean') {
          this._maximized = r.maximized;
          this.renderMaxBtn();
        }
        return !!(r && r.ok);
      } catch (e) {
        console.warn('[titlebar] 窗口操作失败', action, String(e && e.message || e).slice(0, 160));
        return false;
      }
    },

    build() {
      this.box = document.getElementById('titleBar');
      if (!this.box) return false;
      this.btnMax = document.getElementById('winMax');

      const bind = (id, action) => {
        const b = document.getElementById(id);
        if (!b) return;
        b.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          this.act(action);
        });
        /* 双击标题栏不落到按钮上（按钮自身的双击不触发最大化） */
        b.addEventListener('dblclick', e => { e.preventDefault(); e.stopPropagation(); });
      };
      bind('winMin', 'minimize');
      bind('winMax', 'toggle-maximize');
      bind('winClose', 'close');

      /* 双击标题栏空白处 = 最大化/还原（与系统标题栏一致）；
         但只在拖动区自身的空白处响应，别把按钮/文字区也算进去。 */
      const drag = this.box.querySelector('.titlebar-drag');
      if (drag) {
        drag.addEventListener('dblclick', e => {
          if (e.target.closest && e.target.closest('.titlebar-btn, button')) return;
          e.preventDefault();
          this.act('toggle-maximize');
        });
      }

      /* 首次状态：主动问一次，避免开窗即处于最大化时图标还是「最大化」 */
      this.renderLabels();
      if (window.sveApi && typeof window.sveApi.windowStateGet === 'function') {
        window.sveApi.windowStateGet().then(r => {
          if (r && r.ok) this.applyState(r);
        }).catch(() => { });
      }
      /* 之后由主进程推：maximize/unmaximize/focus/blur 都会通知。
         注意 onWindowState 返回解除订阅的闭包，这里存下来（重载/重建时不累积监听）。 */
      if (this.unsub) { try { this.unsub(); } catch (e) { /* ignore */ } this.unsub = null; }
      if (window.sveApi && typeof window.sveApi.onWindowState === 'function') {
        this.unsub = window.sveApi.onWindowState(st => this.applyState(st));
      }

      /* 切语言：刷新标题文字与三个键的无障碍名 */
      if (App.i18n && App.i18n.onApply) App.i18n.onApply(() => this.renderLabels());
      return true;
    }
  };

  /* 脚本按 index.html 顺序加载，此刻 DOM 已解析出 #titleBar（它在 <body> 开头），
     这里直接建；若因加载顺序拿不到，退化为 DOMContentLoaded 再建一次。 */
  if (!App.TitleBar.build()) {
    document.addEventListener('DOMContentLoaded', () => App.TitleBar.build(), { once: true });
  }
})();
