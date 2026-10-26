'use strict';
/* ===== 自绘标题栏（UI 改良 C 项）=====
   背景：main.js 的 createWindow() 用 frame:false 去掉了系统标题栏，窗口的
   最小化 / 最大化-还原 / 关闭 三个动作改由页面内的 #titleBar 提供。

   硬约束：
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
        /* 还原（向下还原）：字形取自 Windows 自带的 Segoe Fluent Icons —— ChromeRestore(U+E923)，
       由 _forza-src/_tools/ttf-glyph2svg.py 从字体里取轮廓转成 SVG path（内联，不引外部字体）。
       原来的内联路径画崩了（40px 下是个带缺口的糊块），这里换成系统原字形：
       墨迹盒与 max 同为 4.5..19.5、笔画同为 1.5 单位，两个键并排粗细一致。 */
    restore: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17.999 8.946Q17.999 8.338 17.757 7.8Q17.515 7.261 17.101 6.862Q16.688 6.463 16.142 6.232Q15.596 6.001 14.996 6.001L7.627 6.001Q7.745 5.665 7.957 5.386Q8.169 5.108 8.448 4.91Q8.726 4.712 9.059 4.606Q9.393 4.5 9.751 4.5L14.996 4.5Q15.926 4.5 16.746 4.855Q17.566 5.21 18.178 5.818Q18.79 6.426 19.145 7.247Q19.5 8.067 19.5 8.997L19.5 14.249Q19.5 14.607 19.394 14.941Q19.288 15.274 19.09 15.552Q18.892 15.831 18.614 16.043Q18.335 16.255 17.999 16.373L17.999 8.946ZM6.712 19.5Q6.272 19.5 5.87 19.321Q5.467 19.141 5.163 18.837Q4.859 18.533 4.679 18.13Q4.5 17.728 4.5 17.288L4.5 9.715Q4.5 9.268 4.679 8.869Q4.859 8.47 5.163 8.166Q5.467 7.862 5.866 7.682Q6.265 7.503 6.712 7.503L14.285 7.503Q14.732 7.503 15.135 7.682Q15.538 7.862 15.838 8.162Q16.138 8.462 16.318 8.865Q16.497 9.268 16.497 9.715L16.497 17.288Q16.497 17.735 16.318 18.134Q16.138 18.533 15.834 18.837Q15.53 19.141 15.131 19.321Q14.732 19.5 14.285 19.5L6.712 19.5ZM14.249 17.999Q14.402 17.999 14.538 17.94Q14.673 17.881 14.78 17.779Q14.886 17.676 14.944 17.541Q15.003 17.405 15.003 17.251L15.003 9.751Q15.003 9.598 14.944 9.458Q14.886 9.319 14.783 9.217Q14.681 9.114 14.542 9.056Q14.402 8.997 14.249 8.997L6.749 8.997Q6.595 8.997 6.459 9.056Q6.324 9.114 6.221 9.22Q6.119 9.327 6.06 9.462Q6.001 9.598 6.001 9.751L6.001 17.251Q6.001 17.405 6.06 17.541Q6.119 17.676 6.221 17.779Q6.324 17.881 6.459 17.94Q6.595 17.999 6.749 17.999L14.249 17.999Z" fill="currentColor"/></svg>',
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
       只用既有标题，不拼新品牌名。 */
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
      /* 失焦态：整条栏压暗（与系统标题栏一致）。
         不在这里写任何颜色 —— CSS 只对 .titlebar-drag / .titlebar-btns 降 opacity，
         底色与按钮取色仍全部走 --titlebar-* 主题变量。 */
      if (this.box) this.box.classList.toggle('sve-inactive', st.focused === false);
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
      /* 三个按钮的**图标**靠这里注入（HTML 里 <button> 是空的）：
         winMax 的图标在 renderMaxBtn 里，这里补上 ICONS.minimize / ICONS.close，
         否则最小化和关闭按钮一直是空白。 */
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

      /* 双击标题栏空白处 = 最大化/还原：**由系统 caption 语义负责**，这里刻意不接管。
         -webkit-app-region: drag 在 Windows 上把这块命中区映射成 HTCAPTION，
         Windows 收到 WM_NCLBUTTONDBLCLK 自己就切最大化/还原；
         实测（真实 OS 双击 + GetWindowLongW 读窗口状态，探针 _forza-src/_tmp-probe-dblclick.js）：
           · 保留本处理器时：双击 → 状态翻转 **一次**（说明 DOM 的 dblclick 根本没送到页面，处理器是死代码）
           · 运行时摘掉本处理器：双击 → 状态照样翻转一次（原生确实在管）
         若在这里再挂一个 toggle-maximize，一旦某天 DOM 事件也被送来，就会「翻两次 = 看着没反应」。
         所以口径是：**只保留原生这一条路**，由判据 run-titlebar-os.js 的 O4 用真实双击守着。 */

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
